import { NEEDLE_LIKENESS_GATE, OUTER_RADIUS_RATIO, TIP_INNER_RATIO } from './gaugeConfig.js';
import { grayscale, prepareEdges } from './framePrep.js';

/**
 * Needle angle around a known hub.
 * Each angle is a radial segment, not a single strong edge. A tick, numeral,
 * or bezel arc can be darker than the needle at one radius and still lose,
 * because it does not run continuously from the inner part of the search
 * window toward the rim. A face stroke that begins further out fails that
 * inner-reach test even when the stroke is long.
 * Angles are scanned every 2°. The strongest coarse peaks are then measured
 * at 1° so a needle lying between coarse samples is not skipped.
 * Nothing here maps angle to pressure.
 */

const SAMPLE_COUNT = 32;
const ANGLE_STEP = 2;
/**
 * Share of the needle window that sits against the hub.
 * The window already starts outside the pivot (TIP_INNER_RATIO). A pointer
 * that enters this window has evidence in that inner share. A printed radial
 * stroke that begins further out does not, however far it then runs.
 */
const INNER_WINDOW = 0.16;

function sample(gray, width, height, x, y) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= width || yi >= height) return null;
  return gray[yi * width + xi];
}

function median(values) {
  const copy = Array.from(values);
  copy.sort((a, b) => a - b);
  return copy[Math.floor(copy.length / 2)];
}

/**
 * Both faces of a needle match. A sleeve step is bright on one side only.
 * High-pass ringing can make the dark side barely positive; the darker side
 * still has to carry at least half the contrast of the brighter side.
 */
function twoSidedContrast(left, right, center) {
  const leftContrast = left - center;
  const rightContrast = right - center;
  if (leftContrast <= 0 || rightContrast <= 0) return 0;
  const weaker = Math.min(leftContrast, rightContrast);
  const stronger = Math.max(leftContrast, rightContrast);
  if (weaker * 2 < stronger) return 0;
  return weaker;
}

/**
 * Lateral distances for one ray.
 * The narrow end is the old 2–4 px probe. A ray 1° off the pointer, which is
 * as far as the 2° scan can miss, is shifted by about that angle at the outer
 * radius, so the search continues past the narrow probe. It does not average
 * those distances: each sample keeps the smallest offset that already shows
 * the ridge, and a wider offset is down-weighted.
 */
function lateralProbes(span, stepDeg = ANGLE_STEP) {
  const needlePx = Math.min(4, Math.max(2, Math.round(span / 18)));
  const radiusOverSpan = OUTER_RADIUS_RATIO / (OUTER_RADIUS_RATIO - TIP_INNER_RATIO);
  const halfStep = Math.sin((stepDeg * Math.PI) / 360);
  const missPx = Math.max(1, Math.round(span * radiusOverSpan * halfStep));
  const comfortable = needlePx + missPx;
  const far = Math.min(10, comfortable + 4);
  const offsets = [];
  for (let offset = 2; offset <= far; offset += 1) offsets.push(offset);
  return { offsets, comfortable };
}

function widthWeight(offset, comfortable) {
  if (offset <= comfortable + 1) return 1;
  return 1 / (1 + (offset - comfortable - 1));
}

/**
 * Dark ridge along one ray.
 * The pointer sits on a white face, so both sides of the ray are brighter than
 * the centre. A sleeve edge or bezel boundary is a step: one side is darker.
 * Scoring `(left + right) / 2 - centre` counted that step as a needle. The
 * step is stable under occlusion, and three agreeing frames then snapped it
 * in as a pressure change. Every lateral distance has to pass the two-sided
 * test on its own. A one-sided step therefore contributes nothing.
 * Circumferential gradients contribute nothing either.
 */
function rayEvidence(gray, edges, width, height, cx, cy, angleDeg, innerR, outerR, stepDeg = ANGLE_STEP) {
  const samples = new Float32Array(SAMPLE_COUNT);
  const probeAt = new Float32Array(SAMPLE_COUNT);
  const span = outerR - innerR;
  if (span < 1) return { samples, probeAt };
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { offsets, comfortable } = lateralProbes(span, stepDeg);
  const contrasts = new Float32Array(offsets.length);
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const r = innerR + span * ((i + 0.5) / SAMPLE_COUNT);
    const x = cx + r * cos;
    const y = cy + r * sin;
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 1 || yi < 1 || xi >= width - 1 || yi >= height - 1) continue;
    const index = yi * width + xi;
    const center = gray[index];
    let peakContrast = 0;
    for (let k = 0; k < offsets.length; k += 1) {
      const offset = offsets[k];
      const left = sample(gray, width, height, x - sin * offset, y + cos * offset);
      const right = sample(gray, width, height, x + sin * offset, y - cos * offset);
      const contrast = left == null || right == null ? 0 : twoSidedContrast(left, right, center);
      contrasts[k] = contrast;
      if (contrast > peakContrast) peakContrast = contrast;
    }
    if (peakContrast <= 0) continue;
    const floor = peakContrast * 0.6;
    let chosen = 0;
    let chosenContrast = 0;
    for (let k = 0; k < offsets.length; k += 1) {
      if (contrasts[k] < floor) continue;
      chosen = offsets[k];
      chosenContrast = contrasts[k];
      break;
    }
    if (chosen <= 0) continue;
    const gx = edges.gx[index];
    const gy = edges.gy[index];
    const across = Math.abs(gx * sin - gy * cos);
    const grad = Math.hypot(gx, gy);
    const alignment = grad > 1 ? across / grad : 0;
    samples[i] = chosenContrast * widthWeight(chosen, comfortable) * (0.35 + 0.65 * alignment);
    probeAt[i] = chosen;
  }
  return { samples, probeAt };
}

function emptyProfile() {
  return {
    score: 0,
    likeness: 0,
    coverage: 0,
    continuity: 0,
    reach: 0,
    innerReach: 0,
    startIndex: -1,
    endIndex: -1,
    probePx: 0,
  };
}

/**
 * Reward a continuous dark segment with evidence in the inner part of the window.
 * A mark that exists only near the rim, only as scattered dots, or only after
 * the inner share of the window, collapses. The inner test is a count of
 * samples in that share, not a demand that the stroke touch the hub pixel.
 */
function scoreProfile(samples) {
  const n = samples.length;
  if (!n) return emptyProfile();
  let total = 0;
  for (let i = 0; i < n; i += 1) total += samples[i];
  const mean = total / n;
  if (mean <= 1e-4) return emptyProfile();

  const hitLevel = mean * 0.5;
  const innerLevel = mean * 0.35;
  const bodyCount = Math.max(1, Math.round(n * 0.68));
  const innerSlots = Math.max(3, Math.round(n * INNER_WINDOW));
  const innerNeed = Math.max(2, Math.ceil(innerSlots * 0.5));
  let hits = 0;
  let run = 0;
  let gap = 0;
  let longest = 0;
  let bodySum = 0;
  let outerSum = 0;
  let innerHits = 0;
  let startIndex = -1;
  let endIndex = -1;
  for (let i = 0; i < n; i += 1) {
    const value = samples[i];
    if (i < bodyCount) bodySum += value;
    else outerSum += value;
    if (i < innerSlots && value >= innerLevel) innerHits += 1;
    if (value >= hitLevel) {
      if (startIndex < 0) startIndex = i;
      endIndex = i;
      hits += 1;
      run += 1 + gap;
      gap = 0;
      if (run > longest) longest = run;
    } else if (run > 0 && gap < 1) {
      gap += 1;
    } else {
      run = 0;
      gap = 0;
    }
  }

  const coverage = hits / n;
  const continuity = longest / n;
  const bodyMean = bodySum / bodyCount;
  const outerMean = outerSum / Math.max(1, n - bodyCount);
  const bodyShare = bodyMean / (bodyMean + outerMean + 1e-3);
  // A uniform needle has bodyShare near 0.5. Squaring drops a rim-only mark faster than a soft pointer.
  const rimReach = Math.min(1, (bodyShare * 2) ** 2);
  const innerReach = innerHits >= innerNeed ? 1 : 0;
  const reach = innerReach * rimReach;
  const likeness = Math.min(1, coverage * (0.3 + 0.7 * continuity) * reach);
  return {
    score: mean * likeness,
    likeness,
    coverage,
    continuity,
    reach,
    innerReach,
    startIndex,
    endIndex,
    probePx: 0,
  };
}

const EXTENT_GAP = 2;

/**
 * How far a dark run stays connected to the hub.
 * A gap of two samples can be a tick crossing the pointer. A larger gap ends
 * the pointer, so a speck further out does not make the tail the long end.
 */
export function coherentEndIndex(samples) {
  const n = samples?.length ?? 0;
  if (!n) return -1;
  let total = 0;
  for (let i = 0; i < n; i += 1) total += samples[i];
  const mean = total / n;
  if (mean <= 1e-4) return -1;
  const level = mean * 0.45;
  const innerSlots = Math.max(3, Math.round(n * INNER_WINDOW));
  let start = -1;
  for (let i = 0; i < innerSlots; i += 1) {
    if (samples[i] >= level) {
      start = i;
      break;
    }
  }
  if (start < 0) return -1;
  let end = start;
  let gap = 0;
  for (let i = start + 1; i < n; i += 1) {
    if (samples[i] >= level) {
      end = i;
      gap = 0;
    } else {
      gap += 1;
      if (gap > EXTENT_GAP) break;
    }
  }
  return end;
}

/** Wider at the hub than at the tip. A blob or a band does not taper. */
export function rayTaper(probeAt, samples, endIndex) {
  if (!probeAt || endIndex < 4) return 0;
  const inner = [];
  const outer = [];
  const split = Math.max(1, Math.floor((endIndex + 1) / 2));
  for (let i = 0; i <= endIndex; i += 1) {
    if (!(samples[i] > 0) || !(probeAt[i] > 0)) continue;
    (i < split ? inner : outer).push(probeAt[i]);
  }
  if (!inner.length || !outer.length) return 0;
  const innerMed = median(inner);
  const outerMed = median(outer);
  if (innerMed <= 0) return 0;
  return (innerMed - outerMed) / innerMed;
}

export function pointerMerit(profile) {
  const samples = profile?.samples;
  const end = coherentEndIndex(samples);
  const taper = rayTaper(profile?.probeAt, samples, end);
  const extent = end < 0 ? 0 : (end + 1) / (samples?.length || 1);
  const tapered = taper > 0.05 ? taper : 0;
  return { end, taper, merit: extent * (1 + 0.4 * tapered) };
}

/**
 * The long end is the ray with greater coherent reach from the hub.
 * Taper breaks a near tie. A disconnected speck beyond the tail does not count.
 * needleEnd is `long` when the chosen ray is that longer end.
 */
export function selectPointerEnd(leader, opposite) {
  const leaderMerit = pointerMerit(leader);
  const oppositeMerit = pointerMerit(opposite);
  const takeOpposite = oppositeMerit.merit > leaderMerit.merit + 0.02;
  const chosen = takeOpposite ? oppositeMerit : leaderMerit;
  const other = takeOpposite ? leaderMerit : oppositeMerit;
  const needleEnd = chosen.end >= other.end ? 'long' : 'tail';
  return {
    takeOpposite,
    needleEnd,
    leaderEnd: leaderMerit.end,
    oppositeEnd: oppositeMerit.end,
  };
}

function probeDistance(probeAt, samples) {
  const used = [];
  for (let i = 0; i < samples.length; i += 1) {
    if (samples[i] > 0 && probeAt[i] > 0) used.push(probeAt[i]);
  }
  if (!used.length) return 0;
  return median(used);
}

function coarsePeaks(raw, bestRaw) {
  if (bestRaw <= 1e-4) return [];
  const found = [];
  const floor = bestRaw * 0.35;
  for (let deg = 0; deg < 360; deg += ANGLE_STEP) {
    if (raw[deg] < floor) continue;
    const prev = raw[(deg - ANGLE_STEP + 360) % 360];
    const next = raw[(deg + ANGLE_STEP) % 360];
    if (raw[deg] + 1e-6 < prev || raw[deg] + 1e-6 < next) continue;
    found.push(deg);
  }
  found.sort((a, b) => raw[b] - raw[a]);
  return found.slice(0, 3);
}

function emptyDetection(angleDeg = 0) {
  return {
    angleDeg,
    quality: 0,
    peak: 0,
    second: 0,
    oppositeScore: 0,
    secondAngleDeg: null,
    margin: 0,
    likeness: 0,
    innerReach: 0,
    coverage: 0,
    continuity: 0,
    startRadius: null,
    probePx: 0,
    needleEnd: 'long',
  };
}

function startRadiusOf(startIndex, innerR, outerR) {
  if (startIndex < 0 || !(innerR > 0)) return null;
  const gaugeRadius = innerR / TIP_INNER_RATIO;
  const radius = innerR + (outerR - innerR) * ((startIndex + 0.5) / SAMPLE_COUNT);
  return radius / gaugeRadius;
}

const HINT_HALF_DEG = 32;
const HINT_STEP_DEG = 4;
const SPARSE_STEP_DEG = 20;
/**
 * Share of hub samples that must be a dark two-sided ridge.
 * A specular streak on the cover is dark on the face and bright at the pivot.
 * When any ray does reach the pivot, a face-only streak cannot be the needle.
 * When the pivot is unreadable, the face scores stand unchanged.
 */
export const HUB_CONNECTION_MIN = 0.5;
const HUB_INNER_FRACTION = 0.12;

/**
 * Full circle on a cold start. After that, a window around the last angle
 * and its opposite, plus a sparse ring so the face median still sees the dial.
 */
function scanAngles(hintDeg) {
  if (!Number.isFinite(hintDeg)) {
    const angles = [];
    for (let deg = 0; deg < 360; deg += ANGLE_STEP) angles.push(deg);
    return { angles, probeStep: ANGLE_STEP, hinted: false };
  }
  const chosen = new Set();
  const add = (deg) => {
    chosen.add(((Math.round(deg) % 360) + 360) % 360);
  };
  for (let deg = 0; deg < 360; deg += SPARSE_STEP_DEG) add(deg);
  for (const origin of [hintDeg, hintDeg + 180]) {
    for (let delta = -HINT_HALF_DEG; delta <= HINT_HALF_DEG; delta += HINT_STEP_DEG) add(origin + delta);
  }
  return { angles: [...chosen], probeStep: HINT_STEP_DEG, hinted: true };
}

/**
 * Dark ridge from just outside the screw to the start of the face window.
 * Returns the fraction of those samples that are darker than both sides.
 * A bright core (specular) contributes nothing.
 */
export function hubConnection(raw, width, height, cx, cy, angleDeg, innerR) {
  const faceR = innerR / TIP_INNER_RATIO;
  const r0 = faceR * HUB_INNER_FRACTION;
  const r1 = innerR;
  if (!(r1 > r0 + 1)) return 1;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const steps = 6;
  let hits = 0;
  let n = 0;
  for (let i = 0; i < steps; i += 1) {
    const r = r0 + (r1 - r0) * ((i + 0.5) / steps);
    const x = cx + r * cos;
    const y = cy + r * sin;
    const center = sample(raw, width, height, x, y);
    if (center == null) continue;
    let contrast = 0;
    for (const offset of [2, 3]) {
      const left = sample(raw, width, height, x - sin * offset, y + cos * offset);
      const right = sample(raw, width, height, x + sin * offset, y - cos * offset);
      if (left == null || right == null) continue;
      contrast = Math.max(contrast, twoSidedContrast(left, right, center));
    }
    n += 1;
    if (contrast >= 6) hits += 1;
  }
  if (n < 3) return 0;
  return hits / n;
}

export function detectNeedleAngle(image, cx, cy, innerR, outerR, sink = null, hintDeg = null) {
  if (!(outerR > innerR + 1)) return emptyDetection();
  const contrastRadius = Math.max(3, Math.round((outerR - innerR) / 3));
  const { gray, edges, width, height } = prepareEdges(image, { contrastRadius });
  const rawLuma = grayscale(image.data, width, height);
  if (sink) sink.edges = edges;
  const scan = scanAngles(hintDeg);
  const evidence = scan.angles.map((deg) => (
    rayEvidence(gray, edges, width, height, cx, cy, deg, innerR, outerR, scan.probeStep)
  ));

  const medianProfile = new Float32Array(SAMPLE_COUNT);
  const column = new Float32Array(evidence.length);
  for (let s = 0; s < SAMPLE_COUNT; s += 1) {
    for (let i = 0; i < evidence.length; i += 1) column[i] = evidence[i].samples[s];
    medianProfile[s] = median(column);
  }

  const scratch = new Float32Array(SAMPLE_COUNT);
  const scoreAngle = (angleDeg, stored) => {
    const ray = stored || rayEvidence(gray, edges, width, height, cx, cy, angleDeg, innerR, outerR);
    for (let s = 0; s < SAMPLE_COUNT; s += 1) scratch[s] = Math.max(0, ray.samples[s] - medianProfile[s]);
    const profile = scoreProfile(scratch);
    profile.probePx = probeDistance(ray.probeAt, scratch);
    profile.samples = Float32Array.from(scratch);
    profile.probeAt = Float32Array.from(ray.probeAt);
    return profile;
  };

  const raw = new Float32Array(360);
  let best = 0;
  let bestProfile = emptyProfile();
  bestProfile.score = -1;
  for (let i = 0; i < scan.angles.length; i += 1) {
    const deg = scan.angles[i];
    const scored = scoreAngle(deg, evidence[i]);
    raw[deg] = scored.score;
    if (scored.score > bestProfile.score) {
      bestProfile = scored;
      best = deg;
    }
  }

  // Rank the raw ridge. Neighbour support used to multiply the score before
  // the argmax, so a broader but weaker mark (a sleeve boundary, a wide tick)
  // could outrank the darker needle and then report a near-zero margin.
  // Refinement used to run only around that coarse winner. A real needle
  // lying between the 2° samples could then lose to an on-grid face mark
  // and never be measured. Each competing coarse peak is measured at 1°.
  const measured = [];
  const refineRadius = scan.hinted ? 2 : 1;
  for (const peak of coarsePeaks(raw, raw[best])) {
    let peakScore = raw[peak];
    let peakAngle = peak;
    for (let step = -refineRadius; step <= refineRadius; step += 1) {
      if (step === 0) continue;
      const wrapped = (peak + step + 360) % 360;
      const scored = scoreAngle(wrapped, null);
      if (scored.score > peakScore) {
        peakScore = scored.score;
        peakAngle = wrapped;
      }
      if (scored.score > bestProfile.score) {
        bestProfile = scored;
        best = wrapped;
      }
    }
    measured.push({ angle: peakAngle, score: peakScore });
  }

  const hubOf = (deg) => hubConnection(rawLuma, width, height, cx, cy, deg, innerR);

  const opposite = (best + 180) % 360;
  const oppositeIndex = scan.angles.indexOf(opposite);
  const oppositeProfile = scoreAngle(opposite, oppositeIndex >= 0 ? evidence[oppositeIndex] : null);
  const chosenEnd = selectPointerEnd(bestProfile, oppositeProfile);
  if (chosenEnd.takeOpposite) {
    best = opposite;
    bestProfile = oppositeProfile;
  }

  const bestScore = bestProfile.score < 0 ? 0 : bestProfile.score;
  const bestLikeness = bestProfile.likeness;
  const oppositeScore = oppositeProfile.score;

  let second = 0;
  let secondAngle = null;
  for (let deg = 0; deg < 360; deg += ANGLE_STEP) {
    let distance = Math.abs(deg - best);
    if (distance > 180) distance = 360 - distance;
    if (distance <= 12) continue;
    if (raw[deg] > second) {
      second = raw[deg];
      secondAngle = deg;
    }
  }
  for (const item of measured) {
    let distance = Math.abs(item.angle - best);
    if (distance > 180) distance = 360 - distance;
    if (distance <= 12) continue;
    if (item.score > second) {
      second = item.score;
      secondAngle = item.angle;
    }
  }
  const margin = bestScore <= 1e-4 ? 0 : Math.max(0, Math.min(1, (bestScore - second) / bestScore));
  const quality = margin * Math.min(1, bestLikeness / NEEDLE_LIKENESS_GATE);
  return {
    angleDeg: best,
    quality,
    peak: bestScore,
    second,
    oppositeScore,
    secondAngleDeg: secondAngle,
    margin,
    likeness: bestLikeness,
    innerReach: bestProfile.innerReach,
    coverage: bestProfile.coverage,
    continuity: bestProfile.continuity,
    startRadius: startRadiusOf(bestProfile.startIndex, innerR, outerR),
    probePx: bestProfile.probePx,
    needleEnd: chosenEnd.needleEnd,
    hub: hubOf(best),
  };
}

/** Crop the unmirrored video around a fixed circle and estimate the needle. */
export function readNeedleFromVideo(video, canvas, region) {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight || !region) return null;

  const centerX = region.nx * videoWidth;
  const centerY = region.ny * videoHeight;
  const radius = region.nr * Math.min(videoWidth, videoHeight);
  const pad = Math.max(8, Math.round(radius * 1.05));
  let originX = Math.round(centerX - pad);
  let originY = Math.round(centerY - pad);
  let size = pad * 2;
  if (originX < 0) originX = 0;
  if (originY < 0) originY = 0;
  if (originX + size > videoWidth) size = videoWidth - originX;
  if (originY + size > videoHeight) size = videoHeight - originY;
  if (size < 16) return null;

  const output = Math.min(size, 420);
  canvas.width = output;
  canvas.height = output;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(video, originX, originY, size, size, 0, 0, output, output);
  const image = context.getImageData(0, 0, output, output);
  const scale = output / size;
  const localRadius = radius * scale;
  const detection = detectNeedleAngle(
    image,
    (centerX - originX) * scale,
    (centerY - originY) * scale,
    localRadius * TIP_INNER_RATIO,
    localRadius * OUTER_RADIUS_RATIO,
  );

  return {
    ...detection,
    videoWidth,
    videoHeight,
  };
}
