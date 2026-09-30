import { wrap360, wrapDelta } from './gaugeConfig.js';

export function circularMedian(angles) {
  if (!angles?.length) return null;
  const base = angles[0];
  const deltas = angles.map((angle) => wrapDelta(base, angle)).sort((a, b) => a - b);
  const mid = deltas[Math.floor((deltas.length - 1) / 2)];
  return wrap360(base + mid);
}

/** Holds the last stable angle and ignores single-frame jumps. */
export function createAngleTracker({ maxJumpDeg = 24, confirmCount = 2, alpha = 0.45 } = {}) {
  let angle = null;
  let pending = null;
  let pendingHits = 0;

  return {
    reset() {
      angle = null;
      pending = null;
      pendingHits = 0;
    },
    push(raw) {
      if (raw == null || Number.isNaN(raw)) return { angle, accepted: false };
      if (angle == null) {
        angle = raw;
        return { angle, accepted: true };
      }
      if (Math.abs(wrapDelta(angle, raw)) > maxJumpDeg) {
        if (pending != null && Math.abs(wrapDelta(pending, raw)) <= 10) pendingHits += 1;
        else {
          pending = raw;
          pendingHits = 1;
        }
        if (pendingHits >= confirmCount) {
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
