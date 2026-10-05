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

export const DEFAULT_RADIUS_FRACTION = 0.28;
/** Needle segment starts outside the hub so the pointer body is in the window and the short tail is mostly out. */
export const TIP_INNER_RATIO = 0.24;
/** Needle segment stops inside the bezel. Tick tips and the rim sit further out. */
export const OUTER_RADIUS_RATIO = 0.86;
export const REST_STABLE_SAMPLES = 6;
export const REST_MAX_SPREAD_DEG = 8;
export const REST_MIN_QUALITY = 0.1;
export const FLIP_REJECT_DEG = 140;
/** Below this the sample is LOST and is not a pressure update. */
export const NEEDLE_LOST_QUALITY = 0.08;
/** At or above this a reading may be TRACKING. A large step needs this score too. */
export const NEEDLE_TRACK_QUALITY = 0.18;
/**
 * Detector likeness divisor. A short outer mark falls below this.
 * A step that clears the tracking score still has to clear this gate.
 */
export const NEEDLE_LIKENESS_GATE = 0.4;
/** Agreement band for a repeated candidate, and the jitter limit for TRACKING. */
export const NEEDLE_AGREE_DEG = 12;

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

export function classifyTrackingStatus({ calibrated, quality, jitterDeg, accepted, heldFlip = false, gaugeHeld = false }) {
  if (!calibrated) return 'CALIBRATING';
  if (gaugeHeld || heldFlip) return 'UNCERTAIN';
  if (quality == null || quality < NEEDLE_LOST_QUALITY) return 'LOST';
  if (!accepted || quality < NEEDLE_TRACK_QUALITY || jitterDeg > NEEDLE_AGREE_DEG) return 'UNCERTAIN';
  return 'TRACKING';
}

/**
 * The Flair needle has a short tail opposite the pointer.
 * If the tail wins the score, prefer the opposite ray when it matches the last angle.
 * A ~180° jump is held instead of accepted.
 */
export function selectForwardAngle({ angleDeg, peak = 0, oppositeScore = 0, previousAngle = null }) {
  if (angleDeg == null) return { angleDeg: previousAngle, corrected: false, held: previousAngle != null };
  const opposite = wrap360(angleDeg + 180);
  if (previousAngle == null) return { angleDeg, corrected: false, held: false };
  const toBest = Math.abs(wrapDelta(previousAngle, angleDeg));
  const toOpposite = Math.abs(wrapDelta(previousAngle, opposite));
  if (toBest <= 55) return { angleDeg, corrected: false, held: false };
  if (toOpposite < toBest && toOpposite <= 55 && oppositeScore >= peak * 0.55) {
    return { angleDeg: opposite, corrected: true, held: false };
  }
  if (toBest >= FLIP_REJECT_DEG) return { angleDeg: previousAngle, corrected: false, held: true };
  return { angleDeg, corrected: false, held: false };
}
