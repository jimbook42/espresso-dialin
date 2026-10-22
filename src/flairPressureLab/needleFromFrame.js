import {
  NEEDLE_LIKENESS_GATE,
  NEEDLE_TRACK_QUALITY,
  OUTER_RADIUS_RATIO,
  TIP_INNER_RATIO,
} from './gaugeConfig.js';
import { prepareEdges } from './framePrep.js';

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
 * Smallest dial radius, in source pixels, at which the pointer span still
 * has one sample per pixel. Below this the ridge test is interpolating.
 * The span is the same window the detector walks (inner tip to outer stop).
 */
export function minReadableDialRadiusPx() {
  const spanRatio = OUTER_RADIUS_RATIO - TIP_INNER_RATIO;
  return SAMPLE_COUNT / spanRatio;
}

/**
 * Scale that brings a crop to the radius the sampler can actually read.
 * An unlocked circle with at least half a sample per pixel stays native:
 * a mild resample smears a ridge the tracker has not accepted.
 * A locked face under the readable radius, but still large enough to be a
 * dial, is enlarged up to that radius and never past 4×.
 * A face that is already large enough stays at its native scale.
 */
export function needleZoomForRadius(radiusPx, { locked = false } = {}) {
  if (!(radiusPx > 0)) return 1;
  const need = minReadableDialRadiusPx();
  const factor = need / radiusPx;
  if (factor <= 1) return 1;
  if (!locked && factor < 2) return 1;
  // A fraction under the sampler (a dry dial) stays native: that resample
  // smears the ridge. A locked face clearly below it is enlarged. A speck
  // is not.
  if (locked && (factor < 1.08 || factor >= 1.45)) return 1;
  return Math.min(4, factor);
}

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

/** kth smallest. Same value as sorting and indexing, and it mutates `arr`. */
function selectNth(arr, k, len) {
  let left = 0;
  let right = len - 1;
  while (left < right) {
    const pivot = arr[right];
    let store = left;
    for (let i = left; i < right; i += 1) {
      if (arr[i] < pivot) {
        const tmp = arr[store];
        arr[store] = arr[i];
        arr[i] = tmp;
        store += 1;
      }
    }
    arr[right] = arr[store];
    arr[store] = pivot;
    if (store === k) return arr[k];
    if (store < k) left = store + 1;
    else right = store - 1;
  }
  return arr[left];
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
  const needlePx = Math.min(4, Math.max(1, Math.round(span / 18)));
  const radiusOverSpan = OUTER_RADIUS_RATIO / (OUTER_RADIUS_RATIO - TIP_INNER_RATIO);
  const halfStep = Math.sin((stepDeg * Math.PI) / 360);
  const missPx = Math.max(1, Math.round(span * radiusOverSpan * halfStep));
  const comfortable = Math.max(needlePx, 2) + missPx;
  // A phone-sized face has a pointer many pixels wide. A 10px cap never
  // reaches the lit face, so the black centre scores nothing and a thin tick wins.
  const far = Math.min(32, Math.max(comfortable + 4, Math.round(span * 0.2)));
  // A face under about 48px has a pointer thinner than the old 2px probe.
  // That probe steps over the ridge and the ray is refused. A wider face
  // keeps the 2px start so a dry dial is scored the same way.
  const minOffset = span < 30 ? 1 : 2;
  const offsets = [];
  for (let offset = minOffset; offset <= far; offset += 1) offsets.push(offset);
  return { offsets, comfortable };
}

const contrastScratch = new Float32Array(32);
const probeCache = new Map();
const DEG_COS = new Float64Array(360);
const DEG_SIN = new Float64Array(360);
for (let deg = 0; deg < 360; deg += 1) {
  const rad = (deg * Math.PI) / 180;
  DEG_COS[deg] = Math.cos(rad);
  DEG_SIN[deg] = Math.sin(rad);
}
const lateralX = new Float64Array(32);
const lateralY = new Float64Array(32);

function cachedLateralProbes(span, stepDeg) {
  const key = `${span}:${stepDeg}`;
  let found = probeCache.get(key);
  if (!found) {
    found = lateralProbes(span, stepDeg);
    probeCache.set(key, found);
  }
  return found;
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
function rayEvidence(gray, edges, width, height, cx, cy, angleDeg, innerR, outerR, stepDeg = ANGLE_STEP, samples = null, probeAt = null) {
  if (!samples) samples = new Float32Array(SAMPLE_COUNT);
  else samples.fill(0);
  if (!probeAt) probeAt = new Float32Array(SAMPLE_COUNT);
  else probeAt.fill(0);
  const span = outerR - innerR;
  if (span < 1) return { samples, probeAt };
  const degInt = angleDeg | 0;
  const cos = degInt === angleDeg && degInt >= 0 && degInt < 360
    ? DEG_COS[degInt]
    : Math.cos((angleDeg * Math.PI) / 180);
  const sin = degInt === angleDeg && degInt >= 0 && degInt < 360
    ? DEG_SIN[degInt]
    : Math.sin((angleDeg * Math.PI) / 180);
  const { offsets, comfortable } = cachedLateralProbes(span, stepDeg);
  const offsetCount = offsets.length;
  for (let k = 0; k < offsetCount; k += 1) {
    lateralX[k] = sin * offsets[k];
    lateralY[k] = cos * offsets[k];
  }
  const gxA = edges.gx;
  const gyA = edges.gy;
  const limitX = width - 1;
  const limitY = height - 1;
  const comfort = comfortable + 1;
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const r = innerR + span * ((i + 0.5) / SAMPLE_COUNT);
    const x = cx + r * cos;
    const y = cy + r * sin;
    const xi = (x + 0.5) | 0;
    const yi = (y + 0.5) | 0;
    if (xi < 1 || yi < 1 || xi >= limitX || yi >= limitY) continue;
    const index = yi * width + xi;
    const center = gray[index];
    let peakContrast = 0;
    for (let k = 0; k < offsetCount; k += 1) {
      const lxi = ((x - lateralX[k]) + 0.5) | 0;
      const lyi = ((y + lateralY[k]) + 0.5) | 0;
      const rxi = ((x + lateralX[k]) + 0.5) | 0;
      const ryi = ((y - lateralY[k]) + 0.5) | 0;
      let contrast = 0;
      if (lxi >= 0 && lyi >= 0 && lxi < width && lyi < height && rxi >= 0 && ryi >= 0 && rxi < width && ryi < height) {
        const leftContrast = gray[lyi * width + lxi] - center;
        const rightContrast = gray[ryi * width + rxi] - center;
        if (leftContrast > 0 && rightContrast > 0) {
          const weaker = leftContrast < rightContrast ? leftContrast : rightContrast;
          const stronger = leftContrast > rightContrast ? leftContrast : rightContrast;
          if (weaker * 2 >= stronger) contrast = weaker;
        }
      }
      contrastScratch[k] = contrast;
      if (contrast > peakContrast) peakContrast = contrast;
    }
    if (peakContrast <= 0) continue;
    const floor = peakContrast * 0.6;
    let chosen = 0;
    let chosenContrast = 0;
    for (let k = 0; k < offsetCount; k += 1) {
      if (contrastScratch[k] < floor) continue;
      chosen = offsets[k];
      chosenContrast = contrastScratch[k];
      break;
    }
    if (chosen <= 0) continue;
    const gx = gxA[index];
    const gy = gyA[index];
    const across = Math.abs(gx * sin - gy * cos);
    const grad = Math.hypot(gx, gy);
    const alignment = grad > 1 ? across / grad : 0;
    const weight = chosen <= comfort ? 1 : 1 / (1 + (chosen - comfort));
    samples[i] = chosenContrast * weight * (0.35 + 0.65 * alignment);
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
  const span = faceR * (OUTER_RADIUS_RATIO - TIP_INNER_RATIO);
  const offsets = span < 30 ? [1, 2] : [2, 4, 8, 14];
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
    for (const offset of offsets) {
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

function parabolicAngleOffset(left, mid, right) {
  const denom = left - 2 * mid + right;
  if (!(denom < -1e-6)) return 0;
  const delta = (0.5 * (left - right)) / denom;
  if (!Number.isFinite(delta)) return 0;
  return Math.max(-0.65, Math.min(0.65, delta));
}

function needleSubDegree(scoreAngle, best, bestScore) {
  if (!(bestScore > 0)) return best;
  const left = scoreAngle((best - 1 + 360) % 360).score;
  const right = scoreAngle((best + 1) % 360).score;
  return ((best + parabolicAngleOffset(left, bestScore, right)) % 360 + 360) % 360;
}

const raySlab = { samples: new Float32Array(0), probes: new Float32Array(0) };
let rayColumn = new Float32Array(0);
const rayRaw = new Float32Array(360);

/**
 * The tip is a thin dark ridge that still touches the hub.
 * A printed numeral is dark on the ray without being a ridge. The script is wide.
 */
function narrowHubLobe(luma, width, height, cx, cy, innerR) {
  const bins = 180;
  const hubMin = new Float64Array(bins);
  const r0 = innerR * 0.75;
  const r1 = innerR * 1.55;
  for (let i = 0; i < bins; i += 1) {
    const rad = ((i * 2) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    let darkest = 255;
    let n = 0;
    for (let s = 0; s < 6; s += 1) {
      const r = r0 + (r1 - r0) * ((s + 0.5) / 6);
      const x = (cx + r * cos + 0.5) | 0;
      const y = (cy + r * sin + 0.5) | 0;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const lum = luma[y * width + x];
      if (lum < darkest) darkest = lum;
      n += 1;
    }
    hubMin[i] = n ? darkest : 255;
  }
  const sorted = Float64Array.from(hubMin);
  sorted.sort();
  const median = sorted[bins >> 1];
  let darkest = 255;
  for (let i = 0; i < bins; i += 1) if (hubMin[i] < darkest) darkest = hubMin[i];
  if (median - darkest < 10) return null;
  const floor = median - 8;
  const radius = innerR / TIP_INNER_RATIO;
  const off = Math.max(2, radius * 0.04);
  let bestDeg = null;
  let bestRidge = 0;
  for (let i = 0; i < bins; i += 1) {
    if (!(hubMin[i] < floor)) continue;
    let widthBins = 0;
    for (let k = -12; k <= 12; k += 1) {
      if (hubMin[(i + k + bins) % bins] < floor) widthBins += 1;
    }
    if (widthBins > 20) continue;
    const deg = i * 2;
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    let ridge = 0;
    let seen = 0;
    for (let s = 0; s < 8; s += 1) {
      const r = radius * (0.32 + 0.4 * ((s + 0.5) / 8));
      const x = cx + r * cos;
      const y = cy + r * sin;
      const center = sample(luma, width, height, x, y);
      const left = sample(luma, width, height, x - sin * off, y + cos * off);
      const right = sample(luma, width, height, x + sin * off, y - cos * off);
      if (center == null || left == null || right == null) continue;
      seen += 1;
      const contrast = Math.min(left - center, right - center);
      if (contrast > 2) ridge += contrast;
    }
    const reach = seen ? ridge / seen : 0;
    if (reach > bestRidge) {
      bestRidge = reach;
      bestDeg = deg;
    }
  }
  return bestRidge > 1 ? bestDeg : null;
}

export function detectNeedleAngle(image, cx, cy, innerR, outerR, sink = null, hintDeg = null) {
  if (!(outerR > innerR + 1)) return emptyDetection();
  const contrastRadius = Math.max(3, Math.round((outerR - innerR) / 3));
  const prepared = prepareEdges(image, { contrastRadius });
  const { gray, edges, width, height } = prepared;
  const rawLuma = prepared.luma;
  if (sink) {
    sink.edges = edges;
    sink.luma = rawLuma;
  }
  const scan = scanAngles(hintDeg);
  const angleCount = scan.angles.length;
  const slabNeed = angleCount * SAMPLE_COUNT;
  if (raySlab.samples.length < slabNeed) {
    raySlab.samples = new Float32Array(slabNeed);
    raySlab.probes = new Float32Array(slabNeed);
  }
  if (rayColumn.length < angleCount) rayColumn = new Float32Array(angleCount);
  const sampleSlab = raySlab.samples;
  const probeSlab = raySlab.probes;
  const evidence = new Array(angleCount);
  for (let i = 0; i < angleCount; i += 1) {
    const sampleView = sampleSlab.subarray(i * SAMPLE_COUNT, (i + 1) * SAMPLE_COUNT);
    const probeView = probeSlab.subarray(i * SAMPLE_COUNT, (i + 1) * SAMPLE_COUNT);
    evidence[i] = rayEvidence(
      gray, edges, width, height, cx, cy, scan.angles[i], innerR, outerR, scan.probeStep, sampleView, probeView,
    );
  }

  const medianProfile = new Float32Array(SAMPLE_COUNT);
  const column = rayColumn;
  const mid = Math.floor(evidence.length / 2);
  for (let s = 0; s < SAMPLE_COUNT; s += 1) {
    for (let i = 0; i < evidence.length; i += 1) column[i] = evidence[i].samples[s];
    medianProfile[s] = selectNth(column, mid, evidence.length);
  }

  const scratch = new Float32Array(SAMPLE_COUNT);
  const scoreAngle = (angleDeg, stored) => {
    const ray = stored || rayEvidence(gray, edges, width, height, cx, cy, angleDeg, innerR, outerR);
    for (let s = 0; s < SAMPLE_COUNT; s += 1) scratch[s] = Math.max(0, ray.samples[s] - medianProfile[s]);
    const profile = scoreProfile(scratch);
    profile.probePx = probeDistance(ray.probeAt, scratch);
    profile.probeAt = ray.probeAt;
    return profile;
  };
  const keepSamples = (profile) => {
    profile.samples = Float32Array.from(scratch);
    return profile;
  };

  rayRaw.fill(0);
  const raw = rayRaw;
  let best = 0;
  let bestProfile = emptyProfile();
  bestProfile.score = -1;
  for (let i = 0; i < scan.angles.length; i += 1) {
    const deg = scan.angles[i];
    const scored = scoreAngle(deg, evidence[i]);
    raw[deg] = scored.score;
    if (scored.score > bestProfile.score) {
      bestProfile = keepSamples(scored);
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
        bestProfile = keepSamples(scored);
        best = wrapped;
      }
    }
    measured.push({ angle: peakAngle, score: peakScore });
  }

  const hubOf = (deg) => hubConnection(rawLuma, width, height, cx, cy, deg, innerR);
  const lobe = narrowHubLobe(rawLuma, width, height, cx, cy, innerR);
  // The darkest hub ridge is often the short tail or a numeral. It may
  // break a reach tie. It must not replace a pointer that continues further.
  if (lobe != null) {
    const lobeProfile = keepSamples(scoreAngle(lobe, null));
    const lobeEnd = coherentEndIndex(lobeProfile.samples);
    const reachEnd = coherentEndIndex(bestProfile.samples);
    if (lobeEnd >= reachEnd) {
      best = lobe;
      bestProfile = lobeProfile;
    }
  }

  const opposite = (best + 180) % 360;
  const oppositeIndex = scan.angles.indexOf(opposite);
  const oppositeProfile = keepSamples(scoreAngle(opposite, oppositeIndex >= 0 ? evidence[oppositeIndex] : null));
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
  let likenessOut = bestLikeness;
  let quality = margin * Math.min(1, bestLikeness / NEEDLE_LIKENESS_GATE);
  const hub = hubOf(best);
  // A thick pointer is flat black, so the edge likeness stays low and the
  // tracker drops a reading the hub lobe already locked.
  if (lobe != null && hub >= 0.5) {
    if (likenessOut < NEEDLE_LIKENESS_GATE) likenessOut = NEEDLE_LIKENESS_GATE;
    if (quality < NEEDLE_TRACK_QUALITY) quality = NEEDLE_TRACK_QUALITY;
  }
  const subDegree = needleSubDegree(scoreAngle, best, bestScore);
  return {
    angleDeg: subDegree,
    quality,
    peak: bestScore,
    second,
    oppositeScore,
    secondAngleDeg: secondAngle,
    margin,
    likeness: likenessOut,
    innerReach: bestProfile.innerReach,
    coverage: bestProfile.coverage,
    continuity: bestProfile.continuity,
    startRadius: startRadiusOf(bestProfile.startIndex, innerR, outerR),
    probePx: bestProfile.probePx,
    needleEnd: chosenEnd.needleEnd,
    hub,
  };
}

function grayAt(data, width, height, x, y) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= width || yi >= height) return null;
  const o = (yi * width + xi) * 4;
  return data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
}

/**
 * Centre a detector angle on the dark ridge. The 1° scan can sit on the
 * shoulder of a thin pointer; half-degree samples pull it back to the middle.
 */
export function refineNeedleAngle(image, cx, cy, innerR, outerR, hintDeg) {
  if (!image?.data || !Number.isFinite(hintDeg) || !(outerR > innerR + 1)) return hintDeg;
  const { data, width, height } = image;
  const span = outerR - innerR;
  const scoreAt = (deg) => {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    let acc = 0;
    let n = 0;
    for (let i = 0; i < 18; i += 1) {
      const r = innerR + span * ((i + 0.5) / 18);
      const x = cx + r * cos;
      const y = cy + r * sin;
      const center = grayAt(data, width, height, x, y);
      const left = grayAt(data, width, height, x - sin * 2.5, y + cos * 2.5);
      const right = grayAt(data, width, height, x + sin * 2.5, y - cos * 2.5);
      if (center == null || left == null || right == null) continue;
      const contrast = Math.min(left - center, right - center);
      if (contrast > 0) acc += contrast * (i < 9 ? 1.5 : 0.7);
      n += 1;
    }
    return n ? acc / n : 0;
  };
  let bestDeg = hintDeg;
  let best = -1;
  for (let delta = -8; delta <= 8; delta += 0.25) {
    const score = scoreAt(hintDeg + delta);
    if (score > best) {
      best = score;
      bestDeg = hintDeg + delta;
    }
  }
  const step = 0.25;
  const offset = parabolicAngleOffset(scoreAt(bestDeg - step), best, scoreAt(bestDeg + step));
  return ((bestDeg + offset * step) % 360 + 360) % 360;
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
