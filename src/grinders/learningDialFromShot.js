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
