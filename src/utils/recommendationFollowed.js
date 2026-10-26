import { grindMatchesStoredRecommendation } from '../grinders/grinderRegistry.js';

/**
 * Whether the user followed the grind recommendation shown on the Dial-in screen when logging.
 * Uses the same displayed recommendation object as the UI (not a recomputed last-shot snapshot).
 * @returns {true|false|null} null when the screen shows no recommendation to follow.
 */
export function resolveRecommendationFollowedForSave({
  displayedRecommendation,
  grinderModel,
  savedGrind,
  settings = null,
}) {
  const recSetting = displayedRecommendation?.recommendedSetting;
  if (!recSetting || !grinderModel) {
    return null;
  }
  const matches = grindMatchesStoredRecommendation(
    grinderModel,
    savedGrind,
    recSetting,
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

/** @returns {true|false|null} */
export function parseRecFollowedFromCsv(cell) {
  const text = String(cell ?? '').trim().toLowerCase();
  if (text === 'yes') return true;
  if (text === 'no') return false;
  return null;
}
