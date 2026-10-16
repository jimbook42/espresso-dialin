import { CANONICAL_ZERO_BAR_ANGLE_DEG } from './canonicalDial.js';
import { FLAIR_58_SCALE, wrap360 } from './gaugeConfig.js';

/**
 * Unit-circle printed Flair face.
 * Angles match the camera: 0° is to the right, clockwise, because y grows downward.
 * 0 bar is the canonical zero. The solid red espresso sector covers 5→10 bar.
 * The dark stop sector is the band past 10 bar, out to the end of the scale.
 * Nothing here is a frame position or a pixel size.
 */

const SPAN = FLAIR_58_SCALE.maxBar - FLAIR_58_SCALE.minBar;

export function barToDialAngle(bar) {
  const delta = ((bar - FLAIR_58_SCALE.minBar) / SPAN) * FLAIR_58_SCALE.sweepDeg;
  return wrap360(CANONICAL_ZERO_BAR_ANGLE_DEG + delta);
}

export const ESPRESSO_SECTOR = {
  startDeg: barToDialAngle(5),
  endDeg: barToDialAngle(10),
};

export const STOP_SECTOR = {
  startDeg: barToDialAngle(10),
  endDeg: barToDialAngle(FLAIR_58_SCALE.maxBar),
};

/** Annulus that holds the printed bands, as fractions of the detected radius. */
export const BAND_INNER_FRACTION = 0.55;
export const BAND_OUTER_FRACTION = 0.9;
