import { OUTER_RADIUS_RATIO, TIP_INNER_RATIO } from './gaugeConfig.js';
import { prepareEdges } from './framePrep.js';

/**
 * Needle angle around a known hub.
 * Scores rays on a local-contrast image, so a darker needle is "darker than
 * its sides" rather than "below an absolute gray level". Global exposure can
 * change without moving the winning angle. A full Hough search is unnecessary.
 */

function sample(gray, width, height, x, y) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= width || yi >= height) return null;
  return gray[yi * width + xi];
}

function scoreRay(gray, edges, width, height, cx, cy, angleDeg, innerR, outerR) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const offset = Math.max(2, Math.round((outerR - innerR) / 18));
  let score = 0;
  let count = 0;
  const step = Math.max(1, Math.round((outerR - innerR) / 48));
  for (let r = innerR; r <= outerR; r += step) {
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
    const darkerThanSides = (left + right) * 0.5 - center;
    const across = Math.abs(edges.gx[index] * sin - edges.gy[index] * cos);
    const weight = darkerThanSides > 0 ? 1 : 0.2;
    score += across * weight;
    count += 1;
  }
  if (!count) return 0;
  return score / count;
}

export function detectNeedleAngle(image, cx, cy, innerR, outerR) {
  const contrastRadius = Math.max(3, Math.round((outerR - innerR) / 3));
  const { gray, edges, width, height } = prepareEdges(image, { contrastRadius });
  const scores = new Float32Array(360);
  let best = 0;
  let bestScore = 0;

  for (let deg = 0; deg < 360; deg += 2) {
    const score = scoreRay(gray, edges, width, height, cx, cy, deg, innerR, outerR);
    scores[deg] = score;
    if (score > bestScore) {
      bestScore = score;
      best = deg;
    }
  }

  for (let deg = best - 2; deg <= best + 2; deg += 1) {
    const wrapped = (deg + 360) % 360;
    if (wrapped === best) continue;
    const score = scoreRay(gray, edges, width, height, cx, cy, wrapped, innerR, outerR);
    scores[wrapped] = score;
    if (score > bestScore) {
      bestScore = score;
      best = wrapped;
    }
  }

  const opposite = (best + 180) % 360;
  const oppositeScore = scores[opposite]
    || scoreRay(gray, edges, width, height, cx, cy, opposite, innerR, outerR);

  let second = 0;
  for (let deg = 0; deg < 360; deg += 2) {
    let distance = Math.abs(deg - best);
    if (distance > 180) distance = 360 - distance;
    if (distance <= 12) continue;
    if (scores[deg] > second) second = scores[deg];
  }

  const quality = bestScore <= 1e-4 ? 0 : Math.max(0, Math.min(1, (bestScore - second) / bestScore));
  return { angleDeg: best, quality, peak: bestScore, second, oppositeScore };
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
