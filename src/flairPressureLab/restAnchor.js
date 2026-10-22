import { CANONICAL_ZERO_BAR_ANGLE_DEG } from './canonicalDial.js';
import { PROCESS_INTERVAL_MS, REST_MAX_SPREAD_DEG, wrap360, wrapDelta } from './gaugeConfig.js';

/** How long the needle must sit still before it can confirm the printed zero. */
export const REST_ANCHOR_MS = 500;
const REST_ANCHOR_SPREAD_DEG = 8;
/** About half a bar on the measured scale, and coarser than one profile bin. */
const REST_ANCHOR_ZERO_DEG = 10;

/**
 * Session-start check. The printed template is the scale. This only confirms
 * that a needle which has been still for half a second lies on that template's
 * zero. It never runs on the first frame, and it never copies an angle in as zero.
 * Disagreement leaves the anchor in conflict so a confident bar is not published.
 * A later still period on the printed zero may confirm. Confirmed does not revert.
 */
/** Degrees between the registered needle and the template zero. Not a new zero. */
export function templateConflictDeg(relativeAngleDeg) {
  if (relativeAngleDeg == null || Number.isNaN(relativeAngleDeg)) return null;
  return Math.abs(wrapDelta(relativeAngleDeg, CANONICAL_ZERO_BAR_ANGLE_DEG));
}

/**
 * High confidence waits for a few readings in the same place.
 * A flicker that jumps away inside the rest window does not get there.
 */
export function confidentAngleWindow(samples, now) {
  const recent = (samples || []).filter(
    (sample) => sample?.angleDeg != null && now - sample.timeMs <= REST_ANCHOR_MS,
  );
  if (recent.length < 3) return false;
  const base = recent[0].angleDeg;
  return recent.every((sample) => Math.abs(wrapDelta(base, sample.angleDeg)) <= REST_MAX_SPREAD_DEG);
}

export function createRestAnchor() {
  let samples = [];
  let status = 'pending';
  return {
    status() {
      return status;
    },
    reset() {
      samples = [];
      status = 'pending';
    },
    push({ timeMs, angleDeg, usable }) {
      if (status === 'confirmed') return status;
      if (!usable || angleDeg == null || timeMs == null) return status;
      // One still period off the template blocks confident bars. It does not
      // retire the session: a later still period on the printed zero can confirm.
      // The template zero is never replaced by either period.
      if (status === 'conflict') {
        samples = [];
        status = 'pending';
      }
      samples.push({ timeMs, angleDeg });
      // Keep one process interval before the half-second mark. A sample that
      // opens the window would otherwise be dropped on the same tick the span
      // reaches half a second, and the anchor would stay pending forever.
      const cutoff = timeMs - REST_ANCHOR_MS - PROCESS_INTERVAL_MS;
      samples = samples.filter((sample) => sample.timeMs >= cutoff);
      if (samples.length < 3) return status;
      const span = samples[samples.length - 1].timeMs - samples[0].timeMs;
      if (span < REST_ANCHOR_MS) return status;
      const base = samples[0].angleDeg;
      const spread = samples.reduce(
        (max, sample) => Math.max(max, Math.abs(wrapDelta(base, sample.angleDeg))),
        0,
      );
      if (spread > REST_ANCHOR_SPREAD_DEG) return status;
      let sin = 0;
      let cos = 0;
      for (const sample of samples) {
        const rad = (sample.angleDeg * Math.PI) / 180;
        sin += Math.sin(rad);
        cos += Math.cos(rad);
      }
      const mean = wrap360((Math.atan2(sin, cos) * 180) / Math.PI);
      status = Math.abs(wrapDelta(mean, CANONICAL_ZERO_BAR_ANGLE_DEG)) <= REST_ANCHOR_ZERO_DEG
        ? 'confirmed'
        : 'conflict';
      return status;
    },
  };
}
