/**
 * Flair 58 session model.
 * The resting needle angle is measured during calibration.
 * The printed scale is 0–12 bar (Flair gauge). The arc length is an assumption
 * until a physical dial confirms it — it is not treated as a measured angle.
 * Angles: 0° = right, clockwise positive in the unmirrored camera frame (y down).
 */
export const FLAIR_58_SCALE = {
  minBar: 0,
  maxBar: 12,
  sweepDeg: 270,
  clockwise: true,
};

export const PROCESS_INTERVAL_MS = 125;
export const EXTRACTION_START_BAR = 2;

export const DEFAULT_RADIUS_FRACTION = 0.34;
export const INNER_RADIUS_RATIO = 0.22;
export const OUTER_RADIUS_RATIO = 0.9;

export function wrap360(deg) {
  return ((deg % 360) + 360) % 360;
}

/** Signed shortest step from `fromDeg` to `toDeg`, range (-180, 180]. */
export function wrapDelta(fromDeg, toDeg) {
  return wrap360(toDeg - fromDeg + 180) - 180;
}

export function clockwiseDelta(angleDeg, zeroDeg) {
  return wrap360(angleDeg - zeroDeg);
}

/**
 * Map a needle angle to bar using the session captured at rest.
 * `session.zeroAngleDeg` is measured. Sweep and max bar describe the Flair scale.
 */
export function angleToBar(angleDeg, session) {
  if (angleDeg == null || !session?.sweepDeg) return null;
  let delta = clockwiseDelta(angleDeg, session.zeroAngleDeg);
  if (session.clockwise === false) delta = (360 - delta) % 360;
  if (delta >= 360 - 12) delta = 0;
  if (delta > session.sweepDeg) delta = session.sweepDeg;
  const span = session.maxBar - session.minBar;
  return session.minBar + (delta / session.sweepDeg) * span;
}

export function classifyTrackingStatus({ calibrated, quality, jitterDeg, accepted }) {
  if (!calibrated) return 'CALIBRATING';
  if (quality == null || quality < 0.08) return 'LOST';
  if (!accepted || quality < 0.18 || jitterDeg > 12) return 'UNCERTAIN';
  return 'TRACKING';
}
