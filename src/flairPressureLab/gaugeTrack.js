import { TIP_INNER_RATIO, OUTER_RADIUS_RATIO, NEEDLE_LIKENESS_GATE, wrap360, wrapDelta } from './gaugeConfig.js';
import { prepareEdges } from './framePrep.js';
import { detectNeedleAngle } from './needleFromFrame.js';

/**
 * Gauge pose for the pressure lab.
 *
 * Position comes from the circular rim: edge gradients on a real dial point
 * outward all the way around, so a translated gauge moves the circle and a
 * rotating needle does not. Orientation comes from the fixed tick/numeral
 * pattern, with the needle sector ignored, so a lever twist is not read as
 * pressure. Pressure uses needle angle minus that gauge rotation.
 *
 * Locked tracking is modest motion only. The search stays near the last pose.
 * A weak rim score holds the last pose instead of inventing a new one.
 * Centre, radius, and rotation are one pose. A large change has to be the same
 * pose again on the next frame. The needle is masked out of the dial match, so
 * it cannot turn or translate the gauge.
 *
 * A lever move can carry the gauge outside that window. Locked acceptance is
 * unchanged. After the pose is no longer supported, a separate search confirms
 * the same dial over several frames and only then moves the locked pose.
 * Repeating an orientation is not enough when the step is large. The outer
 * tick ring repeats about every 30°, and covering its one unique sector leaves
 * an alias that still clears the ordinary correlation gate. A large search
 * rotation has to beat that alias outright. When the white face has its own
 * fixed structure, that inner profile has to agree as well. Otherwise the
 * search keeps holding the last pose.
 *
 * A brief rim miss is not a new pose. Locked matching stays inside one dial
 * bin of the last rotation. A twist that window cannot explain is matched
 * again out to the search limit, with the same alias test, and the last pose
 * is held until that wider match repeats.
 */

const RIM_BINS = 48;
const PROFILE_BINS = 72;
const CONFIDENCE_MIN = 0.3;
const ORIENT_MIN = 0.34;
/** Nearest shift treated as a different tick period, not a shoulder of the best peak. */
const PERIOD_RIVAL_DEG = 24;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sampleRadial(edges, width, height, x, y, cos, sin) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 1 || yi < 1 || xi >= width - 1 || yi >= height - 1) return 0;
  const index = yi * width + xi;
  return Math.abs(edges.gx[index] * cos + edges.gy[index] * sin);
}

/** How strongly edges at `radius` point at `(cx, cy)`. 0 if the circle does not fit. */
export function scoreRim(edges, width, height, cx, cy, radius) {
  if (radius < 8) return 0;
  let sum = 0;
  let lit = 0;
  for (let i = 0; i < RIM_BINS; i += 1) {
    const angle = (i / RIM_BINS) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let local = 0;
    for (let dr = -3; dr <= 3; dr += 1.5) {
      local = Math.max(local, sampleRadial(edges, width, height, cx + (radius + dr) * cos, cy + (radius + dr) * sin, cos, sin));
    }
    sum += local;
    if (local > 0.4) lit += 1;
  }
  if (lit < RIM_BINS * 0.35) return 0;
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
 * one tenth of the radius has to agree for three frames, and only when the
 * dial at that circle still matches the current rotation. A bigger jump, or a
 * jump that only matches after a large spin, has to be the same pose twice.
 * Rotation under one degree is ignored. One dial bin can repeat and then
 * keep turning. Anything larger is held until the same angle comes back,
 * so one bad frame cannot walk the pressure reading.
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
const ROTATION_BIN_DEG = 5.5;
const ROTATION_AGREE_DEG = 4;
const ROTATION_RIGID_DEG = 6;
const LOCKED_MAX_SHIFT_DEG = 18;
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
  let rotationVelocity = 0;
  let trustedRotationDeg = null;
  let poseCandidate = null;
  let maskNeedleDeg = null;
  let mode = 'locked';
  let lossStreak = 0;
  let searchStep = 0;
  let searchFraction = SEARCH_FRACTIONS[0];
  let searchCandidate = null;
  let searchMisses = 0;
  let reacquireReason = null;
  let observed = null;

  const clearPoseMemory = () => {
    centreCandidate = null;
    radiusCandidate = null;
    rotationCandidate = null;
    rotationVelocity = 0;
    trustedRotationDeg = null;
    poseCandidate = null;
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
    },
    getPose() {
      return pose ? { ...pose } : null;
    },
    captureSpec() {
      if (mode !== 'searching') return { pad: 1.9, maxOutput: 188 };
      return { pad: 1 + searchFraction + 0.45, maxOutput: 320 };
    },
    /**
     * @param mapping image pixel = (video pixel - origin) * scale
     */
    trackPosition(image, mapping) {
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
      } else {
        windowFraction = recovering ? 0.62 : 0.46;
        found = locateGauge(image, localPrior, { searchFraction: windowFraction });
      }
      if (mode === 'searching') {
        if (!found.ok) {
          noteSearchMiss();
          return finish(windowFraction, {
            held: true,
            confidence: found.confidence,
            rawCx: mapping.originX + found.cx / mapping.scale,
            rawCy: mapping.originY + found.cy / mapping.scale,
            rawRadius: found.radius / mapping.scale,
          });
        }
        const video = toVideo(found, mapping);
        const wide = wideMatch(found);
        if (considerCandidate(video, wide)) {
          return acceptCandidate(found, video, wide, mapping, windowFraction);
        }
        if (!searchCandidate) growSearch();
        return finish(windowFraction, {
          held: true,
          confidence: found.confidence,
          rawCx: video.cx,
          rawCy: video.cy,
          rawRadius: video.radius,
        });
      }
      if (!found.ok) {
        recovering = true;
        poseCandidate = null;
        noteLockedMiss();
        return finish(windowFraction, {
          held: true,
          confidence: found.confidence,
          poseRejectReason: 'rim-weak',
        });
      }
      const video = toVideo(found, mapping);
      const dx = video.cx - pose.cx;
      const dy = video.cy - pose.cy;
      const shift = Math.hypot(dx, dy);
      if (shift > pose.radius * 0.5 && found.confidence < 0.55) {
        recovering = true;
        centreCandidate = null;
        radiusCandidate = null;
        poseCandidate = null;
        const wide = wideMatch(found);
        if (considerCandidate(video, wide)) {
          return acceptCandidate(found, video, wide, mapping, windowFraction);
        }
        beginSearch();
        return finish(windowFraction, {
          held: true,
          confidence: found.confidence,
          rawCx: video.cx,
          rawCy: video.cy,
          rawRadius: video.radius,
          poseRejectReason: 'centre-rejected',
        });
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
      const proposedRotation = dial?.estimateDeg ?? pose.rotationDeg;
      const rotDelta = Math.abs(wrapDelta(pose.rotationDeg, proposedRotation));
      const dialOk = Boolean(dial?.ok);
      const surprisingSpin = Boolean(reference) && dialOk && rotDelta > ROTATION_BIN_DEG;
      const unrecognized = Boolean(reference) && !dialOk;
      const quiet = Math.max(1.25, pose.radius * CENTRE_QUIET_FRACTION);
      const immediate = pose.radius * CENTRE_IMMEDIATE_FRACTION;
      const beforeCx = pose.cx;
      const beforeCy = pose.cy;
      let poseRejectReason = null;
      let posePending = false;
      let geometryHeld = false;
      let skipNormal = false;
      const needsJoint = Boolean(reference) && shift >= quiet && (surprisingSpin || (unrecognized && shift >= immediate));
      if (needsJoint) {
        const proposal = {
          cx: video.cx,
          cy: video.cy,
          radius: video.radius,
          rotationDeg: proposedRotation,
        };
        const agree = pose.radius * CENTRE_AGREE_FRACTION;
        const same = poseCandidate
          && Math.hypot(video.cx - poseCandidate.cx, video.cy - poseCandidate.cy) <= agree
          && Math.abs(video.radius - poseCandidate.radius) <= pose.radius * RADIUS_QUIET_FRACTION
          && Math.abs(wrapDelta(poseCandidate.rotationDeg, proposedRotation)) <= ROTATION_AGREE_DEG;
        poseCandidate = same
          ? { ...proposal, hits: poseCandidate.hits + 1 }
          : { ...proposal, hits: 1 };
        let spinOk = !surprisingSpin;
        // The dial proposed a spin. The needle can veto it, not create it.
        if (surprisingSpin && poseCandidate.hits >= 2) {
          const coarse = detectNeedleAngle(
            image,
            found.cx,
            found.cy,
            found.radius * TIP_INNER_RATIO,
            found.radius * OUTER_RADIUS_RATIO,
          );
          const needleStep = wrapDelta(maskNeedleDeg ?? coarse.angleDeg, coarse.angleDeg);
          const rotationStep = wrapDelta(pose.rotationDeg, proposedRotation);
          spinOk = coarse.quality >= 0.18
            && Math.abs(wrapDelta(needleStep, rotationStep)) <= ROTATION_RIGID_DEG;
        }
        if (poseCandidate.hits >= 2 && spinOk) {
          pose = {
            cx: video.cx,
            cy: video.cy,
            radius: clamp(video.radius, baseRadius * 0.82, baseRadius * 1.2),
            rotationDeg: pose.rotationDeg,
          };
          if (dialOk) trustedRotationDeg = dial.estimateDeg;
          poseCandidate = null;
          centreCandidate = null;
          radiusCandidate = null;
        } else {
          posePending = true;
          poseRejectReason = surprisingSpin ? 'pose-inconsistent' : 'dial-unrecognized';
          geometryHeld = shift >= immediate;
          centreCandidate = null;
          radiusCandidate = null;
          if (geometryHeld) {
            const wide = wideMatch(found);
            if (considerCandidate(video, wide)) {
              return acceptCandidate(found, video, wide, mapping, windowFraction);
            }
            lossStreak += 1;
            if (shift >= pose.radius * SEARCH_ENTER_FRACTION || lossStreak >= SEARCH_LOSS_FRAMES) {
              beginSearch();
            }
          }
        }
        skipNormal = true;
      }

      if (!skipNormal) {
        poseCandidate = null;
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
      }

      recovering = false;
      if (!geometryHeld) {
        lossStreak = 0;
        searchMisses = 0;
        searchCandidate = null;
        reacquireReason = null;
        observed = null;
        mode = 'locked';
      }
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
        held: geometryHeld,
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
    trackOrientation(profile, needleDeg, { positionHeld = false, needleLikeness = null, rimConfidence = null } = {}) {
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
        poseBlocked: false,
        posePending: false,
        poseRejectReason: null,
        poseQuality: null,
        poseDeltaRot: 0,
        ...fields,
        referenceCaptured: reference != null,
      });
      if (!pose || positionHeld || !profile || needleDeg == null) {
        rotationCandidate = null;
        return orientResult({ held: true });
      }
      if (!reference) {
        const identified = needleLikeness >= NEEDLE_LIKENESS_GATE && rimConfidence >= CONFIDENCE_MIN;
        if (!identified) return orientResult({ held: false });
        reference = profile.slice();
        referenceFace = observedFace ? observedFace.slice() : null;
        referenceNeedleDeg = needleDeg;
        rememberNeedle();
        rotationCandidate = null;
        rotationVelocity = 0;
        pose = { ...pose, rotationDeg: 0 };
        return orientResult({
          rotationDeg: 0,
          rawRotationDeg: 0,
          confidence: 1,
          captured: true,
          poseQuality: 1,
        });
      }
      const needleStep = wrapDelta(maskNeedleDeg ?? needleDeg, needleDeg);
      const agrees = (estimateDeg) => {
        const proposed = wrapDelta(pose.rotationDeg, estimateDeg);
        return Math.abs(wrapDelta(needleStep, proposed)) <= ROTATION_RIGID_DEG;
      };
      const matchAt = (maxShiftDeg) => {
        const orientationOpts = {
          previousDeg: pose.rotationDeg,
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
      const narrow = matchAt(LOCKED_MAX_SHIFT_DEG);
      let chosen = null;
      let unresolved = false;
      if (narrow.ok && agrees(narrow.estimateDeg)) {
        chosen = narrow;
      } else {
        const wide = matchAt(SEARCH_MAX_SHIFT_DEG);
        const wideAgrees = Boolean(wide.ok && agrees(wide.estimateDeg));
        if (wideAgrees && largeRotationSupported(wide)) {
          chosen = wide;
        } else if (wideAgrees || !narrow.ok || Math.abs(wrapDelta(pose.rotationDeg, narrow.estimateDeg)) > ROTATION_BIN_DEG) {
          unresolved = true;
        } else {
          chosen = narrow;
        }
      }
      if (unresolved || !chosen) {
        rotationCandidate = null;
        rotationVelocity *= 0.5;
        return orientResult({
          rotationDeg: pose.rotationDeg,
          rawRotationDeg: narrow.estimateDeg ?? pose.rotationDeg,
          confidence: narrow.confidence,
          held: true,
          poseBlocked: true,
          posePending: true,
          poseRejectReason: 'rotation-unconfirmed',
          poseQuality: narrow.confidence,
          stableNeedleDeg: maskNeedleDeg,
        });
      }
      const match = chosen;
      const estimate = match.estimateDeg;
      const step = wrapDelta(pose.rotationDeg, estimate);
      const magnitude = Math.abs(step);
      const rigid = Math.abs(wrapDelta(needleStep, step)) <= ROTATION_RIGID_DEG;
      let next = pose.rotationDeg;
      let poseBlocked = false;
      let posePending = false;
      let poseRejectReason = null;
      const continuing = Math.abs(rotationVelocity) >= 1
        && magnitude <= ROTATION_BIN_DEG
        && Math.abs(wrapDelta(rotationVelocity, step)) <= ROTATION_AGREE_DEG;
      const trustedOk = trusted != null && Math.abs(wrapDelta(trusted, estimate)) <= ROTATION_AGREE_DEG;
      const repeated = rotationCandidate != null && Math.abs(wrapDelta(rotationCandidate, estimate)) <= ROTATION_AGREE_DEG;
      const large = magnitude > ROTATION_BIN_DEG;
      if (magnitude < ROTATION_QUIET_DEG) {
        rotationCandidate = null;
        rotationVelocity *= 0.5;
      } else if ((!large && (continuing || repeated)) || (large && rigid && (trustedOk || repeated))) {
        next = estimate;
        rotationVelocity = wrapDelta(pose.rotationDeg, next);
        rotationCandidate = null;
      } else {
        rotationCandidate = estimate;
        rotationVelocity *= 0.5;
        posePending = true;
        poseRejectReason = 'rotation-unconfirmed';
        poseBlocked = large;
      }
      const poseDeltaRot = wrapDelta(pose.rotationDeg, next);
      pose = { ...pose, rotationDeg: next };
      if (!poseBlocked) rememberNeedle();
      return orientResult({
        rotationDeg: next,
        rawRotationDeg: estimate,
        confidence: match.confidence,
        held: false,
        poseBlocked,
        posePending,
        poseRejectReason,
        poseQuality: match.confidence,
        poseDeltaRot,
        stableNeedleDeg: poseBlocked ? maskNeedleDeg : null,
      });
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

function resampleCrop(image, crop, maxOutput) {
  const output = Math.min(crop.size, maxOutput);
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

function drawCrop(video, canvas, crop, maxOutput) {
  const output = Math.min(crop.size, maxOutput);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = output;
  canvas.height = output;
  context.drawImage(video, crop.originX, crop.originY, crop.size, crop.size, 0, 0, output, output);
  return {
    image: context.getImageData(0, 0, output, output),
    scale: output / crop.size,
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
}) {
  const center = position.pose;
  const localRadius = center.radius * needleScale;
  const detection = detectNeedleAngle(
    needleImage,
    (center.cx - needleCrop.originX) * needleScale,
    (center.cy - needleCrop.originY) * needleScale,
    localRadius * TIP_INNER_RATIO,
    localRadius * OUTER_RADIUS_RATIO,
  );
  const orientation = tracker.trackOrientation(position.profile, detection.angleDeg, {
    positionHeld: position.held,
    needleLikeness: detection.likeness,
    rimConfidence: position.confidence,
  });
  const settled = tracker.getPose() || center;
  const minDim = Math.min(videoWidth, videoHeight);
  const publishedNeedle = orientation.poseBlocked && orientation.stableNeedleDeg != null
    ? orientation.stableNeedleDeg
    : detection.angleDeg;
  return {
    ...detection,
    relativeAngleDeg: wrap360(publishedNeedle - orientation.rotationDeg),
    videoWidth,
    videoHeight,
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
      held: Boolean(position.held || orientation.poseBlocked),
      poseQuality: orientation.poseQuality ?? position.poseQuality ?? null,
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
      referenceCaptured: orientation.referenceCaptured === true,
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
  });
}

/** Crop around the tracked gauge, update its pose, then read the needle from that pose. */
export function readTrackedGauge(video, canvas, region, tracker) {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight || !region) return null;
  if (!tracker.getPose()) {
    tracker.seed({
      cx: region.nx * videoWidth,
      cy: region.ny * videoHeight,
      radius: region.nr * Math.min(videoWidth, videoHeight),
    });
  }

  const pose = tracker.getPose();
  const capture = tracker.captureSpec();
  const trackCrop = squareCrop(videoWidth, videoHeight, pose.cx, pose.cy, pose.radius * capture.pad);
  if (!trackCrop) return null;
  const tracked = drawCrop(video, canvas, trackCrop, capture.maxOutput);
  const position = tracker.trackPosition(tracked.image, {
    originX: trackCrop.originX,
    originY: trackCrop.originY,
    scale: tracked.scale,
  });
  if (!position) return null;

  const center = position.pose;
  const needleCrop = squareCrop(videoWidth, videoHeight, center.cx, center.cy, center.radius * 1.08);
  if (!needleCrop) return null;
  const needle = drawCrop(video, canvas, needleCrop, 420);
  return completeReading({
    videoWidth,
    videoHeight,
    position,
    tracker,
    needleImage: needle.image,
    needleCrop,
    needleScale: needle.scale,
  });
}
