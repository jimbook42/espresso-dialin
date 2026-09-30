import { OUTER_RADIUS_RATIO, TIP_INNER_RATIO } from './gaugeConfig.js';

/**
 * Flair needle estimate when the dial center is already known from the alignment ring.
 * A full Hough line search is unnecessary: the needle is a ray from that hub.
 * This scores those rays on a blurred grayscale edge image.
 * No OpenCV objects are allocated.
 */

function grayscale(data, width, height) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i += 1) {
    const offset = i * 4;
    gray[i] = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  }
  return gray;
}

function boxBlur(src, width, height) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -1; k <= 1; k += 1) {
        const xx = x + k;
        if (xx < 0 || xx >= width) continue;
        sum += src[y * width + xx];
        count += 1;
      }
      tmp[y * width + x] = sum / count;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -1; k <= 1; k += 1) {
        const yy = y + k;
        if (yy < 0 || yy >= height) continue;
        sum += tmp[yy * width + x];
        count += 1;
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

function sobel(gray, width, height) {
  const mag = new Float32Array(gray.length);
  const gx = new Float32Array(gray.length);
  const gy = new Float32Array(gray.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const tl = gray[i - width - 1];
      const tc = gray[i - width];
      const tr = gray[i - width + 1];
      const ml = gray[i - 1];
      const mr = gray[i + 1];
      const bl = gray[i + width - 1];
      const bc = gray[i + width];
      const br = gray[i + width + 1];
      const gxValue = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gyValue = -tl - 2 * tc - tr + bl + 2 * bc + br;
      gx[i] = gxValue;
      gy[i] = gyValue;
      mag[i] = Math.hypot(gxValue, gyValue);
    }
  }
  return { mag, gx, gy };
}

function scoreRay(gray, edges, width, height, cx, cy, angleDeg, innerR, outerR) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let edge = 0;
  let dark = 0;
  let count = 0;
  const step = Math.max(1, Math.round((outerR - innerR) / 80));
  for (let r = innerR; r <= outerR; r += step) {
    const x = Math.round(cx + r * cos);
    const y = Math.round(cy + r * sin);
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
    const index = y * width + x;
    const magnitude = edges.mag[index];
    const glen = Math.hypot(edges.gx[index], edges.gy[index]) || 1;
    const perpendicular = Math.abs(edges.gx[index] * sin - edges.gy[index] * cos) / glen;
    edge += magnitude * perpendicular;
    dark += 255 - gray[index];
    count += 1;
  }
  if (!count) return 0;
  return (edge / count) * 0.75 + (dark / count) * 0.25;
}

export function detectNeedleAngle(image, cx, cy, innerR, outerR) {
  const { data, width, height } = image;
  const gray = boxBlur(grayscale(data, width, height), width, height);
  const edges = sobel(gray, width, height);
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
    if (deg !== best && scores[wrapped]) continue;
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

  const quality = bestScore <= 1 ? 0 : Math.max(0, Math.min(1, (bestScore - second) / bestScore));
  return { angleDeg: best, quality, peak: bestScore, second, oppositeScore };
}

/** Crop the unmirrored video around the manual gauge circle and estimate the needle. */
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
