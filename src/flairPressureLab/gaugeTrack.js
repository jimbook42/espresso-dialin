import {
  TIP_INNER_RATIO,
  OUTER_RADIUS_RATIO,
  NEEDLE_LIKENESS_GATE,
  NEEDLE_TRACK_QUALITY,
  DIAL_FACE_VERIFY_MIN,
  DIAL_CANONICAL_VERIFY_MIN,
  wrap360,
  wrapDelta,
} from './gaugeConfig.js';
import { prepareEdges } from './framePrep.js';
import { assessFrameQuality } from './frameQuality.js';
import { detectNeedleAngle, needleZoomForRadius } from './needleFromFrame.js';
import {
  FLAIR_CANONICAL_DIAL_PROFILE,
  FLAIR_CANONICAL_FACE_PROFILE,
} from './canonicalDial.js';
import { getOpenCvSync } from './opencvRuntime.js';
import {
  consumeDiscoveryResult,
  requestCanvasDiscovery,
  requestVideoDiscovery,
  whenDiscoverySettled,
} from './discoveryClient.js';
import { measureDialColorBands, registerDialFromColorBands } from './colorRegistration.js';
import { faceProfileFromBands, stepScaleLock } from './scaleLock.js';

/**
 * Gauge pose for the pressure lab.
 *
 * Position comes from the circular rim: edge gradients on a real dial point
 * outward all the way around, so a translated gauge moves the circle and a
 * rotating needle does not. Orientation comes from the fixed tick/numeral
 * pattern, with the needle sector ignored, so a lever twist is not read as
 * pressure. Pressure uses needle angle minus that gauge rotation.
 *
 * Locked tracking follows the rim. Rotation is written in whole profile bins.
 * The first sighting of a step is stored and not applied. The next frame
 * commits when the needle agrees and the new step is the same bin or the same
 * whole-bin increment. A needle disagreement does not write rotation and does
 * not erase a stored bin. A weak dial match does not create a bin and does
 * not erase one. Pressure can hold while the centre keeps following.
 *
 * Commits that would carry the pose more than one tick period from the last
 * strong identity anchor have to pass that anchor's margin, confidence, and
 * face checks. Failing that check does not move the anchor. A single step
 * inside the locked window does not skip the sum.
 *
 * A jump outside the locked match still uses the wide search. The outer tick
 * ring repeats about every 30°, and a large search rotation has to beat that
 * alias. When the white face has structure, that inner profile has to agree.
 * The search holds the last pose until the same dial is confirmed.
 */

const RIM_BINS = 48;
const RIM_COS = new Float64Array(RIM_BINS);
const RIM_SIN = new Float64Array(RIM_BINS);
for (let i = 0; i < RIM_BINS; i += 1) {
  const angle = (i / RIM_BINS) * Math.PI * 2;
  RIM_COS[i] = Math.cos(angle);
  RIM_SIN[i] = Math.sin(angle);
}
const PROFILE_BINS = 72;
const CONFIDENCE_MIN = 0.3;
const ORIENT_MIN = 0.34;
/** Nearest shift treated as a different tick period, not a shoulder of the best peak. */
const PERIOD_RIVAL_DEG = 24;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** How strongly edges at `radius` point at `(cx, cy)`. 0 if the circle does not fit. */
export function scoreRim(edges, width, height, cx, cy, radius) {
  if (radius < 8) return 0;
  const gx = edges.gx;
  const gy = edges.gy;
  const limitX = width - 1;
  const limitY = height - 1;
  const litNeed = RIM_BINS * 0.35;
  let sum = 0;
  let lit = 0;
  for (let i = 0; i < RIM_BINS; i += 1) {
    const cos = RIM_COS[i];
    const sin = RIM_SIN[i];
    let local = 0;
    for (let dr = -3; dr <= 3; dr += 1.5) {
      const x = cx + (radius + dr) * cos;
      const y = cy + (radius + dr) * sin;
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi < 1 || yi < 1 || xi >= limitX || yi >= limitY) continue;
      const index = yi * width + xi;
      const radial = Math.abs(gx[index] * cos + gy[index] * sin);
      if (radial > local) local = radial;
    }
    sum += local;
    if (local > 0.4) lit += 1;
    // A miss cannot become a rim if the bins left cannot light enough of the circle.
    if (lit + (RIM_BINS - i - 1) < litNeed) return 0;
  }
  if (lit < litNeed) return 0;
  return (sum / RIM_BINS) * (lit / RIM_BINS);
}

function offsetScore(edges, width, height, cx, cy, radius) {
  const shift = radius * 0.34;
  let hardest = 0;
  let compared = 0;
  for (const [dx, dy] of [[shift, 0], [-shift, 0], [0, shift], [0, -shift]]) {
    const score = scoreRim(edges, width, height, cx + dx, cy + dy, radius);
    if (score <= 0) continue;
    compared += 1;
    if (score > hardest) hardest = score;
  }
  if (!compared) return null;
  return hardest;
}

/**
 * Search a window around the previous circle. `prior` is in image pixels.
 * Returns the unsmoothed centre. `edges` is reused for the dial profile.
 */
export function locateGauge(image, prior, { searchFraction = 0.46, edges: suppliedEdges = null, priorOnly = false } = {}) {
  const { width, height } = image;
  let edges = suppliedEdges;
  if (!edges) {
    const contrastRadius = Math.max(3, Math.round(prior.radius / 6));
    edges = prepareEdges(image, { contrastRadius }).edges;
  }
  if (priorOnly) {
    const score = scoreRim(edges, width, height, prior.cx, prior.cy, prior.radius);
    const off = offsetScore(edges, width, height, prior.cx, prior.cy, prior.radius);
    const confidence = score > 1e-3 && off != null ? clamp((score - off) / score, 0, 1) : 0;
    const ok = confidence >= CONFIDENCE_MIN && score > 1e-3;
    return {
      ok,
      confidence: ok ? confidence : confidence * 0.5,
      cx: prior.cx,
      cy: prior.cy,
      radius: prior.radius,
      score,
      edges,
      width,
      height,
    };
  }
  const extent = Math.max(6, prior.radius * searchFraction);
  const step = Math.max(2, Math.round(extent / 6));
  let best = { score: -1, cx: prior.cx, cy: prior.cy, radius: prior.radius };

  const consider = (cx, cy, radius) => {
    if (radius < 8) return;
    if (cx - radius < 1 || cy - radius < 1 || cx + radius >= width - 1 || cy + radius >= height - 1) return;
    const score = scoreRim(edges, width, height, cx, cy, radius);
    if (score > best.score) best = { score, cx, cy, radius };
  };

  for (let dy = -extent; dy <= extent; dy += step) {
    for (let dx = -extent; dx <= extent; dx += step) {
      const cx = prior.cx + dx;
      const cy = prior.cy + dy;
      consider(cx, cy, prior.radius * 0.96);
      consider(cx, cy, prior.radius);
      consider(cx, cy, prior.radius * 1.04);
    }
  }

  const refine = Math.max(2, step);
  const coarse = best;
  for (let dy = -refine; dy <= refine; dy += 1) {
    for (let dx = -refine; dx <= refine; dx += 1) {
      consider(coarse.cx + dx, coarse.cy + dy, coarse.radius);
    }
  }
  for (const scale of [0.94, 0.97, 1, 1.03, 1.06]) {
    consider(best.cx, best.cy, prior.radius * scale);
  }

  const off = offsetScore(edges, width, height, best.cx, best.cy, best.radius);
  const confidence = best.score > 1e-3 && off != null
    ? clamp((best.score - off) / best.score, 0, 1)
    : 0;
  const ok = confidence >= CONFIDENCE_MIN && best.score > 1e-3;
  return {
    ok,
    confidence: ok ? confidence : confidence * 0.5,
    cx: ok ? best.cx : prior.cx,
    cy: ok ? best.cy : prior.cy,
    radius: ok ? best.radius : prior.radius,
    score: best.score,
    edges,
    width,
    height,
  };
}

function nearNeedle(deg, needleDeg, halfWidth) {
  if (needleDeg == null) return false;
  return Math.abs(wrapDelta(needleDeg, deg)) <= halfWidth
    || Math.abs(wrapDelta(wrap360(needleDeg + 180), deg)) <= halfWidth;
}

/**
 * Fixed dial markings in one annulus. The default band is the outer tick ring.
 * An inner band sits on the white face, away from the black rim. The needle is masked later.
 */
export function measureRimProfile(edges, width, height, cx, cy, radius, band) {
  const profile = new Float32Array(PROFILE_BINS);
  const counts = new Float32Array(PROFILE_BINS);
  const inner = radius * (band?.innerRatio ?? 0.72);
  const outer = radius * (band?.outerRatio ?? 0.94);
  for (let r = inner; r <= outer; r += 1.5) {
    for (let i = 0; i < PROFILE_BINS; i += 1) {
      const angle = (i / PROFILE_BINS) * Math.PI * 2;
      const x = Math.round(cx + r * Math.cos(angle));
      const y = Math.round(cy + r * Math.sin(angle));
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      profile[i] += edges.mag[y * width + x];
      counts[i] += 1;
    }
  }
  for (let i = 0; i < PROFILE_BINS; i += 1) {
    if (counts[i]) profile[i] /= counts[i];
  }
  return profile;
}

function cosineCentered(left, right) {
  let meanL = 0;
  let meanR = 0;
  for (let i = 0; i < left.length; i += 1) {
    meanL += left[i];
    meanR += right[i];
  }
  meanL /= left.length;
  meanR /= right.length;
  let dot = 0;
  let a2 = 0;
  let b2 = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i] - meanL;
    const b = right[i] - meanR;
    dot += a * b;
    a2 += a * a;
    b2 += b * b;
  }
  if (a2 < 1e-6 || b2 < 1e-6) return 0;
  return dot / Math.sqrt(a2 * b2);
}

/**
 * Rotation of `current` relative to `reference`, in degrees clockwise.
 * Bins on the needle and its tail are left out so the pointer cannot rotate the gauge.
 */
export function matchGaugeRotation(reference, current, {
  previousDeg = 0,
  needleDeg = null,
  alsoNeedleDeg = null,
  referenceNeedleDeg = null,
  maxShiftDeg = 18,
} = {}) {
  if (!reference || !current || reference.length !== current.length) {
    return { ok: false, rotationDeg: previousDeg, confidence: 0, margin: 0, periodMargin: 0 };
  }
  const bins = reference.length;
  const step = 360 / bins;
  const half = Math.max(1, Math.round(maxShiftDeg / step));
  const centerBin = Math.round(previousDeg / step);
  const ranked = [];

  for (let shift = centerBin - half; shift <= centerBin + half; shift += 1) {
    const refVals = [];
    const curVals = [];
    for (let i = 0; i < bins; i += 1) {
      const curDeg = i * step;
      const refIndex = ((i - shift) % bins + bins) % bins;
      const refDeg = refIndex * step;
      if (nearNeedle(curDeg, needleDeg, 16) || nearNeedle(curDeg, alsoNeedleDeg, 16)) continue;
      if (nearNeedle(refDeg, referenceNeedleDeg, 16)) continue;
      refVals.push(reference[refIndex]);
      curVals.push(current[i]);
    }
    if (refVals.length < bins * 0.45) continue;
    ranked.push({ shift, corr: cosineCentered(refVals, curVals) });
  }

  if (!ranked.length) return { ok: false, rotationDeg: previousDeg, confidence: 0, margin: 0, periodMargin: 0 };
  ranked.sort((a, b) => b.corr - a.corr);
  const best = ranked[0];
  const separated = (minDeg) => ranked.find((item) => Math.abs(wrapDelta(best.shift * step, item.shift * step)) >= minDeg);
  const second = separated(12);
  const periodRival = separated(PERIOD_RIVAL_DEG);
  const rotationDeg = wrap360(best.shift * step);
  const margin = second ? best.corr - second.corr : best.corr;
  const periodMargin = periodRival ? best.corr - periodRival.corr : best.corr;
  const median = ranked[Math.floor(ranked.length / 2)].corr;
  const peaked = best.corr - median >= 0.05;
  const ok = best.corr >= ORIENT_MIN && margin >= 0.02 && peaked;
  return {
    ok,
    rotationDeg: ok ? rotationDeg : previousDeg,
    confidence: clamp(best.corr, 0, 1),
    margin,
    periodMargin,
    estimateDeg: rotationDeg,
  };
}

/**
 * Stillness gates, measured on a frozen crop of a stationary synthetic dial.
 * A fixed hub keeps the needle angle constant even when the rim score wanders.
 * The old blend (half of every centre error, 0.35 of every radius error) moved
 * the crop on identical frames, and the needle then jumped several degrees.
 * Fractions are of the gauge radius, which is how the error scales in the
 * 188px search image. Centre and rotation are gated separately.
 * A centre shift inside the quiet band is ignored. A larger shift under
 * one tenth of the radius has to agree for three frames. A bigger centre
 * step follows the rim on its own. Rotation under one degree is ignored.
 * Rotation commits are whole profile bins, and the needle can veto them.
 */
const CENTRE_QUIET_FRACTION = 0.03;
const CENTRE_IMMEDIATE_FRACTION = 0.1;

/**
 * The guided centre is still this dial. Used only before a template exists,
 * when search cannot yet match a rotation.
 */
export function priorStillThere(found, localPrior) {
  if (!found.edges) return false;
  const score = scoreRim(
    found.edges,
    found.width,
    found.height,
    localPrior.cx,
    localPrior.cy,
    localPrior.radius,
  );
  if (score <= 1e-3) return false;
  if (!(found.score > 1e-3)) return true;
  const far = Math.hypot(found.cx - localPrior.cx, found.cy - localPrior.cy);
  if (far <= localPrior.radius * CENTRE_IMMEDIATE_FRACTION) return score >= found.score * 0.85;
  return score >= found.score;
}
const CENTRE_AGREE_FRACTION = 0.035;
const RADIUS_QUIET_FRACTION = 0.05;
const RADIUS_IMMEDIATE_FRACTION = 0.12;
const ROTATION_QUIET_DEG = 1;
const ROTATION_RIGID_DEG = 6;
const PROFILE_BIN_DEG = 360 / PROFILE_BINS;
const LOCKED_MAX_SHIFT_DEG = 18;
/** Narrow match reach after bin rounding. 18° lands on the 20° bin. */
const LOCKED_MATCH_LIMIT_DEG = Math.round(LOCKED_MAX_SHIFT_DEG / (360 / PROFILE_BINS)) * (360 / PROFILE_BINS);
const SEARCH_FRACTIONS = [0.9, 1.25, 1.6, 2];
/** Agreeing observations of one candidate, including the first. The third accepts. */
const SEARCH_CONFIRM_FRAMES = 3;
const SEARCH_LOSS_FRAMES = 3;
const SEARCH_MISS_LIMIT = 2;
const SEARCH_STEP_FRACTION = 0.4;
const SEARCH_RADIUS_FRACTION = 0.08;
const SEARCH_ROTATION_AGREE_DEG = 8;
const SEARCH_MAX_SHIFT_DEG = 60;
const SEARCH_ENTER_FRACTION = 0.35;
/**
 * One minor-tick period. A smaller search step can be a coarse but real
 * orientation. A step this large can also be the same ticks shifted by one period.
 */
const LARGE_ROTATION_DEG = 24;
/**
 * A centred, unobstructed dial correlates near 0.85. A one-period alias can
 * still reach the mid-0.6s when only part of the unique sector is hidden, but
 * the previous orientation then remains close, so the period gap stays small.
 */
const LARGE_ROTATION_CONFIDENCE = 0.62;
/** Gap from the best shift to the nearest shift one tick-period away. */
const LARGE_ROTATION_PERIOD_MARGIN = 0.12;
/** White-face annulus, inside the outer tick ring and clear of the black rim. */
const FACE_INNER_RATIO = 0.4;
const FACE_OUTER_RATIO = 0.6;
const FACE_AGREE_DEG = 8;
const FACE_SIGNAL_CONFIDENCE = 0.45;

function binIndex(deg) {
  if (deg == null || Number.isNaN(deg)) return null;
  return ((Math.round(wrap360(deg) / PROFILE_BIN_DEG) % PROFILE_BINS) + PROFILE_BINS) % PROFILE_BINS;
}

function wholeBins(deltaDeg) {
  return Math.round(deltaDeg / PROFILE_BIN_DEG);
}

/** Mean edge magnitude on the printed tick ring (generic dial cue). */
function scoreTickRingEnergy(edges, width, height, cx, cy, faceRadius) {
  if (!edges?.mag || faceRadius < 10) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < 48; i += 1) {
    const ang = (i / 48) * Math.PI * 2;
    const r = faceRadius * 0.95;
    const x = Math.round(cx + r * Math.cos(ang));
    const y = Math.round(cy + r * Math.sin(ang));
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
    sum += edges.mag[y * width + x];
    n += 1;
  }
  return n ? sum / n : 0;
}

function sampleLum(data, width, height, x, y) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= width || yi >= height) return 0;
  const o = (yi * width + xi) * 4;
  return data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
}

/** Bright/low-texture face vs darker bezel; tolerates shadow without per-clip tuning. */
export function scoreDialFaceInterior(data, width, height, cx, cy, faceRadius) {
  if (faceRadius < 10) return 0;
  const faceRadii = [faceRadius * 0.38, faceRadius * 0.55, faceRadius * 0.72];
  const mid = faceRadius * 0.55;
  const bezelInner = faceRadius * 0.9;
  const bezelOuter = faceRadius * 1.14;
  let faceSum = 0;
  let faceSq = 0;
  let faceN = 0;
  let bezelSum = 0;
  let bezelN = 0;
  let redHot = 0;
  let redN = 0;
  for (let a = 0; a < 36; a += 1) {
    const ang = (a / 36) * Math.PI * 2;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    for (const fr of faceRadii) {
      const lum = sampleLum(data, width, height, cx + fr * cos, cy + fr * sin);
      faceSum += lum;
      faceSq += lum * lum;
      faceN += 1;
    }
    for (let r = bezelInner; r <= bezelOuter; r += (bezelOuter - bezelInner) / 3) {
      const xi = Math.round(cx + r * cos);
      const yi = Math.round(cy + r * sin);
      if (xi < 0 || yi < 0 || xi >= width || yi >= height) continue;
      bezelSum += sampleLum(data, width, height, xi, yi);
      bezelN += 1;
    }
    const deg = (a / 36) * 360;
    if (deg >= 215 && deg <= 275) {
      const xi = Math.round(cx + mid * cos);
      const yi = Math.round(cy + mid * sin);
      if (xi >= 0 && yi >= 0 && xi < width && yi < height) {
        const off = (yi * width + xi) * 4;
        const rv = data[off];
        const gv = data[off + 1];
        const bv = data[off + 2];
        if (rv > 140 && rv > gv * 1.25 && rv > bv * 1.25) redHot += 1;
        redN += 1;
      }
    }
  }
  if (!faceN || !bezelN) return 0;
  const faceMean = faceSum / faceN;
  const bezelMean = bezelSum / bezelN;
  const signedContrast = (faceMean - bezelMean) / 255;
  const contrast = Math.abs(signedContrast);
  if (contrast < 0.05) return 0;
  const variance = Math.max(0, faceSq / faceN - faceMean * faceMean);
  const smooth = Math.exp(-variance / 2200);
  const red = redN ? redHot / redN : 0;
  const polarity = signedContrast >= 0 ? 1 : 0.78;
  return Math.min(1.6, (0.32 + contrast * 2.6) * smooth * (0.85 + red * 0.35) * polarity);
}

function scoreCanonicalDialMatch(edges, width, height, cx, cy, faceRadius, needleDeg = null) {
  if (!edges || faceRadius < 10) return 0;
  const profile = measureRimProfile(edges, width, height, cx, cy, faceRadius * 1.02);
  const faceProfile = measureRimProfile(edges, width, height, cx, cy, faceRadius * 0.55, {
    innerRatio: 0.35,
    outerRatio: 0.75,
  });
  const rim = matchGaugeRotation(FLAIR_CANONICAL_DIAL_PROFILE, profile, {
    previousDeg: 0,
    needleDeg,
    maxShiftDeg: 360,
  });
  const face = matchGaugeRotation(FLAIR_CANONICAL_FACE_PROFILE, faceProfile, {
    previousDeg: rim.estimateDeg ?? 0,
    needleDeg,
    maxShiftDeg: 24,
  });
  if (!rim.ok && rim.confidence < 0.2) return 0;
  const agree = face.ok
    ? 1 - Math.min(1, Math.abs(((rim.estimateDeg ?? 0) - (face.estimateDeg ?? 0) + 180) % 360 - 180) / 20)
    : 0.65;
  return rim.confidence * (0.55 + 0.45 * agree);
}

/** Generic dial size band as a fraction of the frame's short side. Not fitted to a clip. */
export const MIN_DISCOVERY_RADIUS_FRACTION = 0.03;
export const MAX_DISCOVERY_RADIUS_FRACTION = 0.5;
/** Whole-frame discovery cadence while a verified pose is held. */
export const REDISCOVER_EVERY_FRAMES = 24;
/**
 * Full-frame search while the dial is lost. Same cadence as a locked
 * rediscovery, so the slow frame stays under one tick in twenty and the
 * 95th percentile is the local needle search.
 */
const LOST_DISCOVERY_STRIDE = 24;
/**
 * Absolute orientation must beat the next distant alignment by this much.
 * A smaller gap means a lighting gradient or a tick-period alias, not the printed scale.
 */
export const REGISTRATION_PERIOD_MARGIN_MIN = 0.08;
const POSE_JUMP_FRACTION = 0.45;
const REDISCOVERY_MOVE_FRACTION = 0.35;

/**
 * Same face number discovery and the live tracker both gate on.
 * A dark Flair face often has almost no interior contrast, so the tick ring
 * can carry the score. The boost is relative to the frame, not a clip.
 */
export function combineDialFaceScore(faceRaw, tickEnergy, radius, frameMin) {
  const tickBoost = frameMin > 0 ? Math.min(1, radius / (frameMin * 0.08)) : 0;
  return Math.max(faceRaw || 0, Math.min(0.42, (tickEnergy || 0) * 0.14 * tickBoost));
}

/**
 * Locked frames already paid for a full needle read. The next two keep that
 * reading and only confirm the rim, so a phone is not doing a 360° scan on
 * every tick. A pose jump or a fresh discovery always reads the needle.
 */
export function shouldBridgeNeedle({
  reusePrior = false,
  framesSinceDiscovery = 0,
  held = false,
  poseDeltaPx = 0,
  radius = 0,
  hasBridge = false,
  discovering = false,
  stableStride = 3,
} = {}) {
  const stride = stableStride > 1 ? stableStride : 3;
  return Boolean(
    reusePrior
    && hasBridge
    && !discovering
    && !held
    && framesSinceDiscovery % stride !== 0
    && radius > 0
    && poseDeltaPx <= radius * 0.12
  );
}

export function verificationScore({ faceScore = 0, canonical = 0, confidence = 0 } = {}) {
  return (faceScore ?? 0) + 0.35 * (canonical ?? 0) + 0.15 * (confidence ?? 0);
}

export function discoveredVerifies(found) {
  return Boolean(found?.ok)
    && (found.dialFaceScore ?? 0) >= DIAL_FACE_VERIFY_MIN
    && (found.canonicalScore ?? 0) >= DIAL_CANONICAL_VERIFY_MIN;
}

/**
 * Decide whether a new whole-frame detection replaces the tracked pose.
 * A pose that fails dial-face verification is never kept.
 */
export function chooseDiscoveryUpdate({
  hasPose = false,
  faceScore = null,
  canonical = 0,
  confidence = 0,
  discovered = null,
  pose = null,
  printedFace = false,
} = {}) {
  const currentOk = hasPose && (faceScore == null || faceScore >= DIAL_FACE_VERIFY_MIN);
  const nextOk = discoveredVerifies(discovered);
  if (!currentOk) {
    // A locked scale survives a blurry frame. Dropping it would re-seed from
    // whatever circle the next search happens to like.
    if (printedFace && hasPose && !nextOk) {
      return { action: 'hold', reason: 'scale-locked' };
    }
    return nextOk
      ? { action: 'replace', reason: hasPose ? 'face-failed' : 'seed' }
      : { action: 'drop', reason: hasPose ? 'face-failed' : 'no-dial' };
  }
  if (!nextOk) return { action: 'hold', reason: 'discovery-weak' };
  const currentScore = verificationScore({ faceScore: faceScore ?? 0, canonical, confidence });
  const nextScore = verificationScore({
    faceScore: discovered.dialFaceScore,
    canonical: discovered.canonicalScore,
    confidence: discovered.confidence,
  });
  if (nextScore > currentScore + 0.02) {
    const far = pose
      && Math.hypot(discovered.cx - pose.cx, discovered.cy - pose.cy)
        > Math.max(pose.radius, discovered.radius) * REDISCOVERY_MOVE_FRACTION;
    if (!far) return { action: 'replace', reason: 'better' };
    // A face that has never matched the printed dial must not keep a clearly
    // better circle at a distance. A small edge still stays, so a decoy cannot
    // steal a pose that is already as good. A printed-face lock does not jump.
    if (!printedFace && nextScore > currentScore + 0.15) {
      return { action: 'replace', reason: 'better-far' };
    }
  }
  return { action: 'hold', reason: 'current-better' };
}

function discoveryRadiusInRange(faceRadius, scaledMin) {
  const rMin = scaledMin * MIN_DISCOVERY_RADIUS_FRACTION;
  const rMax = scaledMin * MAX_DISCOVERY_RADIUS_FRACTION;
  return faceRadius >= rMin && faceRadius <= rMax;
}

export function scoreDiscoveryCandidate({
  edges,
  data,
  width,
  height,
  cx,
  cy,
  faceRadius,
  needleDeg = null,
  scaledMin,
}) {
  const rim = scoreRim(edges, width, height, cx, cy, faceRadius * 1.02);
  const inRange = discoveryRadiusInRange(faceRadius, scaledMin);
  const faceRaw = inRange && rim > 0
    ? scoreDialFaceInterior(data, width, height, cx, cy, faceRadius)
    : 0;
  const tickEnergy = inRange && rim > 0
    ? scoreTickRingEnergy(edges, width, height, cx, cy, faceRadius)
    : 0;
  const face = combineDialFaceScore(faceRaw, tickEnergy, faceRadius, scaledMin);
  const canonical = inRange && rim > 0
    ? scoreCanonicalDialMatch(edges, width, height, cx, cy, faceRadius, needleDeg)
    : 0;
  const rank = inRange && rim > 0
    ? rim * (0.15 + 0.85 * face) * (0.12 + 0.88 * canonical)
    : 0;
  return { rim, face, faceRaw, tickEnergy, canonical, rank, inRange };
}

function discoveryCandidateOk({ rimScore, confidence, faceScore, canonicalScore, rankScore }) {
  if (rimScore <= 1e-3 || faceScore < DIAL_FACE_VERIFY_MIN) return false;
  if (canonicalScore < DIAL_CANONICAL_VERIFY_MIN) return false;
  return confidence >= CONFIDENCE_MIN
    || (faceScore >= DIAL_FACE_VERIFY_MIN + 0.08 && rankScore > rimScore * 0.14);
}

function readingGates({
  dialRegistered,
  confidence,
  dialFaceScore,
  needleLikeness,
  periodMargin = null,
}) {
  const orientationClear = periodMargin == null
    || periodMargin >= REGISTRATION_PERIOD_MARGIN_MIN;
  return dialRegistered === true
    && orientationClear
    && (confidence ?? 0) >= CONFIDENCE_MIN
    && (dialFaceScore ?? 0) >= DIAL_FACE_VERIFY_MIN
    && (needleLikeness ?? 0) >= NEEDLE_LIKENESS_GATE;
}

/**
 * A bar may be published once the printed scale and the needle are confident.
 * The rest anchor confirms that zero; it does not have to finish first.
 * A conflict still blocks the bar. The anchor never becomes the zero.
 */
export function gaugeAllowsReading({
  dialRegistered,
  confidence,
  dialFaceScore,
  needleLikeness,
  periodMargin = null,
  restAnchor = null,
}) {
  if (restAnchor === 'conflict') return false;
  return readingGates({
    dialRegistered,
    confidence,
    dialFaceScore,
    needleLikeness,
    periodMargin,
  });
}

export function gaugeAllowsConfidentReading({
  dialRegistered,
  confidence,
  dialFaceScore,
  needleLikeness,
  periodMargin = null,
  restAnchor = null,
}) {
  const anchorClear = restAnchor == null || restAnchor === 'confirmed';
  return anchorClear && readingGates({
    dialRegistered,
    confidence,
    dialFaceScore,
    needleLikeness,
    periodMargin,
  });
}

/**
 * Working resolution for Hough and the tick profile. Centres are scaled back
 * to the input image. The bound is there so discovery is not a full-frame
 * pixel loop; every frame uses the same scale.
 */
const DISCOVERY_MAX_OUTPUT = 240;

function buildDiscoveryFrameContext(image, maxOutput = DISCOVERY_MAX_OUTPUT) {
  const { width, height, data } = image;
  const minDim = Math.min(width, height);
  const scale = Math.min(1, maxOutput / minDim);
  const sw = Math.max(16, Math.round(width * scale));
  const sh = Math.max(16, Math.round(height * scale));
  const scaledMin = minDim * scale;
  const small = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const sy = Math.min(height - 1, Math.floor(y / scale));
      const src = (sy * width + sx) * 4;
      const dst = (y * sw + x) * 4;
      small[dst] = data[src];
      small[dst + 1] = data[src + 1];
      small[dst + 2] = data[src + 2];
      small[dst + 3] = 255;
    }
  }
  const edges = prepareEdges({ data: small, width: sw, height: sh }, { contrastRadius: 3 }).edges;
  return { width, height, scale, sw, sh, scaledMin, small, edges };
}

function pushDiscoveryCandidate(candidates, entry) {
  candidates.push(entry);
}

// Face is capped at 1.6 and canonical at 1, so rank cannot exceed rim times this.
const DISCOVERY_RANK_RIM_CEILING = (0.15 + 0.85 * 1.6) * (0.12 + 0.88 * 1) + 0.01;
let houghBlurSize = null;
let houghGray = null;

function collectHoughCircleCandidates(ctx, cv, candidates) {
  const { sw, sh, scaledMin, small, edges, scale } = ctx;
  let srcMat = null;
  let circles = null;
  let houghCount;
  try {
    srcMat = cv.matFromImageData({ data: small, width: sw, height: sh });
    if (!houghGray) houghGray = new cv.Mat();
    cv.cvtColor(srcMat, houghGray, cv.COLOR_RGBA2GRAY);
    if (!houghBlurSize) houghBlurSize = new cv.Size(5, 5);
    cv.GaussianBlur(houghGray, houghGray, houghBlurSize, 1.4, 1.4, cv.BORDER_DEFAULT);

    circles = new cv.Mat();
    const rMin = Math.max(6, scaledMin * MIN_DISCOVERY_RADIUS_FRACTION);
    const rMax = scaledMin * MAX_DISCOVERY_RADIUS_FRACTION;
    const minDist = Math.max(12, scaledMin * 0.08);
    cv.HoughCircles(
      houghGray,
      circles,
      cv.HOUGH_GRADIENT,
      1.1,
      minDist,
      95,
      22,
      Math.round(rMin),
      Math.round(rMax),
    );
    houghCount = circles.cols;
    const partials = [];
    for (let i = 0; i < circles.cols; i += 1) {
      const cx = circles.floatAt(0, i * 3);
      const cy = circles.floatAt(0, i * 3 + 1);
      const r = circles.floatAt(0, i * 3 + 2);
      const variants = [r / 1.02, (r / 1.02) * 0.96, (r / 1.02) * 1.04];
      for (const faceRadius of variants) {
        if (faceRadius < scaledMin * MIN_DISCOVERY_RADIUS_FRACTION) continue;
        const rimRadius = faceRadius * 1.02;
        if (cx - rimRadius < 2 || cy - rimRadius < 2 || cx + rimRadius >= sw - 2 || cy + rimRadius >= sh - 2) continue;
        const rim = scoreRim(edges, sw, sh, cx, cy, rimRadius);
        if (rim <= 1e-3) continue;
        partials.push({ cx, cy, faceRadius, rimRadius, rim });
      }
    }
    partials.sort((a, b) => b.rim - a.rim);
    let bestRank = 0;
    for (const partial of partials) {
      if (partial.rim * DISCOVERY_RANK_RIM_CEILING <= bestRank) break;
      const scored = scoreDiscoveryCandidate({
        edges,
        data: small,
        width: sw,
        height: sh,
        cx: partial.cx,
        cy: partial.cy,
        faceRadius: partial.faceRadius,
        scaledMin,
      });
      if (scored.rank > bestRank) bestRank = scored.rank;
      const off = offsetScore(edges, sw, sh, partial.cx, partial.cy, partial.rimRadius);
      const confidence = scored.rim > 1e-3 && off != null
        ? clamp((scored.rim - off) / scored.rim, 0, 1)
        : 0;
      const ok = discoveryCandidateOk({
        rimScore: scored.rim,
        confidence,
        faceScore: scored.face,
        canonicalScore: scored.canonical,
        rankScore: scored.rank,
      });
      pushDiscoveryCandidate(candidates, {
        source: 'hough',
        cx: partial.cx / scale,
        cy: partial.cy / scale,
        radius: partial.faceRadius / scale,
        cxScaled: partial.cx,
        cyScaled: partial.cy,
        radiusScaled: partial.faceRadius,
        ...scored,
        confidence,
        ok,
      });
    }
  } finally {
    if (circles) circles.delete();
    if (srcMat) srcMat.delete();
  }
  return houghCount;
}

/**
 * Pick the circle to seed.
 * Rank is rim × face × canonical template match. A bright hotspot, a hose,
 * or a hand can outrank the dial on rim alone and still fail the template
 * gate. Those misses do not hide a lower circle that does match the printed
 * face. Among circles that pass, the highest rank wins.
 */
export function selectDiscoveryCandidate(candidates) {
  let best = null;
  for (const candidate of candidates || []) {
    if (!candidate?.ok) continue;
    if (!best || (candidate.rank || 0) > (best.rank || 0)) best = candidate;
  }
  return best;
}

/**
 * A coarse winner whose template dies on the original pixels is a hotspot or
 * a bezel edge. Keep it when the native check still passes. Otherwise take
 * the sharpest nearby circle that does pass, so a soft rim cannot hide the face.
 */
export function chooseReadableDiscovery(chosen, examined) {
  if (!chosen) return null;
  const self = (examined || []).find((item) => item?.candidate === chosen);
  // A coarse winner whose printed face still matches on the original pixels
  // stays, even when that crop is soft. Replacing it with a sharper neighbour
  // walks a dry dial off its needle.
  if (self?.nativeOk) return chosen;
  const alternatives = (examined || []).filter((item) => item?.nativeOk && item.candidate && item.candidate !== chosen);
  if (!alternatives.length) return chosen;
  alternatives.sort((a, b) => (b.sharpness || 0) - (a.sharpness || 0) || (b.canonical || 0) - (a.canonical || 0));
  return alternatives[0].candidate;
}

/**
 * Working-image radius at which the tick ring is a few pixels wide.
 * Scales are added until a dial at the small end of the generic radius
 * band reaches this size. A scale that already verifies a dial is the
 * answer: a later full-frame search must not replace it with a different
 * circle, and it must not run when this one is already in hand.
 */
export const TICK_READABLE_RADIUS_PX = 28;

/**
 * Coarse-to-fine working sizes for whole-frame search.
 * The short side starts at the usual 240px budget. Another octave is added
 * while the smallest dial the generic radius band allows is still smaller
 * than the tick ring needs, and stops at the native short side.
 */
export function discoveryOutputSizes(minDim) {
  const outputs = [];
  if (!(minDim > 0)) return outputs;
  let maxOutput = DISCOVERY_MAX_OUTPUT;
  for (let level = 0; level < 3; level += 1) {
    const capped = Math.max(16, Math.min(minDim, Math.round(maxOutput)));
    if (!outputs.length || capped > outputs[outputs.length - 1] + 1) outputs.push(capped);
    const scale = Math.min(1, capped / minDim);
    const smallestWorking = minDim * MIN_DISCOVERY_RADIUS_FRACTION * scale;
    if (smallestWorking >= TICK_READABLE_RADIUS_PX || capped >= minDim - 1) break;
    maxOutput = capped * 2;
  }
  return outputs;
}

/**
 * Debug / harness: enumerate Hough + scored candidates in image pixel space.
 * @returns {Promise<{ candidates: object[], chosen: object|null, houghCount: number, scale: number }>}
 */
export function probeGaugeDiscoveryCandidates(image, cv = null) {
  const cvInst = cv ?? getOpenCvSync();
  const ctx = buildDiscoveryFrameContext(image);
  const candidates = [];
  let houghCount = 0;
  if (cvInst?.Mat) {
    houghCount = collectHoughCircleCandidates(ctx, cvInst, candidates);
  }
  const chosen = selectDiscoveryCandidate(candidates);
  return {
    candidates,
    chosen,
    houghCount,
    scale: ctx.scale,
    scaledWidth: ctx.sw,
    scaledHeight: ctx.sh,
  };
}

function discoveryResultFromBest(best, scale, minDim) {
  if (!best || best.score <= 0) return null;
  if (best.radius / scale < minDim * MIN_DISCOVERY_RADIUS_FRACTION) return null;
  const rimR = best.radius * 1.02;
  const off = offsetScore(best.edges, best.sw, best.sh, best.cx, best.cy, rimR);
  const confidence = best.rim > 1e-3 && off != null
    ? clamp((best.rim - off) / best.rim, 0, 1)
    : 0;
  const ok = discoveryCandidateOk({
    rimScore: best.rim,
    confidence,
    faceScore: best.face,
    canonicalScore: best.canonical,
    rankScore: best.score,
  });
  return {
    ok,
    confidence,
    cx: best.cx / scale,
    cy: best.cy / scale,
    radius: best.radius / scale,
    dialFaceScore: best.face,
    canonicalScore: best.canonical,
    source: best.source ?? 'rim-grid',
  };
}

function resultFromChosen(chosen) {
  return {
    ok: chosen.ok === true,
    confidence: chosen.confidence ?? 0,
    cx: chosen.cx,
    cy: chosen.cy,
    radius: chosen.radius,
    dialFaceScore: chosen.face,
    canonicalScore: chosen.canonical,
    source: 'opencv-hough',
  };
}

function discoverGaugeWithOpenCv(image, cv) {
  if (!image?.width || !image?.data || !cv?.Mat) return null;
  const minDim = Math.min(image.width, image.height);
  const outputs = discoveryOutputSizes(minDim);
  for (let level = 0; level < outputs.length; level += 1) {
    const ctx = buildDiscoveryFrameContext(image, outputs[level]);
    const candidates = [];
    collectHoughCircleCandidates(ctx, cv, candidates);
    const chosen = selectDiscoveryCandidate(candidates);
    if (!chosen?.ok) continue;
    if (chosen.radius < minDim * MIN_DISCOVERY_RADIUS_FRACTION) continue;
    // Image radius is already scaled back from this working size. A verified
    // dial here is tracked from that circle. Another octave runs only when
    // this scale does not verify one, which is how a small dial missed by
    // the coarse Hough is still found. Re-scoring that winner on a native
    // crop changes which frame the worker finishes on, and a moving clip
    // then locks a different circle from run to run.
    return resultFromChosen(chosen);
  }
  return null;
}

/**
 * Whole-frame rim search on a downscaled frame (no prior / guide seed).
 * Returns centre and radius in the same pixel space as `image`.
 */
export function discoverGaugeInFrame(image, { maxOutput = 240 } = {}) {
  const { width, height, data } = image;
  if (!width || !height || !data) return null;
  const cv = getOpenCvSync();
  if (cv?.Mat) {
    const opencvHit = discoverGaugeWithOpenCv(image, cv);
    if (opencvHit?.ok) return opencvHit;
    return null;
  }
  const minDim = Math.min(width, height);
  const scale = Math.min(1, maxOutput / minDim);
  const sw = Math.max(16, Math.round(width * scale));
  const sh = Math.max(16, Math.round(height * scale));
  const small = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const sy = Math.min(height - 1, Math.floor(y / scale));
      const src = (sy * width + sx) * 4;
      const dst = (y * sw + x) * 4;
      small[dst] = data[src];
      small[dst + 1] = data[src + 1];
      small[dst + 2] = data[src + 2];
      small[dst + 3] = 255;
    }
  }
  const edges = prepareEdges({ data: small, width: sw, height: sh }, { contrastRadius: 3 }).edges;
  const scaledMin = minDim * scale;
  const rMin = scaledMin * MIN_DISCOVERY_RADIUS_FRACTION;
  const rMax = scaledMin * MAX_DISCOVERY_RADIUS_FRACTION;
  const coarseStep = Math.max(4, Math.round(scaledMin / 24));
  let best = { score: -1, rim: 0, face: 0, canonical: 0, cx: 0, cy: 0, radius: 0, edges, sw, sh };
  const consider = (cx, cy, faceRadius) => {
    if (faceRadius < scaledMin * MIN_DISCOVERY_RADIUS_FRACTION) return;
    const rimRadius = faceRadius * 1.02;
    if (cx - rimRadius < 2 || cy - rimRadius < 2 || cx + rimRadius >= sw - 2 || cy + rimRadius >= sh - 2) return;
    const scored = scoreDiscoveryCandidate({
      edges,
      data: small,
      width: sw,
      height: sh,
      cx,
      cy,
      faceRadius,
      scaledMin,
    });
    if (scored.rank > best.score) {
      best = {
        score: scored.rank,
        rim: scored.rim,
        face: scored.face,
        canonical: scored.canonical,
        cx,
        cy,
        radius: faceRadius,
        edges,
        sw,
        sh,
        source: 'rim-grid',
      };
    }
  };
  for (let cy = coarseStep; cy < sh - coarseStep; cy += coarseStep) {
    for (let cx = coarseStep; cx < sw - coarseStep; cx += coarseStep) {
      const rStep = Math.max(3, Math.round(coarseStep * 0.85));
      for (let r = rMin; r <= rMax; r += rStep) consider(cx, cy, r);
    }
  }
  if (best.score <= 0) return null;
  const midStep = Math.max(2, Math.round(coarseStep / 2));
  const coarse = best;
  for (let dy = -coarseStep; dy <= coarseStep; dy += midStep) {
    for (let dx = -coarseStep; dx <= coarseStep; dx += midStep) {
      consider(coarse.cx + dx, coarse.cy + dy, coarse.radius);
      consider(coarse.cx + dx, coarse.cy + dy, coarse.radius * 0.94);
      consider(coarse.cx + dx, coarse.cy + dy, coarse.radius * 1.06);
    }
  }
  if (best.score <= 0) return null;
  const refine = Math.max(2, midStep);
  const fine = best;
  for (let dy = -refine; dy <= refine; dy += 1) {
    for (let dx = -refine; dx <= refine; dx += 1) {
      consider(fine.cx + dx, fine.cy + dy, fine.radius);
      consider(fine.cx + dx, fine.cy + dy, fine.radius * 0.97);
      consider(fine.cx + dx, fine.cy + dy, fine.radius * 1.03);
    }
  }
  return discoveryResultFromBest(best, scale, minDim);
}

export function createGaugeTracker() {
  let pose = null;
  let baseRadius = 0;
  let reference = null;
  let referenceFace = null;
  let observedFace = null;
  let referenceNeedleDeg = null;
  let recovering = false;
  let centreCandidate = null;
  let radiusCandidate = null;
  let rotationCandidate = null;
  let pendingStepBins = null;
  let anchorRotationDeg = 0;
  let anchorAccumDeg = 0;
  let trustedRotationDeg = null;
  let maskNeedleDeg = null;
  let bridgedReading = null;
  let idleFrames = 0;
  let mode = 'locked';
  let lossStreak = 0;
  let searchStep = 0;
  let searchFraction = SEARCH_FRACTIONS[0];
  let searchCandidate = null;
  let searchMisses = 0;
  let reacquireReason = null;
  let observed = null;
  let framesSinceDiscovery = 0;
  let lastFaceScore = null;
  let lastCanonical = null;
  let pendingJump = false;
  let printedFace = false;
  let scaleLock = null;

  const clearVerification = () => {
    framesSinceDiscovery = 0;
    lastFaceScore = null;
    lastCanonical = null;
    pendingJump = false;
    printedFace = false;
    bridgedReading = null;
    idleFrames = 0;
    scaleLock = null;
  };

  const clearPoseMemory = () => {
    centreCandidate = null;
    radiusCandidate = null;
    rotationCandidate = null;
    pendingStepBins = null;
    anchorRotationDeg = 0;
    anchorAccumDeg = 0;
    trustedRotationDeg = null;
    maskNeedleDeg = null;
  };

  const clearSearch = () => {
    mode = 'locked';
    lossStreak = 0;
    searchStep = 0;
    searchFraction = SEARCH_FRACTIONS[0];
    searchCandidate = null;
    searchMisses = 0;
    reacquireReason = null;
    observed = null;
  };

  const beginSearch = () => {
    if (mode === 'searching') return;
    mode = 'searching';
    searchStep = 0;
    searchFraction = SEARCH_FRACTIONS[0];
  };

  const growSearch = () => {
    if (mode !== 'searching' || searchCandidate) return;
    searchStep = Math.min(searchStep + 1, SEARCH_FRACTIONS.length - 1);
    searchFraction = SEARCH_FRACTIONS[searchStep];
  };

  const finish = (windowFraction, fields) => {
    const shown = observed || (reacquireReason ? searchCandidate : null);
    return {
      held: false,
      confidence: 0,
      pose: pose ? { ...pose } : null,
      profile: null,
      reacquired: false,
      rawCx: null,
      rawCy: null,
      rawRadius: null,
      poseQuality: null,
      poseRejectReason: null,
      posePending: false,
      poseDeltaPx: 0,
      trackMode: mode,
      searchFraction: windowFraction,
      reacquireCx: shown?.cx ?? null,
      reacquireCy: shown?.cy ?? null,
      reacquireRadius: shown?.radius ?? null,
      reacquireRotation: shown?.rotationDeg ?? null,
      reacquireQuality: shown?.quality ?? null,
      reacquireHits: searchCandidate?.hits ?? 0,
      reacquireRejectReason: reacquireReason,
      reacquireAccepted: false,
      ...fields,
    };
  };

  const toVideo = (found, mapping) => ({
    cx: mapping.originX + found.cx / mapping.scale,
    cy: mapping.originY + found.cy / mapping.scale,
    radius: found.radius / mapping.scale,
  });

  const wideMatch = (found) => {
    if (!reference || !found.edges) return null;
    const profile = measureRimProfile(
      found.edges,
      found.width,
      found.height,
      found.cx,
      found.cy,
      found.radius,
    );
    const orientation = {
      previousDeg: pose.rotationDeg,
      needleDeg: maskNeedleDeg,
      referenceNeedleDeg,
      maxShiftDeg: SEARCH_MAX_SHIFT_DEG,
    };
    let face = null;
    if (referenceFace) {
      const faceProfile = measureRimProfile(
        found.edges,
        found.width,
        found.height,
        found.cx,
        found.cy,
        found.radius,
        { innerRatio: FACE_INNER_RATIO, outerRatio: FACE_OUTER_RATIO },
      );
      face = matchGaugeRotation(referenceFace, faceProfile, orientation);
    }
    return {
      profile,
      face,
      // Last accepted rotation, not the uncommitted candidate. A candidate
      // at the edge of this window must not become the next centre.
      ...matchGaugeRotation(reference, profile, orientation),
    };
  };

  /**
   * Three repeats of a tick-period alias are still the same ambiguity.
   * A large step is accepted only when the outer ring is uniquely this dial,
   * and the white-face profile agrees when that face actually has structure.
   */
  const largeRotationSupported = (wide) => {
    const step = Math.abs(wrapDelta(pose.rotationDeg, wide.estimateDeg));
    if (step <= LARGE_ROTATION_DEG) return true;
    if (wide.confidence < LARGE_ROTATION_CONFIDENCE) return false;
    if ((wide.periodMargin ?? 0) < LARGE_ROTATION_PERIOD_MARGIN) return false;
    const face = wide.face;
    if (face && face.ok && face.confidence >= FACE_SIGNAL_CONFIDENCE) {
      if (Math.abs(wrapDelta(wide.estimateDeg, face.estimateDeg)) > FACE_AGREE_DEG) return false;
    }
    return true;
  };

  const considerCandidate = (video, wide) => {
    observed = {
      cx: video.cx,
      cy: video.cy,
      radius: video.radius,
      rotationDeg: wide?.estimateDeg ?? pose.rotationDeg,
      quality: wide?.confidence ?? 0,
    };
    const rotationFromPose = wide
      ? Math.abs(wrapDelta(pose.rotationDeg, wide.estimateDeg))
      : SEARCH_MAX_SHIFT_DEG;
    // The ±60° bin is the search clamp. A peak sitting on it is not a
    // confirmed rotation; it is the nearest legal shift to something further.
    const rotationInRange = wide?.ok && rotationFromPose < SEARCH_MAX_SHIFT_DEG;
    if (!rotationInRange) {
      reacquireReason = reference ? 'reacquire-dial' : 'reacquire-weak';
      searchMisses += 1;
      if (searchMisses >= SEARCH_MISS_LIMIT) {
        searchCandidate = null;
        searchMisses = 0;
      }
      return false;
    }
    if (!largeRotationSupported(wide)) {
      reacquireReason = 'reacquire-ambiguous';
      searchCandidate = null;
      searchMisses = 0;
      return false;
    }
    searchMisses = 0;
    const proposal = {
      cx: video.cx,
      cy: video.cy,
      radius: video.radius,
      rotationDeg: wide.estimateDeg,
      quality: wide.confidence,
    };
    if (searchCandidate) {
      const step = Math.hypot(proposal.cx - searchCandidate.cx, proposal.cy - searchCandidate.cy);
      const radiusStep = Math.abs(proposal.radius - searchCandidate.radius);
      const rotStep = Math.abs(wrapDelta(searchCandidate.rotationDeg, proposal.rotationDeg));
      if (
        step > pose.radius * SEARCH_STEP_FRACTION
        || radiusStep > pose.radius * SEARCH_RADIUS_FRACTION
        || rotStep > SEARCH_ROTATION_AGREE_DEG
      ) {
        searchCandidate = { ...proposal, hits: 1 };
        reacquireReason = 'reacquire-unstable';
        return false;
      }
      searchCandidate = { ...proposal, hits: searchCandidate.hits + 1 };
    } else {
      searchCandidate = { ...proposal, hits: 1 };
    }
    if (searchCandidate.hits >= SEARCH_CONFIRM_FRAMES) {
      reacquireReason = null;
      return true;
    }
    reacquireReason = 'reacquire-pending';
    return false;
  };

  const acceptCandidate = (found, video, wide, mapping, windowFraction) => {
    const beforeCx = pose.cx;
    const beforeCy = pose.cy;
    const hits = searchCandidate?.hits ?? SEARCH_CONFIRM_FRAMES;
    pose = {
      cx: video.cx,
      cy: video.cy,
      radius: clamp(video.radius, baseRadius * 0.82, baseRadius * 1.2),
      rotationDeg: wide.estimateDeg,
    };
    trustedRotationDeg = wide.estimateDeg;
    anchorRotationDeg = wide.estimateDeg;
    anchorAccumDeg = 0;
    rotationCandidate = null;
    pendingStepBins = null;
    const profile = wide.profile || measureRimProfile(
      found.edges,
      found.width,
      found.height,
      (pose.cx - mapping.originX) * mapping.scale,
      (pose.cy - mapping.originY) * mapping.scale,
      pose.radius * mapping.scale,
    );
    clearSearch();
    recovering = false;
    observed = {
      cx: video.cx,
      cy: video.cy,
      radius: video.radius,
      rotationDeg: wide.estimateDeg,
      quality: wide.confidence,
    };
    return finish(windowFraction, {
      held: false,
      confidence: found.confidence,
      profile,
      reacquired: true,
      reacquireAccepted: true,
      reacquireHits: hits,
      rawCx: video.cx,
      rawCy: video.cy,
      rawRadius: video.radius,
      poseQuality: wide.confidence,
      poseDeltaPx: Math.hypot(pose.cx - beforeCx, pose.cy - beforeCy),
    });
  };

  const noteLockedMiss = () => {
    observed = null;
    lossStreak += 1;
    if (lossStreak >= SEARCH_LOSS_FRAMES) {
      beginSearch();
      reacquireReason = 'reacquire-none';
    }
  };

  const noteSearchMiss = () => {
    observed = null;
    reacquireReason = 'reacquire-none';
    searchMisses += 1;
    if (searchMisses >= SEARCH_MISS_LIMIT) {
      searchCandidate = null;
      searchMisses = 0;
    }
    growSearch();
  };

  return {
    reset() {
      pose = null;
      baseRadius = 0;
      reference = null;
      referenceFace = null;
      observedFace = null;
      referenceNeedleDeg = null;
      recovering = false;
      clearPoseMemory();
      clearSearch();
      clearVerification();
    },
    seed({ cx, cy, radius }) {
      pose = { cx, cy, radius, rotationDeg: 0 };
      baseRadius = radius;
      reference = null;
      referenceFace = null;
      observedFace = null;
      referenceNeedleDeg = null;
      recovering = false;
      clearPoseMemory();
      clearSearch();
      clearVerification();
    },
    nudgePose({ cx, cy, radius }) {
      if (!pose) return;
      pose = { ...pose, cx, cy, radius };
      baseRadius = radius;
    },
    discoveryDueNow() {
      if (!pose) return idleFrames % LOST_DISCOVERY_STRIDE === 0;
      if (pendingJump) return true;
      if (lastFaceScore != null && lastFaceScore < DIAL_FACE_VERIFY_MIN) {
        return idleFrames % LOST_DISCOVERY_STRIDE === 0;
      }
      return framesSinceDiscovery >= REDISCOVER_EVERY_FRAMES;
    },
    needsRediscovery() {
      const due = this.discoveryDueNow();
      if (!pose) idleFrames += 1;
      else if (pendingJump) {
        // A jump is due immediately and does not advance the idle counter.
      } else if (lastFaceScore != null && lastFaceScore < DIAL_FACE_VERIFY_MIN) idleFrames += 1;
      else idleFrames = 0;
      return due;
    },
    verificationState() {
      return {
        hasPose: pose != null,
        faceScore: lastFaceScore,
        canonical: lastCanonical ?? 0,
        confidence: 0,
        framesSinceDiscovery,
        pendingJump,
        printedFace,
      };
    },
    notePrintedFace(ok) {
      if (ok) printedFace = true;
    },
    markDiscovered() {
      framesSinceDiscovery = 0;
      pendingJump = false;
    },
    rememberBridge(reading) {
      bridgedReading = reading ? { ...reading, gauge: { ...reading.gauge } } : null;
    },
    peekBridge() {
      return bridgedReading;
    },
    needleHint() {
      if (framesSinceDiscovery % REDISCOVER_EVERY_FRAMES === 0) return null;
      const angle = bridgedReading?.angleDeg;
      return Number.isFinite(angle) ? angle : null;
    },
    noteTrackedFrame({ faceScore, canonical = null, poseJumpPx = 0, radius = 0 }) {
      lastFaceScore = faceScore;
      if (canonical != null) lastCanonical = canonical;
      framesSinceDiscovery += 1;
      pendingJump = radius > 0 && poseJumpPx > radius * POSE_JUMP_FRACTION;
    },
    getPose() {
      return pose ? { ...pose } : null;
    },
    snapshot() {
      return {
        mode,
        lossStreak,
        hasReference: reference != null,
        pose: pose
          ? {
            cx: pose.cx,
            cy: pose.cy,
            radius: pose.radius,
            rotationDeg: pose.rotationDeg,
          }
          : null,
      };
    },
    setRotationDeg(rotationDeg) {
      if (!pose) return;
      pose = { ...pose, rotationDeg: wrap360(rotationDeg) };
    },
    getScaleLock() {
      return scaleLock;
    },
    setScaleLock(lock) {
      scaleLock = lock;
    },
    captureSpec() {
      if (mode !== 'searching') return { pad: 1.9, maxOutput: 188 };
      return { pad: 1 + searchFraction + 0.45, maxOutput: 320 };
    },
    /**
     * @param mapping image pixel = (video pixel - origin) * scale
     */
    trackPosition(image, mapping, { reusePrior = false } = {}) {
      if (!pose) return null;
      reacquireReason = null;
      observed = null;
      observedFace = null;
      const localPrior = {
        cx: (pose.cx - mapping.originX) * mapping.scale,
        cy: (pose.cy - mapping.originY) * mapping.scale,
        radius: pose.radius * mapping.scale,
      };
      let windowFraction;
      let found;
      const withRimProfile = (fields) => {
        if (fields.profile != null || !found?.edges) return fields;
        return {
          ...fields,
          profile: measureRimProfile(
            found.edges,
            found.width,
            found.height,
            found.cx,
            found.cy,
            found.radius,
          ),
        };
      };
      if (mode === 'searching') {
        const scout = locateGauge(image, localPrior, { priorOnly: true });
        if (scout.ok) {
          clearSearch();
          recovering = false;
          windowFraction = 0.46;
          found = scout;
        } else {
          windowFraction = searchFraction;
          found = locateGauge(image, localPrior, {
            searchFraction: windowFraction,
            edges: scout.edges,
          });
          // No dial template yet. A competitive guided rim leaves search so
          // the locked updater can capture one. Later reacquisition still
          // has to match the dial.
          if (!reference && found.ok && priorStillThere(found, localPrior)) {
            clearSearch();
            recovering = false;
          }
        }
      } else if (reusePrior && !recovering) {
        windowFraction = 0.46;
        const scout = locateGauge(image, localPrior, { priorOnly: true });
        found = scout.ok
          ? scout
          : locateGauge(image, localPrior, { searchFraction: windowFraction, edges: scout.edges });
      } else {
        windowFraction = recovering ? 0.62 : 0.46;
        found = locateGauge(image, localPrior, { searchFraction: windowFraction });
      }
      if (mode === 'searching') {
        if (!found.ok) {
          noteSearchMiss();
          return finish(windowFraction, withRimProfile({
            held: true,
            confidence: found.confidence,
            rawCx: mapping.originX + found.cx / mapping.scale,
            rawCy: mapping.originY + found.cy / mapping.scale,
            rawRadius: found.radius / mapping.scale,
          }));
        }
        const video = toVideo(found, mapping);
        const wide = wideMatch(found);
        if (considerCandidate(video, wide)) {
          return acceptCandidate(found, video, wide, mapping, windowFraction);
        }
        if (!searchCandidate) growSearch();
        return finish(windowFraction, withRimProfile({
          held: true,
          confidence: found.confidence,
          rawCx: video.cx,
          rawCy: video.cy,
          rawRadius: video.radius,
        }));
      }
      if (!found.ok) {
        recovering = true;
        noteLockedMiss();
        return finish(windowFraction, withRimProfile({
          held: true,
          confidence: found.confidence,
          poseRejectReason: 'rim-weak',
        }));
      }
      const video = toVideo(found, mapping);
      const dx = video.cx - pose.cx;
      const dy = video.cy - pose.cy;
      const shift = Math.hypot(dx, dy);
      if (shift > pose.radius * 0.5 && found.confidence < 0.55) {
        recovering = true;
        centreCandidate = null;
        radiusCandidate = null;
        const wide = wideMatch(found);
        if (considerCandidate(video, wide)) {
          return acceptCandidate(found, video, wide, mapping, windowFraction);
        }
        beginSearch();
        return finish(windowFraction, withRimProfile({
          held: true,
          confidence: found.confidence,
          rawCx: video.cx,
          rawCy: video.cy,
          rawRadius: video.radius,
          poseRejectReason: 'centre-rejected',
        }));
      }

      let dial = null;
      if (reference && found.edges) {
        const candidateProfile = measureRimProfile(
          found.edges,
          found.width,
          found.height,
          found.cx,
          found.cy,
          found.radius,
        );
        dial = matchGaugeRotation(reference, candidateProfile, {
          previousDeg: pose.rotationDeg,
          needleDeg: maskNeedleDeg,
          referenceNeedleDeg,
          maxShiftDeg: 18,
        });
      }
      const dialOk = Boolean(dial?.ok);
      const unrecognized = Boolean(reference) && !dialOk;
      const quiet = Math.max(1.25, pose.radius * CENTRE_QUIET_FRACTION);
      const immediate = pose.radius * CENTRE_IMMEDIATE_FRACTION;
      const beforeCx = pose.cx;
      const beforeCy = pose.cy;
      let poseRejectReason = null;
      let posePending = false;
      if (unrecognized && shift >= immediate) {
        const wide = wideMatch(found);
        if (considerCandidate(video, wide)) {
          return acceptCandidate(found, video, wide, mapping, windowFraction);
        }
        lossStreak += 1;
        if (shift >= pose.radius * SEARCH_ENTER_FRACTION || lossStreak >= SEARCH_LOSS_FRAMES) {
          beginSearch();
        }
        return finish(windowFraction, withRimProfile({
          held: true,
          confidence: found.confidence,
          rawCx: video.cx,
          rawCy: video.cy,
          rawRadius: video.radius,
          poseQuality: dial?.confidence ?? null,
          poseRejectReason: 'dial-unrecognized',
          posePending: true,
          poseDeltaPx: 0,
        }));
      }

      let nextCx = pose.cx;
        let nextCy = pose.cy;
        if (shift >= immediate) {
          nextCx = pose.cx + 0.85 * dx;
          nextCy = pose.cy + 0.85 * dy;
          centreCandidate = null;
        } else if (shift >= quiet) {
          const agree = pose.radius * CENTRE_AGREE_FRACTION;
          if (centreCandidate && Math.hypot(video.cx - centreCandidate.cx, video.cy - centreCandidate.cy) <= agree) {
            centreCandidate = { cx: video.cx, cy: video.cy, hits: centreCandidate.hits + 1 };
          } else {
            centreCandidate = { cx: video.cx, cy: video.cy, hits: 1 };
          }
          if (centreCandidate.hits >= 3) {
            nextCx = pose.cx + 0.6 * (centreCandidate.cx - pose.cx);
            nextCy = pose.cy + 0.6 * (centreCandidate.cy - pose.cy);
            centreCandidate = null;
          }
        } else {
          centreCandidate = null;
        }

        const radiusDelta = video.radius - pose.radius;
        const radiusQuiet = pose.radius * RADIUS_QUIET_FRACTION;
        const radiusImmediate = pose.radius * RADIUS_IMMEDIATE_FRACTION;
        let nextRadius = pose.radius;
        if (Math.abs(radiusDelta) >= radiusImmediate) {
          nextRadius = clamp(pose.radius + 0.45 * radiusDelta, baseRadius * 0.82, baseRadius * 1.2);
          radiusCandidate = null;
        } else if (Math.abs(radiusDelta) >= radiusQuiet) {
          if (radiusCandidate != null && Math.abs(video.radius - radiusCandidate) <= radiusQuiet) {
            nextRadius = clamp(pose.radius + 0.4 * radiusDelta, baseRadius * 0.82, baseRadius * 1.2);
            radiusCandidate = null;
          } else {
            radiusCandidate = video.radius;
          }
        } else {
          radiusCandidate = null;
        }
        pose = {
          cx: nextCx,
          cy: nextCy,
          radius: nextRadius,
          rotationDeg: pose.rotationDeg,
        };

      recovering = false;
      lossStreak = 0;
      searchMisses = 0;
      searchCandidate = null;
      reacquireReason = null;
      observed = null;
      mode = 'locked';
      const profile = measureRimProfile(
        found.edges,
        found.width,
        found.height,
        (pose.cx - mapping.originX) * mapping.scale,
        (pose.cy - mapping.originY) * mapping.scale,
        pose.radius * mapping.scale,
      );
      observedFace = measureRimProfile(
        found.edges,
        found.width,
        found.height,
        (pose.cx - mapping.originX) * mapping.scale,
        (pose.cy - mapping.originY) * mapping.scale,
        pose.radius * mapping.scale,
        { innerRatio: FACE_INNER_RATIO, outerRatio: FACE_OUTER_RATIO },
      );
      return finish(windowFraction, {
        held: false,
        confidence: found.confidence,
        profile,
        reacquired: false,
        rawCx: video.cx,
        rawCy: video.cy,
        rawRadius: video.radius,
        poseQuality: dial?.confidence ?? null,
        poseRejectReason,
        posePending,
        poseDeltaPx: Math.hypot(pose.cx - beforeCx, pose.cy - beforeCy),
      });
    },
    trackOrientation(profile, needleDeg, {
      positionHeld = false,
      needleLikeness = null,
      rimConfidence = null,
      needleQuality = null,
    } = {}) {
      const trusted = trustedRotationDeg;
      trustedRotationDeg = null;
      const rememberNeedle = () => {
        if (needleDeg == null) return;
        if (maskNeedleDeg == null || Math.abs(wrapDelta(maskNeedleDeg, needleDeg)) <= 30) {
          maskNeedleDeg = needleDeg;
        }
      };
      const orientResult = (fields) => ({
        rotationDeg: pose ? pose.rotationDeg : 0,
        rawRotationDeg: pose ? pose.rotationDeg : 0,
        confidence: 0,
        held: false,
        captured: false,
        pressureHold: false,
        posePending: false,
        poseRejectReason: null,
        poseQuality: null,
        poseDeltaRot: 0,
        narrowOk: null,
        needleAgrees: null,
        estimateBin: null,
        storedBin: binIndex(rotationCandidate),
        incrementBins: null,
        poseDecision: null,
        anchorAccumDeg,
        stableNeedleDeg: null,
        ...fields,
        referenceCaptured: reference != null,
      });
      if (!pose || !profile || needleDeg == null) {
        rotationCandidate = null;
        pendingStepBins = null;
        return orientResult({
          held: true,
          pressureHold: true,
          stableNeedleDeg: maskNeedleDeg,
        });
      }
      if (!reference) {
        const identified = needleLikeness >= NEEDLE_LIKENESS_GATE && rimConfidence >= CONFIDENCE_MIN;
        if (identified) {
          reference = profile.slice();
          referenceFace = observedFace ? observedFace.slice() : null;
          referenceNeedleDeg = needleDeg;
          rememberNeedle();
          rotationCandidate = null;
          pendingStepBins = null;
          anchorRotationDeg = 0;
          anchorAccumDeg = 0;
          pose = { ...pose, rotationDeg: 0 };
          return orientResult({
            rotationDeg: 0,
            rawRotationDeg: 0,
            confidence: 1,
            captured: true,
            poseQuality: 1,
            poseDecision: 'commit',
            anchorAccumDeg: 0,
            storedBin: null,
            pressureHold: positionHeld,
            held: positionHeld,
          });
        }
        if (positionHeld) {
          return orientResult({
            held: true,
            pressureHold: true,
            stableNeedleDeg: maskNeedleDeg,
          });
        }
        return orientResult({ held: false });
      }
      if (positionHeld) {
        rotationCandidate = null;
        pendingStepBins = null;
        return orientResult({
          held: true,
          pressureHold: true,
          stableNeedleDeg: maskNeedleDeg,
        });
      }
      const needleStep = wrapDelta(maskNeedleDeg ?? needleDeg, needleDeg);
      const agrees = (estimateDeg) => {
        const proposed = wrapDelta(pose.rotationDeg, estimateDeg);
        return Math.abs(wrapDelta(needleStep, proposed)) <= ROTATION_RIGID_DEG;
      };
      const qualityOk = needleQuality != null && needleQuality >= NEEDLE_TRACK_QUALITY;
      const matchAt = (maxShiftDeg, previousDeg = pose.rotationDeg) => {
        const orientationOpts = {
          previousDeg,
          needleDeg: maskNeedleDeg,
          alsoNeedleDeg: needleDeg,
          referenceNeedleDeg,
          maxShiftDeg,
        };
        let face = null;
        if (referenceFace && observedFace) {
          face = matchGaugeRotation(referenceFace, observedFace, orientationOpts);
        }
        return {
          face,
          ...matchGaugeRotation(reference, profile, orientationOpts),
        };
      };
      const anchorIdentityOk = (targetDeg) => {
        const wide = matchAt(SEARCH_MAX_SHIFT_DEG, anchorRotationDeg);
        if (!wide.ok) return false;
        if (Math.abs(wrapDelta(targetDeg, wide.estimateDeg)) > PROFILE_BIN_DEG) return false;
        if (wide.confidence < LARGE_ROTATION_CONFIDENCE) return false;
        if ((wide.periodMargin ?? 0) < LARGE_ROTATION_PERIOD_MARGIN) return false;
        const face = wide.face;
        if (face && face.ok && face.confidence >= FACE_SIGNAL_CONFIDENCE) {
          if (Math.abs(wrapDelta(wide.estimateDeg, face.estimateDeg)) > FACE_AGREE_DEG) return false;
        }
        return true;
      };
      const holdTurn = (decision, match, extra) => orientResult({
        rotationDeg: pose.rotationDeg,
        rawRotationDeg: match.estimateDeg,
        confidence: match.confidence,
        pressureHold: true,
        posePending: true,
        poseRejectReason: 'rotation-unconfirmed',
        poseQuality: match.confidence,
        poseDecision: decision,
        stableNeedleDeg: maskNeedleDeg,
        estimateBin: binIndex(match.estimateDeg),
        storedBin: binIndex(rotationCandidate),
        needleAgrees: agrees(match.estimateDeg),
        narrowOk: extra.narrowOk,
        incrementBins: extra.incrementBins ?? null,
      });
      const commitTurn = (estimate, decision, match, motionBins, narrowOk) => {
        const before = pose.rotationDeg;
        pose = { ...pose, rotationDeg: estimate };
        if (decision === 're-anchor') {
          anchorRotationDeg = estimate;
          anchorAccumDeg = 0;
          rotationCandidate = null;
          pendingStepBins = null;
        } else {
          anchorAccumDeg = Math.abs(wrapDelta(anchorRotationDeg, estimate));
          rotationCandidate = estimate;
          pendingStepBins = motionBins;
        }
        rememberNeedle();
        return orientResult({
          rotationDeg: estimate,
          rawRotationDeg: estimate,
          confidence: match.confidence,
          poseQuality: match.confidence,
          poseDeltaRot: wrapDelta(before, estimate),
          poseDecision: decision,
          pressureHold: false,
          estimateBin: binIndex(estimate),
          storedBin: binIndex(rotationCandidate),
          incrementBins: motionBins,
          needleAgrees: true,
          narrowOk,
          anchorAccumDeg,
        });
      };
      const decide = (match, outside, narrowOk) => {
        const estimate = match.estimateDeg;
        const step = wrapDelta(pose.rotationDeg, estimate);
        const magnitude = Math.abs(step);
        const stepBins = wholeBins(step);
        const needleAgrees = agrees(estimate);
        if (trusted != null && wholeBins(wrapDelta(trusted, estimate)) === 0) {
          rememberNeedle();
          rotationCandidate = null;
          pendingStepBins = null;
          return orientResult({
            rotationDeg: pose.rotationDeg,
            rawRotationDeg: estimate,
            confidence: match.confidence,
            poseQuality: match.confidence,
            poseDecision: 're-anchor',
            pressureHold: false,
            estimateBin: binIndex(estimate),
            storedBin: null,
            needleAgrees,
            narrowOk,
          });
        }
        if (match.ok && (magnitude < ROTATION_QUIET_DEG || (!outside && stepBins === 0 && rotationCandidate == null))) {
          rotationCandidate = null;
          pendingStepBins = null;
          rememberNeedle();
          return orientResult({
            rotationDeg: pose.rotationDeg,
            rawRotationDeg: estimate,
            confidence: match.confidence,
            poseQuality: match.confidence,
            poseDecision: 'quiet',
            pressureHold: false,
            estimateBin: binIndex(estimate),
            storedBin: null,
            needleAgrees,
            narrowOk,
          });
        }
        if (outside && magnitude > LARGE_ROTATION_DEG && !largeRotationSupported(match)) {
          return holdTurn('re-anchor-fail', match, { narrowOk, incrementBins: null });
        }
        if (!match.ok || !needleAgrees || !qualityOk) {
          if (match.ok && !needleAgrees && qualityOk) {
            if (rotationCandidate == null) {
              rotationCandidate = estimate;
              pendingStepBins = stepBins;
            } else {
              const moved = wholeBins(wrapDelta(rotationCandidate, estimate));
              if (moved !== 0 && moved !== pendingStepBins) {
                rotationCandidate = estimate;
                pendingStepBins = moved;
              } else if (moved === 0) {
                rotationCandidate = estimate;
              }
            }
          }
          return holdTurn(needleAgrees ? null : 'veto', match, {
            narrowOk,
            incrementBins: rotationCandidate == null ? null : wholeBins(wrapDelta(rotationCandidate, estimate)),
          });
        }
        const increment = rotationCandidate == null ? null : wholeBins(wrapDelta(rotationCandidate, estimate));
        const sameStep = increment != null && (increment === 0 || (pendingStepBins !== 0 && increment === pendingStepBins));
        if (!sameStep) {
          rotationCandidate = estimate;
          pendingStepBins = stepBins;
          return holdTurn('store', match, { narrowOk, incrementBins: stepBins });
        }
        const motionBins = increment === 0 ? pendingStepBins : increment;
        if (Math.abs(wrapDelta(anchorRotationDeg, estimate)) > LARGE_ROTATION_DEG) {
          if (!anchorIdentityOk(estimate)) {
            return holdTurn('re-anchor-fail', match, { narrowOk, incrementBins: increment });
          }
          return commitTurn(estimate, 're-anchor', match, motionBins, narrowOk);
        }
        return commitTurn(estimate, 'commit', match, motionBins, narrowOk);
      };
      const narrow = matchAt(LOCKED_MAX_SHIFT_DEG);
      const narrowMag = Math.abs(wrapDelta(pose.rotationDeg, narrow.estimateDeg));
      const narrowAgrees = agrees(narrow.estimateDeg);
      let outsideMatch = null;
      if (!narrow.ok || !narrowAgrees || narrowMag >= LOCKED_MATCH_LIMIT_DEG) {
        const wide = matchAt(SEARCH_MAX_SHIFT_DEG);
        const wideMag = Math.abs(wrapDelta(pose.rotationDeg, wide.estimateDeg));
        if (
          wide.ok
          && wideMag > LOCKED_MATCH_LIMIT_DEG
          && wideMag < SEARCH_MAX_SHIFT_DEG
          && agrees(wide.estimateDeg)
          && qualityOk
        ) {
          outsideMatch = wide;
        }
      }
      if (outsideMatch) return decide(outsideMatch, true, narrow.ok);
      return decide(narrow, false, narrow.ok);
    },
  };
}

function squareCrop(videoW, videoH, cx, cy, pad) {
  let size = Math.round(pad * 2);
  size = Math.min(size, videoW, videoH);
  if (size < 16) return null;
  const originX = clamp(Math.round(cx - size / 2), 0, videoW - size);
  const originY = clamp(Math.round(cy - size / 2), 0, videoH - size);
  return { originX, originY, size };
}

function resampleCrop(image, crop, maxOutput, minOutput = 0) {
  const natural = Math.min(crop.size, maxOutput);
  const output = Math.min(maxOutput, Math.max(natural, minOutput > 0 ? minOutput : natural));
  const scale = output / crop.size;
  const data = new Uint8ClampedArray(output * output * 4);
  for (let y = 0; y < output; y += 1) {
    for (let x = 0; x < output; x += 1) {
      const sx = Math.min(image.width - 1, crop.originX + Math.floor(x / scale));
      const sy = Math.min(image.height - 1, crop.originY + Math.floor(y / scale));
      const src = (sy * image.width + sx) * 4;
      const dst = (y * output + x) * 4;
      data[dst] = image.data[src];
      data[dst + 1] = image.data[src + 1];
      data[dst + 2] = image.data[src + 2];
      data[dst + 3] = 255;
    }
  }
  return { image: { data, width: output, height: output }, scale };
}

const DIAL_REGISTER_MIN = 0.34;

/** One profile bin is 5°. Arc and ticks may disagree by two bins and still be the same rotation. */
const SCALE_AGREEMENT_DEG = 10;

function smoothProfile(profile, radius = 2) {
  const n = profile.length;
  const out = new Float32Array(n);
  const win = radius * 2 + 1;
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += profile[(i + k + n) % n];
    out[i] = sum / win;
  }
  return out;
}

/** Remove a slow angular ramp so a lighting gradient cannot impersonate the printed arc. */
function highPassProfile(profile, radius = 2) {
  const low = smoothProfile(profile, radius);
  const out = new Float32Array(profile.length);
  for (let i = 0; i < profile.length; i += 1) out[i] = profile[i] - low[i];
  return out;
}

/**
 * Per-frame dial rotation from the canonical printed scale (no session template).
 * The wide arc (espresso band and logo) and the tick comb are matched separately.
 * A lighting blob can imitate the arc, and tick spacing on the arc is periodic, so neither
 * band may publish a rotation on its own.
 */
export function registerDialRotationFromProfile(profile, needleDeg = null, previousDeg = 0) {
  if (!profile || profile.length < 8) {
    return { ok: false, rotationDeg: previousDeg, confidence: 0, periodMargin: 0 };
  }
  const opts = { previousDeg, needleDeg, maxShiftDeg: 360 };
  const arc = matchGaugeRotation(
    smoothProfile(FLAIR_CANONICAL_DIAL_PROFILE),
    smoothProfile(profile),
    opts,
  );
  const ticks = matchGaugeRotation(
    highPassProfile(FLAIR_CANONICAL_DIAL_PROFILE),
    highPassProfile(profile),
    opts,
  );
  const agree = Math.abs(wrapDelta(arc.estimateDeg ?? 0, ticks.estimateDeg ?? 0)) <= SCALE_AGREEMENT_DEG;
  const ok = arc.ok
    && ticks.ok
    && agree
    && arc.confidence >= DIAL_REGISTER_MIN
    && ticks.confidence >= DIAL_REGISTER_MIN
    && arc.periodMargin >= REGISTRATION_PERIOD_MARGIN_MIN;
  return {
    ok,
    rotationDeg: ok ? arc.estimateDeg : previousDeg,
    confidence: Math.min(arc.confidence, ticks.confidence),
    periodMargin: arc.periodMargin,
  };
}

function trackLockedScale(tracker, bands, { qualityHold = false } = {}) {
  const profile = faceProfileFromBands(bands);
  return stepScaleLock(tracker.getScaleLock?.() ?? null, { profile, qualityHold });
}

function commitScaleStep(tracker, stepped) {
  tracker.setScaleLock?.(stepped.lock);
  if (stepped.registered) {
    tracker.setRotationDeg(stepped.rotationDeg);
    tracker.notePrintedFace(true);
  }
  return stepped;
}

let needleSurface = null;
let trackSurface = null;

function scratchCanvas(kind) {
  if (typeof document === 'undefined') return null;
  if (kind === 'needle') {
    if (!needleSurface) needleSurface = document.createElement('canvas');
    return needleSurface;
  }
  if (!trackSurface) trackSurface = document.createElement('canvas');
  return trackSurface;
}

function drawCrop(video, canvas, crop, maxOutput, minOutput = 0) {
  const natural = Math.min(crop.size, maxOutput);
  const output = Math.min(maxOutput, Math.max(natural, minOutput > 0 ? minOutput : natural));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  // Assigning width resets the bitmap even when the value is unchanged.
  if (canvas.width !== output || canvas.height !== output) {
    canvas.width = output;
    canvas.height = output;
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  context.drawImage(video, crop.originX, crop.originY, crop.size, crop.size, 0, 0, output, output);
  const t2 = typeof performance !== 'undefined' ? performance.now() : 0;
  const image = context.getImageData(0, 0, output, output);
  const t3 = typeof performance !== 'undefined' ? performance.now() : 0;
  return {
    image,
    scale: output / crop.size,
    output,
    resizeMs: t1 - t0,
    blitMs: t2 - t1,
    readMs: t3 - t2,
  };
}

function completeReading({
  videoWidth,
  videoHeight,
  position,
  tracker,
  needleImage,
  needleCrop,
  needleScale,
  canonicalDial = false,
  qualityImage = null,
  qualityCrop = null,
  qualityScale = null,
}) {
  const center = position.pose;
  const localRadius = center.radius * needleScale;
  const localCx = (center.cx - needleCrop.originX) * needleScale;
  const localCy = (center.cy - needleCrop.originY) * needleScale;
  const faceRaw = scoreDialFaceInterior(
    needleImage.data,
    needleImage.width,
    needleImage.height,
    localCx,
    localCy,
    localRadius,
  );
  const edgeSink = {};
  const detection = detectNeedleAngle(
    needleImage,
    localCx,
    localCy,
    localRadius * TIP_INNER_RATIO,
    localRadius * OUTER_RADIUS_RATIO,
    edgeSink,
    tracker.needleHint?.() ?? null,
  );
  const tickEnergy = scoreTickRingEnergy(
    edgeSink.edges,
    needleImage.width,
    needleImage.height,
    localCx,
    localCy,
    localRadius,
  );
  const dialFaceScore = combineDialFaceScore(
    faceRaw,
    tickEnergy,
    localRadius,
    Math.min(videoWidth, videoHeight) * needleScale,
  );
  let orientation;
  let frameQuality = null;
  if (canonicalDial) {
    const bands = measureDialColorBands(
      needleImage,
      localCx,
      localCy,
      localRadius,
      detection.angleDeg,
    );
    if (!qualityImage) {
      frameQuality = assessFrameQuality(
        needleImage.data,
        needleImage.width,
        needleImage.height,
        localCx,
        localCy,
        localRadius,
        edgeSink.luma,
      );
    }
    let stepped = trackLockedScale(tracker, bands);
    if (stepped.needsFull) {
      const reg = registerDialFromColorBands(bands);
      // The printed face is the colour bands and the rim. A full search runs
      // only when the frame-to-frame lock has nothing to follow.
      // A red blob with no needle must not lock: the tracker would then
      // refuse to leave that circle.
      const needleOk = (detection.likeness ?? 0) >= NEEDLE_LIKENESS_GATE;
      const registered = reg.ok
        && needleOk
        && dialFaceScore >= DIAL_FACE_VERIFY_MIN
        && position.confidence >= CONFIDENCE_MIN;
      stepped = stepScaleLock(null, {
        profile: faceProfileFromBands(bands),
        fullRegistration: registered ? reg : null,
      });
    }
    commitScaleStep(tracker, stepped);
    const priorRot = tracker.getPose()?.rotationDeg ?? 0;
    orientation = {
      rotationDeg: stepped.registered ? stepped.rotationDeg : priorRot,
      rawRotationDeg: stepped.rotationDeg,
      confidence: stepped.confidence,
      periodMargin: stepped.periodMargin ?? 0,
      held: false,
      pressureHold: Boolean(position.held),
      referenceCaptured: stepped.registered,
      dialRegistered: stepped.registered,
      poseQuality: stepped.confidence,
      posePending: false,
      poseRejectReason: stepped.registered ? null : 'dial-register-weak',
      stableNeedleDeg: detection.angleDeg,
    };
  } else {
    orientation = tracker.trackOrientation(position.profile, detection.angleDeg, {
      positionHeld: position.held,
      needleLikeness: detection.likeness,
      rimConfidence: position.confidence,
      needleQuality: detection.quality,
    });
    orientation.dialRegistered = orientation.referenceCaptured === true;
  }
  if (!frameQuality) {
    frameQuality = assessFrameQuality(
      needleImage.data,
      needleImage.width,
      needleImage.height,
      localCx,
      localCy,
      localRadius,
      edgeSink.luma,
    );
  }
  const qualitySource = qualityImage || needleImage;
  const qualityOrigin = qualityCrop || needleCrop;
  const qualityFactor = qualityScale ?? needleScale;
  const qualityCx = (center.cx - qualityOrigin.originX) * qualityFactor;
  const qualityCy = (center.cy - qualityOrigin.originY) * qualityFactor;
  const qualityRadius = center.radius * qualityFactor;
  if (!frameQuality || qualityImage) {
    frameQuality = assessFrameQuality(
      qualitySource.data,
      qualitySource.width,
      qualitySource.height,
      qualityCx,
      qualityCy,
      qualityRadius,
    );
  }
  const settled = tracker.getPose() || center;
  const minDim = Math.min(videoWidth, videoHeight);
  // A printed-face registration is the scale. The legacy rim search can stay
  // `held` for the whole clip without ever accepting an orientation candidate.
  // That hold must not veto a face the template has already accepted.
  const printed = orientation.dialRegistered === true;
  const pressureHold = printed ? false : Boolean(position.held || orientation.pressureHold);
  const publishedNeedle = pressureHold && orientation.stableNeedleDeg != null
    ? orientation.stableNeedleDeg
    : detection.angleDeg;
  return {
    ...detection,
    relativeAngleDeg: wrap360(publishedNeedle - orientation.rotationDeg),
    videoWidth,
    videoHeight,
    frameQuality,
    gauge: {
      nx: settled.cx / videoWidth,
      ny: settled.cy / videoHeight,
      nr: settled.radius / minDim,
      cx: settled.cx,
      cy: settled.cy,
      radius: settled.radius,
      rotationDeg: orientation.rotationDeg,
      rawCx: position.rawCx ?? null,
      rawCy: position.rawCy ?? null,
      rawRadius: position.rawRadius ?? null,
      rawRotationDeg: orientation.rawRotationDeg ?? orientation.rotationDeg,
      confidence: position.confidence,
      orientationConfidence: orientation.confidence,
      periodMargin: orientation.periodMargin ?? null,
      held: printed ? false : Boolean(position.held),
      pressureHold,
      poseQuality: orientation.poseQuality ?? position.poseQuality ?? null,
      narrowOk: orientation.narrowOk ?? null,
      needleAgrees: orientation.needleAgrees ?? null,
      estimateBin: orientation.estimateBin ?? null,
      storedBin: orientation.storedBin ?? null,
      incrementBins: orientation.incrementBins ?? null,
      poseDecision: orientation.poseDecision ?? null,
      anchorAccumDeg: orientation.anchorAccumDeg ?? null,
      poseRejectReason: position.poseRejectReason || orientation.poseRejectReason || null,
      posePending: Boolean(position.posePending || orientation.posePending),
      poseDeltaPx: position.poseDeltaPx ?? 0,
      poseDeltaRot: orientation.poseDeltaRot ?? 0,
      trackMode: position.trackMode || 'locked',
      searchFraction: position.searchFraction ?? null,
      reacquireCx: position.reacquireCx ?? null,
      reacquireCy: position.reacquireCy ?? null,
      reacquireRadius: position.reacquireRadius ?? null,
      reacquireRotation: position.reacquireRotation ?? null,
      reacquireQuality: position.reacquireQuality ?? null,
      reacquireHits: position.reacquireHits ?? 0,
      reacquireRejectReason: position.reacquireRejectReason ?? null,
      reacquireAccepted: position.reacquireAccepted === true,
      referenceCaptured: orientation.dialRegistered === true,
      dialRegistered: orientation.dialRegistered === true,
      dialFaceScore,
    },
  };
}

/** Same crop-and-read path as the camera, for tests on a full frame. */
export function analyzeGaugeImage(image, tracker) {
  const videoWidth = image.width;
  const videoHeight = image.height;
  if (!videoWidth || !videoHeight || !tracker.getPose()) return null;
  const pose = tracker.getPose();
  const capture = tracker.captureSpec();
  const trackCrop = squareCrop(videoWidth, videoHeight, pose.cx, pose.cy, pose.radius * capture.pad);
  if (!trackCrop) return null;
  const tracked = resampleCrop(image, trackCrop, capture.maxOutput);
  const position = tracker.trackPosition(tracked.image, {
    originX: trackCrop.originX,
    originY: trackCrop.originY,
    scale: tracked.scale,
  });
  if (!position) return null;
  const center = position.pose;
  const needleCrop = squareCrop(videoWidth, videoHeight, center.cx, center.cy, center.radius * 1.08);
  if (!needleCrop) return null;
  const needle = resampleCrop(image, needleCrop, 420);
  return completeReading({
    videoWidth,
    videoHeight,
    position,
    tracker,
    needleImage: needle.image,
    needleCrop,
    needleScale: needle.scale,
    canonicalDial: false,
  });
}

function roundTrace(value) {
  return value == null || Number.isNaN(value) ? null : Math.round(value * 100) / 100;
}

function tracePoint(point) {
  if (!point) return null;
  return {
    cx: roundTrace(point.cx),
    cy: roundTrace(point.cy),
    radius: roundTrace(point.radius),
    ok: point.ok === true,
    face: roundTrace(point.dialFaceScore),
    canonical: roundTrace(point.canonicalScore),
    confidence: roundTrace(point.confidence),
    source: point.source ?? null,
  };
}

/** Map a discovery result from processing-canvas pixels into video pixels. */
export function mapCanvasDiscoveryToVideo(found, drawn, videoWidth, videoHeight) {
  if (!found || !drawn?.canvasWidth || !drawn?.canvasHeight || !videoWidth || !videoHeight) return null;
  const scaleX = drawn.canvasWidth / videoWidth;
  const scaleY = drawn.canvasHeight / videoHeight;
  const scaleR = Math.min(drawn.canvasWidth, drawn.canvasHeight) / Math.min(videoWidth, videoHeight);
  if (!(scaleX > 0) || !(scaleY > 0) || !(scaleR > 0)) return null;
  return {
    ...found,
    cx: found.cx / scaleX,
    cy: found.cy / scaleY,
    radius: found.radius / scaleR,
  };
}

function pushVideoTrace(entry) {
  const buf = globalThis.__pressureLabVideoTrace;
  if (!Array.isArray(buf) || buf.length >= 64) return;
  buf.push(entry);
}

function trackSettings(video) {
  try {
    const settings = video.srcObject?.getVideoTracks?.()?.[0]?.getSettings?.() || {};
    return { width: settings.width ?? null, height: settings.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

let replayFrameSearched = false;
let replayDiscoveryDrawn = null;
export const lastReadProfile = {
  path: '',
  syncMs: 0,
  trackMs: 0,
  needleMs: 0,
  searchNeeded: false,
  postedSearch: false,
};

function replayDiscoveryNeeded(video, canvas, tracker) {
  if (!video?.videoWidth || !video?.videoHeight || !canvas || !tracker?.discoveryDueNow) return false;
  const havePose = Boolean(tracker.getPose());
  const due = !tracker.getScaleLock?.() && tracker.discoveryDueNow();
  return !havePose || due;
}

function postReplayDiscovery(video) {
  const tDraw = performance.now();
  // Full-frame bitmap. The worker point-samples it. A pre-scaled draw changed the circle.
  replayDiscoveryDrawn = null;
  const posted = requestCanvasDiscovery(video, video.videoWidth, video.videoHeight);
  return { posted, drawMs: performance.now() - tDraw };
}

/**
 * Start this frame's search before the timed read.
 * The replay loop waits for it off the clock, then the read applies the circle.
 */
export function beginReplayDiscovery(video, canvas, tracker) {
  replayFrameSearched = false;
  if (!replayDiscoveryNeeded(video, canvas, tracker)) return { posted: false, drawMs: 0 };
  const posted = postReplayDiscovery(video, canvas);
  if (posted.posted) replayFrameSearched = true;
  return posted;
}

/**
 * Wait out whatever is left of the search started for this frame.
 * Does not run Hough on the main thread. One search is in flight.
 */
export async function primeReplayDiscovery(video, canvas, tracker) {
  if (!replayFrameSearched && replayDiscoveryNeeded(video, canvas, tracker)) {
    const posted = postReplayDiscovery(video, canvas);
    if (!posted.posted) return { waitMs: 0, drawMs: posted.drawMs };
    replayFrameSearched = true;
    const tWait = performance.now();
    await whenDiscoverySettled();
    return { waitMs: performance.now() - tWait, drawMs: posted.drawMs };
  }
  if (!replayFrameSearched) return { waitMs: 0 };
  const tWait = performance.now();
  await whenDiscoverySettled();
  return { waitMs: performance.now() - tWait, drawMs: 0 };
}

/** Crop around the tracked gauge, update its pose, then read the needle from that pose. */
/**
 * Full-frame search stays off the thread that reads the needle.
 * A miss is `apply` of an empty result. The main thread never runs Hough.
 */
export function mainThreadDiscoveryAction({ havePose, discoveryDue, hasAsyncResult }) {
  if (hasAsyncResult) return 'apply';
  const wantSearch = !havePose || discoveryDue;
  if (!wantSearch) return 'needle';
  return 'defer';
}

export function readTrackedGauge(video, canvas, region, tracker) {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight) return null;
  const before = tracker.snapshot?.() ?? null;
  let drawn = null;
  let foundCanvas = null;
  let foundVideo = null;
  let seeded = false;
  let discoveryEvent = null;
  const stamp = () => (typeof performance !== 'undefined' ? performance.now() : 0);
  const tStart = stamp();
  lastReadProfile.path = '';
  lastReadProfile.syncMs = 0;
  lastReadProfile.trackMs = 0;
  lastReadProfile.needleMs = 0;
  lastReadProfile.searchNeeded = false;
  lastReadProfile.postedSearch = false;
  let discoveryMs = 0;
  let trackDrawMs;
  let trackMs;
  let needleDrawMs = 0;
  let needleMs = 0;
  const finishProfile = (path) => {
    lastReadProfile.path = path;
    lastReadProfile.syncMs = discoveryMs;
    lastReadProfile.trackMs = trackMs || 0;
    lastReadProfile.needleMs = needleMs;
  };
  const havePose = Boolean(tracker.getPose());
  // A locked scale is the registration. Another full-frame search is what
  // made a rotating clip depend on worker timing, and it is the slow tail.
  const discoveryDue = !tracker.getScaleLock?.() && tracker.needsRediscovery();
  // Live and replay both post the search and keep going. A finished miss is
  // applied here. The main thread never runs Hough.
  const searched = replayFrameSearched;
  replayFrameSearched = false;
  const consumed = consumeDiscoveryResult();
  const asyncFound = consumed.ready ? consumed.found : null;
  const wantSearch = !searched && !consumed.ready && (!havePose || discoveryDue);
  const handedToWorker = wantSearch && requestVideoDiscovery(video);
  if (wantSearch) lastReadProfile.searchNeeded = true;
  if (handedToWorker) lastReadProfile.postedSearch = true;
  const discoveryAction = mainThreadDiscoveryAction({
    havePose,
    discoveryDue,
    hasAsyncResult: consumed.ready,
    workerAccepted: handedToWorker,
  });
  if (asyncFound) {
    foundVideo = replayDiscoveryDrawn
      ? mapCanvasDiscoveryToVideo(asyncFound, replayDiscoveryDrawn, videoWidth, videoHeight)
      : asyncFound;
  }
  if (discoveryAction === 'apply') {
    const tDisc = stamp();
    const prior = tracker.verificationState();
    const decision = chooseDiscoveryUpdate({
      ...prior,
      discovered: foundVideo,
      pose: tracker.getPose(),
      printedFace: prior.printedFace === true,
    });
    discoveryEvent = decision.reason;
    if (decision.action === 'replace') {
      const poseNow = tracker.getPose();
      const moved = !poseNow
        || Math.hypot(foundVideo.cx - poseNow.cx, foundVideo.cy - poseNow.cy)
          > Math.max(poseNow.radius, foundVideo.radius) * REDISCOVERY_MOVE_FRACTION;
      if (!poseNow || moved) {
        tracker.seed({ cx: foundVideo.cx, cy: foundVideo.cy, radius: foundVideo.radius });
      } else {
        tracker.nudgePose({ cx: foundVideo.cx, cy: foundVideo.cy, radius: foundVideo.radius });
      }
      tracker.markDiscovered();
      seeded = !prior.hasPose;
    } else if (decision.action === 'drop') {
      tracker.reset();
      pushVideoTrace({
        t: roundTrace(video.currentTime),
        frameIndex: video.currentTime == null ? null : Math.round(video.currentTime * 30),
        videoW: videoWidth,
        videoH: videoHeight,
        elementW: video.clientWidth || null,
        elementH: video.clientHeight || null,
        dpr: globalThis.devicePixelRatio ?? null,
        track: trackSettings(video),
        canvasW: drawn?.canvasWidth ?? null,
        canvasH: drawn?.canvasHeight ?? null,
        scaleX: roundTrace(drawn?.scaleX),
        scaleY: roundTrace(drawn?.scaleY),
        discoveryCanvas: tracePoint(foundCanvas),
        discoveryVideo: tracePoint(foundVideo),
        topCandidates: drawn?.topCandidates ?? null,
        seeded: false,
        before,
        after: tracker.snapshot?.() ?? null,
        event: decision.reason,
      });
      discoveryMs = stamp() - tDisc;
      finishProfile('drop');
      return null;
    } else {
      tracker.markDiscovered();
    }
    discoveryMs = stamp() - tDisc;
  }
  if (handedToWorker && tracker.getPose()) tracker.markDiscovered();

  const pose = tracker.getPose();
  if (!pose) {
    finishProfile('no-pose');
    return null;
  }
  const capture = tracker.captureSpec();
  const trackCrop = squareCrop(videoWidth, videoHeight, pose.cx, pose.cy, pose.radius * capture.pad);
  if (!trackCrop) {
    finishProfile('no-crop');
    return null;
  }
  const tTrackDraw = stamp();
  const tracked = drawCrop(video, scratchCanvas('track') || canvas, trackCrop, capture.maxOutput);
  trackDrawMs = stamp() - tTrackDraw;
  const trackBlitMs = tracked.blitMs;
  const trackReadMs = tracked.readMs;
  const trackResizeMs = tracked.resizeMs;
  const trackOutput = tracked.output;
  const tTrack = stamp();
  const priorState = tracker.verificationState?.() ?? {};
  const priorFace = priorState.faceScore ?? 0;
  const reusePrior = priorFace >= DIAL_FACE_VERIFY_MIN;
  const position = tracker.trackPosition(tracked.image, {
    originX: trackCrop.originX,
    originY: trackCrop.originY,
    scale: tracked.scale,
  }, { reusePrior });
  trackMs = stamp() - tTrack;
  if (!position) {
    finishProfile('no-position');
    return null;
  }
  // A circle the rim does not support is not a dial. Drop it so the next
  // frame can search again, instead of keeping it until the rediscover stride.
  if ((position.confidence ?? 0) < CONFIDENCE_MIN && priorState.printedFace !== true) {
    tracker.reset();
    finishProfile('rim-weak');
    return null;
  }

  let reading;
  let bridged = false;
  if (shouldBridgeNeedle({
    reusePrior,
    framesSinceDiscovery: priorState.framesSinceDiscovery ?? 0,
    held: position.held,
    poseDeltaPx: position.poseDeltaPx ?? 0,
    radius: position.pose?.radius ?? 0,
    hasBridge: Boolean(tracker.peekBridge?.()),
    discovering: discoveryMs > 0,
  })) {
    const cached = tracker.peekBridge();
    const poseNow = position.pose;
    const minDim = Math.min(videoWidth, videoHeight);
    const colorCx = (poseNow.cx - trackCrop.originX) * tracked.scale;
    const colorCy = (poseNow.cy - trackCrop.originY) * tracked.scale;
    const colorR = poseNow.radius * tracked.scale;
    let frameQuality = null;
    if (tracked.scale < 0.92) {
      const faceCrop = squareCrop(videoWidth, videoHeight, poseNow.cx, poseNow.cy, poseNow.radius * 0.72);
      if (faceCrop) {
        const native = drawCrop(video, scratchCanvas('needle') || canvas, faceCrop, faceCrop.size);
        frameQuality = assessFrameQuality(
          native.image.data,
          native.image.width,
          native.image.height,
          (poseNow.cx - faceCrop.originX) * native.scale,
          (poseNow.cy - faceCrop.originY) * native.scale,
          poseNow.radius * native.scale,
        );
      }
    }
    if (!frameQuality) {
      frameQuality = assessFrameQuality(
        tracked.image.data,
        tracked.image.width,
        tracked.image.height,
        colorCx,
        colorCy,
        colorR,
      );
    }
    const bands = measureDialColorBands(
      tracked.image,
      colorCx,
      colorCy,
      colorR,
      cached.angleDeg,
    );
    const stepped = trackLockedScale(tracker, bands);
    // A bridge frame has no new needle. Only a lock that is already following
    // may keep the last relative angle. A dropped lock falls through to a
    // full read, which publishes nothing until registration returns.
    if (stepped.mode === 'track') {
      commitScaleStep(tracker, stepped);
      reading = {
        ...cached,
        relativeAngleDeg: cached.relativeAngleDeg,
        frameQuality,
        videoWidth,
        videoHeight,
        gauge: {
          ...cached.gauge,
          cx: poseNow.cx,
          cy: poseNow.cy,
          radius: poseNow.radius,
          nx: poseNow.cx / videoWidth,
          ny: poseNow.cy / videoHeight,
          nr: poseNow.radius / minDim,
          confidence: position.confidence,
          rotationDeg: stepped.rotationDeg,
          rawRotationDeg: stepped.rotationDeg,
          orientationConfidence: stepped.confidence,
          periodMargin: stepped.periodMargin,
          poseDeltaPx: position.poseDeltaPx ?? 0,
          held: false,
          pressureHold: false,
          referenceCaptured: true,
          dialRegistered: true,
        },
      };
      bridged = true;
      discoveryEvent = discoveryEvent || 'bridge';
    }
  }
  if (!reading) {
    const center = position.pose;
    const needleCrop = squareCrop(videoWidth, videoHeight, center.cx, center.cy, center.radius * 1.08);
    if (!needleCrop) {
      finishProfile('no-needle-crop');
      return null;
    }
    const tNeedleDraw = stamp();
    const locked = Boolean(tracker.getScaleLock?.()) || priorState.printedFace === true;
    const zoom = needleZoomForRadius(center.radius, { locked });
    const needleMax = zoom < 1 ? Math.max(48, Math.round(needleCrop.size * zoom)) : 420;
    const needleMin = zoom > 1 ? Math.round(needleCrop.size * zoom) : 0;
    let qualityImage = null;
    let qualityCrop = null;
    let qualityScale = null;
    if (zoom !== 1) {
      const faceCrop = squareCrop(videoWidth, videoHeight, center.cx, center.cy, center.radius * 0.72) || needleCrop;
      const native = drawCrop(video, scratchCanvas('needle') || canvas, faceCrop, faceCrop.size);
      qualityImage = native.image;
      qualityCrop = faceCrop;
      qualityScale = native.scale;
    }
    const needle = drawCrop(video, scratchCanvas('needle') || canvas, needleCrop, needleMax, needleMin);
    needleDrawMs = stamp() - tNeedleDraw;
    const tNeedle = stamp();
    reading = completeReading({
      videoWidth,
      videoHeight,
      position,
      tracker,
      needleImage: needle.image,
      needleCrop,
      needleScale: needle.scale,
      canonicalDial: true,
      qualityImage,
      qualityCrop,
      qualityScale,
    });
    needleMs = stamp() - tNeedle;
  }
  const faceScore = reading.gauge?.dialFaceScore ?? 0;
  if (faceScore < DIAL_FACE_VERIFY_MIN) {
    const keepLock = Boolean(tracker.getScaleLock?.());
    if (!keepLock) {
      tracker.reset();
      reading.gauge.dialRegistered = false;
      reading.gauge.referenceCaptured = false;
    }
    reading.gauge.poseRejectReason = reading.gauge.poseRejectReason || 'dial-face';
    discoveryEvent = 'dial-face';
    if (keepLock) {
      tracker.noteTrackedFrame({
        faceScore,
        poseJumpPx: reading.gauge?.poseDeltaPx ?? 0,
        radius: reading.gauge?.radius ?? 0,
      });
    }
  } else {
    tracker.noteTrackedFrame({
      faceScore,
      poseJumpPx: reading.gauge?.poseDeltaPx ?? 0,
      radius: reading.gauge?.radius ?? 0,
    });
    if (!bridged) tracker.rememberBridge?.(reading);
  }
  // An unregistered circle is not a pose. Keeping it blocks the next search
  // from taking the real dial.
  if (!reading.gauge?.dialRegistered && !tracker.getScaleLock?.()) tracker.reset();
  const after = tracker.snapshot?.() ?? null;
  pushVideoTrace({
    t: roundTrace(video.currentTime),
    frameIndex: video.currentTime == null ? null : Math.round(video.currentTime * 30),
    videoW: videoWidth,
    videoH: videoHeight,
    elementW: video.clientWidth || null,
    elementH: video.clientHeight || null,
    dpr: globalThis.devicePixelRatio ?? null,
    track: trackSettings(video),
    canvasW: drawn?.canvasWidth ?? null,
    canvasH: drawn?.canvasHeight ?? null,
    scaleX: drawn ? roundTrace(drawn.scaleX) : null,
    scaleY: drawn ? roundTrace(drawn.scaleY) : null,
    discoveryCanvas: tracePoint(foundCanvas),
    discoveryVideo: tracePoint(foundVideo),
    topCandidates: drawn?.topCandidates ?? null,
    seeded,
    crop: {
      originX: trackCrop.originX,
      originY: trackCrop.originY,
      size: trackCrop.size,
      scale: roundTrace(tracked.scale),
    },
    pose: tracePoint({
      cx: reading.gauge?.cx,
      cy: reading.gauge?.cy,
      radius: reading.gauge?.radius,
      dialFaceScore: reading.gauge?.dialFaceScore,
      confidence: reading.gauge?.confidence,
    }),
    trackMode: reading.gauge?.trackMode ?? null,
    before,
    after,
    event: discoveryEvent || (seeded ? 'seed' : 'track'),
    ms: {
      total: roundTrace(stamp() - tStart),
      discovery: roundTrace(discoveryMs),
      trackDraw: roundTrace(trackDrawMs),
      track: roundTrace(trackMs),
      needleDraw: roundTrace(needleDrawMs),
      needle: roundTrace(needleMs),
    },
  });
  reading.stageMs = {
    trackDraw: trackDrawMs,
    track: trackMs,
    needleDraw: needleDrawMs,
    needle: needleMs,
    discovery: discoveryMs,
    trackBlit: trackBlitMs,
    trackRead: trackReadMs,
    trackResize: trackResizeMs,
    trackOutput,
  };
  finishProfile('reading');
  return reading;
}
