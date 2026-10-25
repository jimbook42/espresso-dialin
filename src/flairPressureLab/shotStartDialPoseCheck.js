/**
 * At shot start, warn when the tracked dial pose disagrees with stored calibration.
 * UI-only; does not affect published pressure.
 */

export function hubDistancePx(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const dx = (a.x ?? 0) - (b.x ?? 0);
  const dy = (a.y ?? 0) - (b.y ?? 0);
  return Math.hypot(dx, dy);
}

/**
 * @param {{
 *   trackedHub?: { x: number, y: number } | null,
 *   calibratedHub?: { x: number, y: number } | null,
 *   calibratedRadius?: number | null,
 *   poseLost?: boolean,
 *   distanceFactor?: number,
 * }} input
 */
export function dialPoseMismatchWarning(input) {
  const {
    trackedHub,
    calibratedHub,
    calibratedRadius,
    poseLost = false,
    distanceFactor = 0.6,
  } = input;
  if (poseLost || !trackedHub) return true;
  if (!calibratedHub || !(calibratedRadius > 0)) return false;
  return hubDistancePx(trackedHub, calibratedHub) > distanceFactor * calibratedRadius;
}
