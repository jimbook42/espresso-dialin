import { FLAIR_58_SCALE, wrap360 } from './gaugeConfig.js';

/**
 * Stop pin at 0 bar (upright Flair 58 face).
 * Measured from docs/reference/flair58-face-phone.jpg via measure-design-dial.py.
 * 0° = right, clockwise.
 */
export const CANONICAL_ZERO_BAR_ANGLE_DEG = 145;

/**
 * Unit-circle printed Flair face, measured from reference photos
 * (scripts/pressure-replay/measure-design-dial.py). Not a frame position.
 * Angles: 0° is to the right, clockwise, because y grows downward.
 *
 * Printed numerals are 0 (the stop pin), 5, and 10. Nothing past 10 is numbered.
 * The dark STOP! BREAKAGE! band sits beyond 10. There is no printed 12 or 16.
 * The solid red Espresso block is the 5→10 sector, inset from the numerals.
 * The red Flair script sits off that block and is not part of the sector.
 */

const SPAN = FLAIR_58_SCALE.maxBar - FLAIR_58_SCALE.minBar;

export function barToDialAngle(bar) {
  const delta = ((bar - FLAIR_58_SCALE.minBar) / SPAN) * FLAIR_58_SCALE.sweepDeg;
  return wrap360(CANONICAL_ZERO_BAR_ANGLE_DEG + delta);
}

/** Solid red Espresso block. Midpoint is the registration centroid, not the logo. */
export const ESPRESSO_SECTOR = {
  startDeg: 225,
  endDeg: 310,
};

/** Dark STOP! BREAKAGE! band past 10 bar. It is not more numbered scale. */
export const STOP_SECTOR = {
  startDeg: 61,
  endDeg: 94,
};

/** Red Flair script (lower centre), not the Espresso annulus. */
export const FLAIR_LOGO_ANGLE_DEG = 128;

/**
 * Silver posts on the right of the face (registration hints; not the zero pin).
 * Angles in the dial frame; radius as a fraction of detected face radius.
 */
export const REGISTRATION_PINS = [
  { angleDeg: 321.5, radiusFraction: 0.75 },
  { angleDeg: 355.5, radiusFraction: 0.83 },
];

/** Solid red block, as a fraction of the detected face radius. */
export const RED_BAND_INNER_FRACTION = 0.44;
export const RED_BAND_OUTER_FRACTION = 0.62;
/** Dark stop band, further out than the red block. */
export const DARK_BAND_INNER_FRACTION = 0.72;
export const DARK_BAND_OUTER_FRACTION = 0.92;

/** Red annulus. Older name kept for the synthetic face. */
export const BAND_INNER_FRACTION = RED_BAND_INNER_FRACTION;
export const BAND_OUTER_FRACTION = RED_BAND_OUTER_FRACTION;
