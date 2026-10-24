/**
 * R6 tap-anchor regularisation against the Flair 58 profile span.
 */
import { clockwiseDeg, pointAngle, pointOf, barFromRestSpan } from './tapCalibrate.js';
import { wrap360, wrapDelta } from './gaugeConfig.js';

/** Clockwise travel 5 → 10 on the profile (deg from rest-needle zero). */
export const PROFILE_FIVE_DEG = 74.0613;
export const PROFILE_TEN_DEG = 161.757;
export const PROFILE_FIVE_TO_TEN_DEG = PROFILE_TEN_DEG - PROFILE_FIVE_DEG;
export const PROFILE_REST_TO_TEN_DEG = PROFILE_TEN_DEG;

function clampAngleOnSpan(angleDeg, zeroDeg, spanDeg) {
  const delta = clockwiseDeg(zeroDeg, angleDeg);
  if (delta <= spanDeg) return wrap360(angleDeg);
  const edge = Math.min(12, spanDeg * 0.08);
  if (delta <= spanDeg + edge) return wrap360(zeroDeg + spanDeg);
  return wrap360(zeroDeg + spanDeg * 0.5);
}

/**
 * Regularise snapped 5/10 anchors toward the profile.
 * @returns {{ zeroAngleDeg, fiveAngleDeg, tenAngleDeg, spanDeg, fiveToTenDeg, rejected: boolean, blended: boolean, reason: string|null }}
 */
export function regularizeTapAnchors(
  {
    zeroAngleDeg,
    fiveAngleDeg,
    tenAngleDeg,
  },
  hub,
  fiveTap,
  tenTap,
  {
    spanToleranceDeg = 4,
    fiveToTenToleranceDeg = 4,
    blendWeight = 0.7,
    spanOutOfToleranceMode = 'fallback',
  } = {},
) {
  const h = pointOf(hub);
  const fTap = pointOf(fiveTap);
  const tTap = pointOf(tenTap);
  const spanSnapped = clockwiseDeg(zeroAngleDeg, tenAngleDeg);
  const fiveToTenSnapped = clockwiseDeg(fiveAngleDeg, tenAngleDeg);
  const spanErr = Math.abs(wrapDelta(spanSnapped, PROFILE_REST_TO_TEN_DEG));
  const ftErr = Math.abs(wrapDelta(fiveToTenSnapped, PROFILE_FIVE_TO_TEN_DEG));
  const outOfTolerance = spanErr > spanToleranceDeg || ftErr > fiveToTenToleranceDeg;

  let ten = tenAngleDeg;
  let five = fiveAngleDeg;
  let zero = zeroAngleDeg;
  let rejected = false;
  let blended = false;
  let reason = null;

  if (outOfTolerance && h && fTap && tTap) {
    rejected = spanOutOfToleranceMode === 'fallback';
    blended = spanOutOfToleranceMode === 'blend-clamp';
    reason = spanErr > spanToleranceDeg ? 'span' : 'five-to-ten';
    const tapTen = pointAngle(h, tTap);
    const tapFive = pointAngle(h, fTap);
    const tapSpan = clockwiseDeg(zero, tapTen);
    if (spanOutOfToleranceMode === 'blend-clamp') {
      const profileTen = wrap360(zero + PROFILE_REST_TO_TEN_DEG);
      const profileFive = wrap360(zero + PROFILE_FIVE_DEG);
      const w = blendWeight;
      ten = wrap360(ten * w + profileTen * (1 - w));
      five = wrap360(five * w + profileFive * (1 - w));
      ten = clampAngleOnSpan(ten, zero, PROFILE_REST_TO_TEN_DEG);
      five = clampAngleOnSpan(five, zero, PROFILE_FIVE_DEG);
    } else if (Math.abs(wrapDelta(tapSpan, PROFILE_REST_TO_TEN_DEG)) <= spanToleranceDeg + 2) {
      ten = clampAngleOnSpan(tapTen, zero, PROFILE_REST_TO_TEN_DEG);
      five = clampAngleOnSpan(tapFive, zero, PROFILE_FIVE_DEG);
    } else {
      ten = wrap360(zero + PROFILE_REST_TO_TEN_DEG);
      five = wrap360(zero + PROFILE_FIVE_DEG);
    }
  } else if (!outOfTolerance && blendWeight < 1) {
    blended = true;
    const profileTen = wrap360(zero + PROFILE_REST_TO_TEN_DEG);
    const profileFive = wrap360(zero + PROFILE_FIVE_DEG);
    ten = wrap360(ten * blendWeight + profileTen * (1 - blendWeight));
    five = wrap360(five * blendWeight + profileFive * (1 - blendWeight));
  }

  const spanDeg = clockwiseDeg(zero, ten);
  return {
    zeroAngleDeg: zero,
    fiveAngleDeg: five,
    tenAngleDeg: ten,
    spanDeg,
    fiveToTenDeg: clockwiseDeg(five, ten),
    rejected,
    blended,
    reason,
    spanErr,
    ftErr,
  };
}

/** Bar from image-space needle using regularised rest→10 anchors. */
export function barFromRegularizedAnchors(needleDeg, zeroDeg, tenDeg) {
  return barFromRestSpan(needleDeg, zeroDeg, tenDeg);
}
