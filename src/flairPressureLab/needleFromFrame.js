import { NEEDLE_LIKENESS_GATE, OUTER_RADIUS_RATIO, TIP_INNER_RATIO } from './gaugeConfig.js';
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
function lateralProbes(span) {
  const needlePx = Math.min(4, Math.max(2, Math.round(span / 18)));
  const radiusOverSpan = OUTER_RADIUS_RATIO / (OUTER_RADIUS_RATIO - TIP_INNER_RATIO);
  const halfStep = Math.sin((ANGLE_STEP * Math.PI) / 360);
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
function rayEvidence(gray, edges, width, height, cx, cy, angleDeg, innerR, outerR) {
  const samples = new Float32Array(SAMPLE_COUNT);
  const probeAt = new Float32Array(SAMPLE_COUNT);
  const span = outerR - innerR;
  if (span < 1) return { samples, probeAt };
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { offsets, comfortable } = lateralProbes(span);
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
  for (let i = 0; i < n; i += 1) {
    const value = samples[i];
    if (i < bodyCount) bodySum += value;
    else outerSum += value;
    if (i < innerSlots && value >= innerLevel) innerHits += 1;
    if (value >= hitLevel) {
      if (startIndex < 0) startIndex = i;
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
    probePx: 0,
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
  };
}

function startRadiusOf(startIndex, innerR, outerR) {
  if (startIndex < 0 || !(innerR > 0)) return null;
  const gaugeRadius = innerR / TIP_INNER_RATIO;
  const radius = innerR + (outerR - innerR) * ((startIndex + 0.5) / SAMPLE_COUNT);
  return radius / gaugeRadius;
}

export function detectNeedleAngle(image, cx, cy, innerR, outerR) {
  if (!(outerR > innerR + 1)) return emptyDetection();
  const contrastRadius = Math.max(3, Math.round((outerR - innerR) / 3));
  const { gray, edges, width, height } = prepareEdges(image, { contrastRadius });
  const rayCount = 360 / ANGLE_STEP;
  const evidence = new Array(rayCount);
  for (let i = 0; i < rayCount; i += 1) {
    evidence[i] = rayEvidence(gray, edges, width, height, cx, cy, i * ANGLE_STEP, innerR, outerR);
  }

  const medianProfile = new Float32Array(SAMPLE_COUNT);
  const column = new Float32Array(rayCount);
  for (let s = 0; s < SAMPLE_COUNT; s += 1) {
    for (let i = 0; i < rayCount; i += 1) column[i] = evidence[i].samples[s];
    medianProfile[s] = median(column);
  }

  const scratch = new Float32Array(SAMPLE_COUNT);
  const scoreAngle = (angleDeg, stored) => {
    const ray = stored || rayEvidence(gray, edges, width, height, cx, cy, angleDeg, innerR, outerR);
    for (let s = 0; s < SAMPLE_COUNT; s += 1) scratch[s] = Math.max(0, ray.samples[s] - medianProfile[s]);
    const profile = scoreProfile(scratch);
    profile.probePx = probeDistance(ray.probeAt, scratch);
    return profile;
  };

  const raw = new Float32Array(360);
  let best = 0;
  let bestProfile = emptyProfile();
  bestProfile.score = -1;
  for (let deg = 0; deg < 360; deg += ANGLE_STEP) {
    const scored = scoreAngle(deg, evidence[deg / ANGLE_STEP]);
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
  for (const peak of coarsePeaks(raw, raw[best])) {
    let peakScore = raw[peak];
    let peakAngle = peak;
    for (let step = -1; step <= 1; step += 2) {
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

  const bestScore = bestProfile.score < 0 ? 0 : bestProfile.score;
  const bestLikeness = bestProfile.likeness;

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

  const opposite = (best + 180) % 360;
  const oppositeScore = scoreAngle(opposite, opposite % ANGLE_STEP === 0 ? evidence[opposite / ANGLE_STEP] : null).score;
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
