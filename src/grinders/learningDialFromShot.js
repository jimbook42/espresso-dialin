import { parseNicheZeroSetting } from './nicheZero.js';
import { resolveReferenceLearningDialIO } from './referenceLearningDial.js';

/** Dial value used for reference-learning eligibility and spread (preset decimals, Niche, etc.). */
export function readShotLearningDial(shot, grinderModel, settings = null) {
  const refIO = resolveReferenceLearningDialIO(grinderModel, settings);
  if (refIO) {
    const dial = refIO.readDialFromShot(shot);
    return dial !== null && Number.isFinite(dial) ? dial : null;
  }
  return parseNicheZeroSetting(shot?.nicheZeroSetting, settings);
}

/** Spread across logged comparable shots only (not defaults or the in-progress pull). */
export function dialSpreadFromLoggedShots(comparableShots, grinderModel, settings = null) {
  const dials = comparableShots
    .map((s) => readShotLearningDial(s, grinderModel, settings))
    .filter((d) => d !== null && Number.isFinite(d));
  if (dials.length < 2) return 0;
  const spread = Math.max(...dials) - Math.min(...dials);
  return Math.round(spread * 10) / 10;
}
