import { grayscale } from './framePrep.js';

/** Laplacian variance on a dial crop — low ⇒ motion blur / defocus. */
export function laplacianVariance(gray, width, height, cx, cy, radius) {
  const r = Math.max(8, radius * 0.55);
  const x0 = Math.max(1, Math.floor(cx - r));
  const y0 = Math.max(1, Math.floor(cy - r));
  const x1 = Math.min(width - 2, Math.ceil(cx + r));
  const y1 = Math.min(height - 2, Math.ceil(cy + r));
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
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

/** Fraction of near-saturated samples on the dial annulus. */
export function glareFraction(data, width, height, cx, cy, radius) {
  const inner = radius * 0.35;
  const outer = radius * 0.95;
  let hot = 0;
  let n = 0;
  for (let a = 0; a < 48; a += 1) {
    const ang = (a / 48) * Math.PI * 2;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    for (let r = inner; r <= outer; r += 2) {
      const x = Math.round(cx + r * cos);
      const y = Math.round(cy + r * sin);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const o = (y * width + x) * 4;
      const lum = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
      n += 1;
      if (lum >= 248) hot += 1;
    }
  }
  return n ? hot / n : 0;
}

/** A focused face on the full-resolution crop clears this. A defocused face does not. */
export const BLUR_VARIANCE_MIN = 60;
export const GLARE_FRACTION_MAX = 0.22;

export function assessFrameQuality(imageData, width, height, cx, cy, radius) {
  const gray = grayscale(imageData, width, height);
  const blurVar = laplacianVariance(gray, width, height, cx, cy, radius);
  const glare = glareFraction(imageData, width, height, cx, cy, radius);
  const blurOk = blurVar >= BLUR_VARIANCE_MIN;
  const glareOk = glare <= GLARE_FRACTION_MAX;
  const ok = blurOk && glareOk;
  const flags = [];
  if (!blurOk) flags.push('blur');
  if (!glareOk) flags.push('glare');
  return { ok, blurVar, glare, flags };
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
