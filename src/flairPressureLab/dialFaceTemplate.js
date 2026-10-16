import { CANONICAL_ZERO_BAR_ANGLE_DEG } from './canonicalDial.js';
import { FLAIR_58_SCALE, wrap360 } from './gaugeConfig.js';

/**
 * Unit-circle printed Flair face, measured from the design photo
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
  startDeg: 137,
  endDeg: 197,
};

/** Dark STOP! BREAKAGE! band past 10 bar. It is not more numbered scale. */
export const STOP_SECTOR = {
  startDeg: 258,
  endDeg: 355,
};

/** Solid red block, as a fraction of the detected face radius. */
export const RED_BAND_INNER_FRACTION = 0.44;
export const RED_BAND_OUTER_FRACTION = 0.62;
/** Dark stop band, further out than the red block. */
export const DARK_BAND_INNER_FRACTION = 0.74;
export const DARK_BAND_OUTER_FRACTION = 0.9;

/** Red annulus. Older name kept for the synthetic face. */
export const BAND_INNER_FRACTION = RED_BAND_INNER_FRACTION;
export const BAND_OUTER_FRACTION = RED_BAND_OUTER_FRACTION;
