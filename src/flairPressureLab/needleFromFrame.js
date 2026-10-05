import { NEEDLE_LIKENESS_GATE, OUTER_RADIUS_RATIO, TIP_INNER_RATIO } from './gaugeConfig.js';
import { prepareEdges } from './framePrep.js';

/**
 * Needle angle around a known hub.
 * Each angle is a radial segment, not a single strong edge. A tick, numeral,
 * or bezel arc can be darker than the needle at one radius and still lose,
 * because it does not run continuously from near the pivot toward the rim.
 * Angles are still scanned every 2°, then refined to 1°. Nothing here maps
 * angle to pressure.
 */

const SAMPLE_COUNT = 32;
const ANGLE_STEP = 2;

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
 * Dark ridge along one ray.
 * The pointer sits on a white face, so both sides of the ray are brighter than
 * the centre. A sleeve edge or bezel boundary is a step: one side is darker.
 * Scoring `(left + right) / 2 - centre` counted that step as a needle. The
 * step is stable under occlusion, and three agreeing frames then snapped it
 * in as a pressure change. Both sides have to be brighter, and the darker
 * side has to carry at least half the contrast of the brighter side, so a
 * one-sided step contributes nothing.
 * Circumferential gradients contribute nothing either.
 */
function rayEvidence(gray, edges, width, height, cx, cy, angleDeg, innerR, outerR) {
  const out = new Float32Array(SAMPLE_COUNT);
  const span = outerR - innerR;
  if (span < 1) return out;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const offset = Math.min(4, Math.max(2, Math.round(span / 18)));
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const r = innerR + span * ((i + 0.5) / SAMPLE_COUNT);
    const x = cx + r * cos;
    const y = cy + r * sin;
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 1 || yi < 1 || xi >= width - 1 || yi >= height - 1) continue;
    const index = yi * width + xi;
    const center = gray[index];
    const left = sample(gray, width, height, x - sin * offset, y + cos * offset);
    const right = sample(gray, width, height, x + sin * offset, y - cos * offset);
    if (left == null || right == null) continue;
    const leftContrast = left - center;
    const rightContrast = right - center;
    if (leftContrast <= 0 || rightContrast <= 0) continue;
    const weaker = Math.min(leftContrast, rightContrast);
    const stronger = Math.max(leftContrast, rightContrast);
    // Both faces of a needle match. A sleeve step is bright on one side only;
    // high-pass ringing can make the dark side barely positive and still
    // produce a high margin once the real needle is hidden.
    if (weaker * 2 < stronger) continue;
    const contrast = weaker;
    const gx = edges.gx[index];
    const gy = edges.gy[index];
    const across = Math.abs(gx * sin - gy * cos);
    const grad = Math.hypot(gx, gy);
    const alignment = grad > 1 ? across / grad : 0;
    out[i] = contrast * (0.35 + 0.65 * alignment);
  }
  return out;
}

/**
 * Reward a continuous dark segment that reaches the inner part of the window.
 * A mark that exists only near the rim, or as scattered dots, collapses.
 */
function scoreProfile(samples) {
  const n = samples.length;
  if (!n) return { score: 0, likeness: 0 };
  let total = 0;
  for (let i = 0; i < n; i += 1) total += samples[i];
  const mean = total / n;
  if (mean <= 1e-4) return { score: 0, likeness: 0 };

  const hitLevel = mean * 0.5;
  const bodyCount = Math.max(1, Math.round(n * 0.68));
  let hits = 0;
  let run = 0;
  let gap = 0;
  let longest = 0;
  let bodySum = 0;
  let outerSum = 0;
  for (let i = 0; i < n; i += 1) {
    const value = samples[i];
    if (i < bodyCount) bodySum += value;
    else outerSum += value;
    if (value >= hitLevel) {
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
  const reach = Math.min(1, (bodyShare * 2) ** 2);
  const likeness = Math.min(1, coverage * (0.3 + 0.7 * continuity) * reach);
  return { score: mean * likeness, likeness };
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
  };
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
    for (let i = 0; i < rayCount; i += 1) column[i] = evidence[i][s];
    medianProfile[s] = median(column);
  }

  const scratch = new Float32Array(SAMPLE_COUNT);
  const scoreAngle = (angleDeg, stored) => {
    const source = stored || rayEvidence(gray, edges, width, height, cx, cy, angleDeg, innerR, outerR);
    for (let s = 0; s < SAMPLE_COUNT; s += 1) scratch[s] = Math.max(0, source[s] - medianProfile[s]);
    return scoreProfile(scratch);
  };

  const raw = new Float32Array(360);
  const likenessAt = new Float32Array(360);
  for (let deg = 0; deg < 360; deg += ANGLE_STEP) {
    const scored = scoreAngle(deg, evidence[deg / ANGLE_STEP]);
    raw[deg] = scored.score;
    likenessAt[deg] = scored.likeness;
  }

  // Rank the raw ridge. Neighbour support used to multiply the score before
  // the argmax, so a broader but weaker mark (a sleeve boundary, a wide tick)
  // could outrank the darker needle and then report a near-zero margin.
  let best = 0;
  let bestRaw = -1;
  for (let deg = 0; deg < 360; deg += ANGLE_STEP) {
    if (raw[deg] > bestRaw) {
      bestRaw = raw[deg];
      best = deg;
    }
  }

  let bestScore = raw[best];
  let bestLikeness = likenessAt[best];
  for (let deg = best - ANGLE_STEP; deg <= best + ANGLE_STEP; deg += 1) {
    const wrapped = (deg + 360) % 360;
    if (wrapped % ANGLE_STEP === 0) continue;
    const scored = scoreAngle(wrapped, null);
    if (scored.score > bestScore) {
      bestScore = scored.score;
      bestLikeness = scored.likeness;
      best = wrapped;
    }
  }

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
