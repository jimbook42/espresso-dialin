import { grindMatchesStoredRecommendation } from '../grinders/grinderRegistry.js';
import { getAgeAdjustedRecommendation } from './grinderLogic.js';

/**
 * Whether the user followed the prior shot's grind recommendation when logging a new shot.
 * @returns {true|false|null} null when there was no recommendation to follow (e.g. first shot on a bean).
 */
export function resolveRecommendationFollowedForSave({
  lastLearningShot,
  activeBean,
  mockDate,
  savedGrind,
  settings = null,
}) {
  if (!lastLearningShot?.recommendation?.recommendedSetting) {
    return null;
  }
  const adjustedRec = getAgeAdjustedRecommendation(lastLearningShot, activeBean, mockDate, settings);
  const rec = adjustedRec?.recommendedSetting || lastLearningShot.recommendation.recommendedSetting;
  const matches = grindMatchesStoredRecommendation(
    lastLearningShot.grinderModel,
    savedGrind,
    rec,
    settings
  );
  return matches ? true : false;
}

/** CSV export label; does not rewrite stored shot records. */
export function formatRecFollowedForCsv(shot) {
  if (shot?.recommendationFollowed === true) return 'Yes';
  if (shot?.recommendationFollowed === false) return 'No';
  return 'N/A';
}
