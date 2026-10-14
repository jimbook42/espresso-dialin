import { getInitialGrindRecommendation, shotEligibleForLearning } from '../utils/grinderLogic.js';
import { shotMatchesGrinderForLearning } from './grinderLearningMatch.js';
import { isPresetGrinderModel, uiStateFromInitialRecommendation, uiStateFromLastShot } from './grinderRegistry.js';
import { getGrindUiForBeanGrinder } from './grindDialByBean.js';

/**
 * Grind control UI state when bean/grinder context changes.
 * Reflects the last logged shot's grind when no session pending dial exists (see pendingGrindSession.js).
 * @param {object} params
 * @param {string} params.grinderModel
 * @param {object[]} params.shots Newest-first shot list
 * @param {object} params.activeBean
 * @param {object[]} params.recipes
 * @param {object[]} params.beans
 * @param {string|null} params.mockDate
 * @param {boolean} params.flairEnabled
 */
export function resolveGrindControlUiState({
  grinderModel,
  shots,
  activeBean,
  recipes,
  beans,
  mockDate,
  flairEnabled,
  settings = null,
}) {
  if (!activeBean || !grinderModel) return null;

  const persisted = getGrindUiForBeanGrinder(settings, activeBean.id, grinderModel);
  if (persisted && Object.keys(persisted).length > 0) {
    return persisted;
  }

  const currentBeanShots = shots.filter(
    (s) =>
      s.beanId === activeBean.id
      && shotEligibleForLearning(s)
      && shotMatchesGrinderForLearning(s, grinderModel)
  );

  if (currentBeanShots.length > 0) {
    return uiStateFromLastShot(grinderModel, currentBeanShots[0], settings);
  }

  const recParams = getInitialGrindRecommendation(
    grinderModel,
    activeBean.roastType,
    activeBean,
    recipes,
    shots,
    beans,
    mockDate,
    flairEnabled,
    settings
  );
  return uiStateFromInitialRecommendation(grinderModel, recParams, settings);
}
