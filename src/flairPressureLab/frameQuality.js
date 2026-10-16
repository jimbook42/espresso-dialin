import { grayscale } from './framePrep.js';

/**
 * Face interior used for blur and glare.
 * The bezel edge is sharp even when the printed face is not, so the window
 * stays inside the face. The fraction is of the detected radius, so a larger
 * crop does not change the test.
 */
const FACE_FRACTION = 0.55;

function faceBounds(width, height, cx, cy, radius) {
  const limit = Math.max(6, radius * FACE_FRACTION);
  return {
    limit,
    x0: Math.max(1, Math.floor(cx - limit)),
    y0: Math.max(1, Math.floor(cy - limit)),
    x1: Math.min(width - 2, Math.ceil(cx + limit)),
    y1: Math.min(height - 2, Math.ceil(cy + limit)),
  };
}

function insideFace(x, y, cx, cy, limit) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= limit * limit;
}

/** Laplacian variance on the face interior. */
export function laplacianVariance(gray, width, height, cx, cy, radius) {
  const { limit, x0, y0, x1, y1 } = faceBounds(width, height, cx, cy, radius);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!insideFace(x, y, cx, cy, limit)) continue;
      const i = y * width + x;
      const lap = (
        -4 * gray[i]
        + gray[i - 1] + gray[i + 1]
        + gray[i - width] + gray[i + width]
      );
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }
  if (n < 4) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Standard deviation of luma on the same face interior. */
export function faceContrast(gray, width, height, cx, cy, radius) {
  const { limit, x0, y0, x1, y1 } = faceBounds(width, height, cx, cy, radius);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!insideFace(x, y, cx, cy, limit)) continue;
      const value = gray[y * width + x];
      sum += value;
      sumSq += value * value;
      n += 1;
    }
  }
  if (n < 4) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

/**
 * Laplacian variance divided by local contrast squared.
 * A gain change scales both and leaves this number alone.
 */
export function normalizedSharpness(gray, width, height, cx, cy, radius) {
  const contrast = faceContrast(gray, width, height, cx, cy, radius);
  if (contrast < 1) return 0;
  const lap = laplacianVariance(gray, width, height, cx, cy, radius);
  return lap / (contrast * contrast);
}

/**
 * Share of the face that is sensor-saturated or a specular outlier.
 * The outlier test uses the dimmer bulk of the face, so a bright spot does
 * not raise the bar it has to clear.
 */
export function glareFraction(data, width, height, cx, cy, radius) {
  const { limit, x0, y0, x1, y1 } = faceBounds(width, height, cx, cy, radius);
  const lumas = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!insideFace(x, y, cx, cy, limit)) continue;
      const o = (y * width + x) * 4;
      lumas.push(data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114);
    }
  }
  const n = lumas.length;
  if (n < 4) return 0;
  const sorted = lumas.slice().sort((a, b) => a - b);
  const coreCount = Math.max(4, Math.floor(n * 0.9));
  const core = sorted.slice(0, coreCount);
  const median = core[Math.floor(core.length / 2)];
  let acc = 0;
  for (let i = 0; i < core.length; i += 1) {
    const d = core[i] - median;
    acc += d * d;
  }
  const std = Math.sqrt(acc / core.length);
  let hot = 0;
  for (let i = 0; i < n; i += 1) {
    const lum = lumas[i];
    const saturated = lum >= 245;
    const specular = lum > median + 3 * std && lum > median * 2.2;
    if (saturated || specular) hot += 1;
  }
  return hot / n;
}

/**
 * A focused printed face clears this. A defocused face, whose edges have
 * been averaged away, stays below it. The number is contrast-normalised,
 * so it is not a raw grey-level variance.
 */
export const BLUR_SHARPNESS_MIN = 0.85;
/** A small specular patch on the face. A single pixel does not trip it. */
export const GLARE_FRACTION_MAX = 0.008;

export function assessFrameQuality(imageData, width, height, cx, cy, radius) {
  const gray = grayscale(imageData, width, height);
  const blurVar = laplacianVariance(gray, width, height, cx, cy, radius);
  const sharpness = normalizedSharpness(gray, width, height, cx, cy, radius);
  const glare = glareFraction(imageData, width, height, cx, cy, radius);
  const blurOk = sharpness >= BLUR_SHARPNESS_MIN;
  const glareOk = glare <= GLARE_FRACTION_MAX;
  const ok = blurOk && glareOk;
  const flags = [];
  if (!blurOk) flags.push('blur');
  if (!glareOk) flags.push('glare');
  return {
    ok, blurVar, sharpness, glare, flags,
  };
}

/**
 * Holds the last good reading through short quality gaps (max hold wall clock).
 */
export function createReadingBridge(maxHoldMs = 450) {
  let lastGood = null;
  let lastGoodAt = 0;
  return {
    reset() {
      lastGood = null;
      lastGoodAt = 0;
    },
    publish(candidate, qualityOk, now) {
      if (candidate != null && qualityOk) {
        lastGood = candidate;
        lastGoodAt = now;
        return { value: candidate, bridged: false, qualityOk: true };
      }
      if (lastGood != null && now - lastGoodAt <= maxHoldMs) {
        return { value: lastGood, bridged: true, qualityOk: false };
      }
      return { value: null, bridged: false, qualityOk: false };
    },
  };
}
