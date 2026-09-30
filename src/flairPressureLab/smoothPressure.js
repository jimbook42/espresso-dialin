import { FLIP_REJECT_DEG, REST_MAX_SPREAD_DEG, REST_MIN_QUALITY, REST_STABLE_SAMPLES, wrap360, wrapDelta } from './gaugeConfig.js';

export function circularMedian(angles) {
  if (!angles?.length) return null;
  const base = angles[0];
  const deltas = angles.map((angle) => wrapDelta(base, angle)).sort((a, b) => a - b);
  const mid = deltas[Math.floor((deltas.length - 1) / 2)];
  return wrap360(base + mid);
}

/**
 * Holds the last accepted angle.
 * A modest step is smoothed immediately. A large step is held until several
 * consecutive frames support the same new angle, or keep moving the same way.
 * There is no maximum travel: a real pull that stays on the new angle is accepted.
 * A weak margin needs two extra frames. A gap clears the pending candidate.
 */
export function createAngleTracker({ maxJumpDeg = 24, confirmCount = 3, alpha = 0.45 } = {}) {
  let angle = null;
  let pending = null;
  let pendingHits = 0;

  return {
    reset() {
      angle = null;
      pending = null;
      pendingHits = 0;
    },
    push(raw, meta) {
      if (raw == null || Number.isNaN(raw)) {
        pending = null;
        pendingHits = 0;
        return { angle, accepted: false };
      }
      const quality = meta && typeof meta === 'object' ? meta.quality : null;
      if (angle == null) {
        angle = raw;
        return { angle, accepted: true };
      }
      if (Math.abs(wrapDelta(angle, raw)) >= FLIP_REJECT_DEG) {
        pending = null;
        pendingHits = 0;
        return { angle, accepted: false, rejectedFlip: true };
      }
      if (Math.abs(wrapDelta(angle, raw)) > maxJumpDeg) {
        const needed = quality != null && quality < 0.18 ? confirmCount + 2 : confirmCount;
        let agree = false;
        if (pending != null && Math.abs(wrapDelta(pending, raw)) <= 12) agree = true;
        else if (pending != null) {
          const step = wrapDelta(pending, raw);
          const pendingStep = wrapDelta(angle, pending);
          const nextStep = wrapDelta(angle, raw);
          const sameWay = pendingStep * step > 0 && pendingStep * nextStep > 0;
          if (sameWay && Math.abs(step) <= 70) agree = true;
        }
        if (agree) pendingHits += 1;
        else pendingHits = 1;
        pending = raw;
        if (pendingHits >= needed) {
          angle = raw;
          pending = null;
          pendingHits = 0;
          return { angle, accepted: true };
        }
        return { angle, accepted: false };
      }
      pending = null;
      pendingHits = 0;
      angle = wrap360(angle + alpha * wrapDelta(angle, raw));
      return { angle, accepted: true };
    },
  };
}

export function createPressureSmoother(alpha = 0.4) {
  let value = null;
  return {
    reset() {
      value = null;
    },
    push(raw) {
      if (raw == null || Number.isNaN(raw)) return value;
      value = value == null ? raw : value + alpha * (raw - value);
      return value;
    },
    get() {
      return value;
    },
  };
}

export function createAngleJitterTracker(windowSize = 6) {
  const samples = [];
  return {
    reset() {
      samples.length = 0;
    },
    push(angleDeg) {
      if (angleDeg == null) return 0;
      samples.push(angleDeg);
      while (samples.length > windowSize) samples.shift();
      if (samples.length < 2) return 0;
      const base = samples[0];
      const deltas = samples.map((angle) => wrapDelta(base, angle));
      const mean = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
      const variance = deltas.reduce((sum, delta) => sum + (delta - mean) ** 2, 0) / (deltas.length - 1);
      return Math.sqrt(variance);
    },
  };
}

/** Collect a steady rest angle. A jump or a weak frame clears the window. */
export function createRestCalibration({
  minSamples = REST_STABLE_SAMPLES,
  maxSpreadDeg = REST_MAX_SPREAD_DEG,
  minQuality = REST_MIN_QUALITY,
} = {}) {
  let samples = [];
  return {
    reset() {
      samples = [];
    },
    count() {
      return samples.length;
    },
    push({ angleDeg, quality }) {
      if (quality == null || quality < minQuality || angleDeg == null || Number.isNaN(angleDeg)) {
        samples = [];
        return { ready: false, reset: true, count: 0 };
      }
      if (samples.length) {
        const mid = circularMedian(samples);
        if (Math.abs(wrapDelta(mid, angleDeg)) > maxSpreadDeg) {
          samples = [angleDeg];
          return { ready: false, reset: true, count: 1 };
        }
      }
      samples.push(angleDeg);
      if (samples.length < minSamples) return { ready: false, reset: false, count: samples.length };
      const zeroAngleDeg = circularMedian(samples);
      const spread = Math.max(...samples.map((angle) => Math.abs(wrapDelta(zeroAngleDeg, angle))));
      samples = [];
      if (spread > maxSpreadDeg) return { ready: false, reset: true, count: 0, zeroAngleDeg: null };
      return { ready: true, reset: false, count: minSamples, zeroAngleDeg };
    },
  };
}

/** In-memory rising edge for a future shot-timer start. Nothing is stored. */
export function createRisingThreshold(threshold) {
  let above = false;
  let crossedAt = null;
  let crossCount = 0;
  return {
    reset() {
      above = false;
      crossedAt = null;
      crossCount = 0;
    },
    push(bar, now = Date.now()) {
      if (bar == null || Number.isNaN(bar)) return { above, crossedAt, crossCount, paused: true };
      const next = bar >= threshold;
      if (next && !above) {
        crossedAt = now;
        crossCount += 1;
      }
      above = next;
      return { above, crossedAt, crossCount, paused: false };
    },
    get() {
      return { above, crossedAt, crossCount };
    },
  };
}
