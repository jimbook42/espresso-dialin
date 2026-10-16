import { grayscale } from './framePrep.js';
import { EXTRACTION_START_BAR } from './gaugeConfig.js';

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
let glareLumas = new Float64Array(4096);
let glareWork = new Float64Array(4096);

function glareSelectNth(arr, k, len) {
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
    if (store === k) return;
    if (store < k) left = store + 1;
    else right = store - 1;
  }
}

export function glareFraction(data, width, height, cx, cy, radius) {
  const { limit, x0, y0, x1, y1 } = faceBounds(width, height, cx, cy, radius);
  const cap = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (cap > glareLumas.length) {
    let next = glareLumas.length;
    while (next < cap) next *= 2;
    glareLumas = new Float64Array(next);
    glareWork = new Float64Array(next);
  }
  const limit2 = limit * limit;
  let n = 0;
  for (let y = y0; y <= y1; y += 1) {
    const dy = y - cy;
    const row = y * width;
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      if (dx * dx + dy * dy > limit2) continue;
      const o = (row + x) * 4;
      glareLumas[n] = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
      n += 1;
    }
  }
  if (n < 4) return 0;
  // Same core as a full sort: the dimmer 90%, its median, then that core's spread.
  glareWork.set(glareLumas.subarray(0, n));
  const coreCount = Math.max(4, Math.floor(n * 0.9));
  glareSelectNth(glareWork, coreCount - 1, n);
  const medAt = Math.floor(coreCount / 2);
  glareSelectNth(glareWork, medAt, coreCount);
  const median = glareWork[medAt];
  let acc = 0;
  for (let i = 0; i < coreCount; i += 1) {
    const d = glareWork[i] - median;
    acc += d * d;
  }
  const std = Math.sqrt(acc / coreCount);
  let hot = 0;
  for (let i = 0; i < n; i += 1) {
    const lum = glareLumas[i];
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

export function assessFrameQuality(imageData, width, height, cx, cy, radius, grayIn = null) {
  const gray = grayIn || grayscale(imageData, width, height);
  const blurVar = laplacianVariance(gray, width, height, cx, cy, radius);
  const contrast = faceContrast(gray, width, height, cx, cy, radius);
  const sharpness = contrast < 1 ? 0 : blurVar / (contrast * contrast);
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

/** Shown before a shot when the dial face is glaring. Hidden for the whole shot. */
export const GLARE_SETUP_HINT = 'Glare on gauge — shift your phone a bit';

/** Shown before a shot when the detected dial is below the needle's pixel need. */
export const MOVE_CLOSER_HINT = 'Move closer — gauge too small';

/**
 * True when a detected radius cannot feed the needle sampler a pixel per sample.
 * One pixel of slack: the sampler rounds each radial step, so a dial a
 * fraction of a pixel under the count is already on a real source pixel.
 */
export function gaugeTooSmallForNeedle(radiusPx, minRadiusPx) {
  return typeof radiusPx === 'number'
    && radiusPx > 0
    && typeof minRadiusPx === 'number'
    && radiusPx < minRadiusPx - 1;
}

/**
 * Pre-shot setup hint for a dial that is too small to read.
 * A running shot hides it, same latch as the glare hint.
 */
export function moveCloserHintVisible({ tooSmall = false, shotRunning = false } = {}) {
  return tooSmall === true && shotRunning !== true;
}

/** Last good bar may be repeated for at most this long. Then the bar is a gap. */
export const READING_HOLD_MAX_MS = 1000;

/**
 * Repeats the last fresh bar for at most `maxHoldMs`, then publishes null.
 * A fresh measurement resets the clock. A held bar is never a new reading.
 */
export function createReadingHold(maxHoldMs = READING_HOLD_MAX_MS) {
  let lastBar = null;
  let lastAt = 0;
  return {
    reset() {
      lastBar = null;
      lastAt = 0;
    },
    push({ bar = null, fresh = false, now = 0 } = {}) {
      const measured = fresh === true && bar != null && !Number.isNaN(bar);
      if (measured) {
        lastBar = bar;
        lastAt = now;
        return { bar, held: false, gap: false, expired: false, holdMs: 0 };
      }
      if (lastBar == null || now == null) {
        return { bar: null, held: false, gap: true, expired: false, holdMs: 0 };
      }
      const elapsed = now - lastAt;
      if (elapsed > maxHoldMs) {
        return { bar: null, held: false, gap: true, expired: true, holdMs: 0 };
      }
      return { bar: lastBar, held: true, gap: false, expired: false, holdMs: elapsed };
    },
  };
}

/**
 * Pre-shot setup hint.
 * A running shot hides it even when the face is still glaring.
 * `shotRunning` stays latched across gaps; only a resting bar clears it.
 */
export function glareSetupHintVisible({ glare = false, shotRunning = false } = {}) {
  return glare === true && shotRunning !== true;
}

/**
 * A shot starts when pressure crosses the extraction threshold and ends
 * when it returns to rest. A missing bar does not start or end one.
 */
export function createShotRun({
  startBar = EXTRACTION_START_BAR,
  restBar = 0.5,
} = {}) {
  let running = false;
  return {
    reset() {
      running = false;
    },
    running() {
      return running;
    },
    push(bar) {
      if (bar == null || Number.isNaN(bar)) return running;
      if (bar >= startBar) running = true;
      else if (bar <= restBar) running = false;
      return running;
    },
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
