import { SETTE_GRINDER_ID } from './grinderRegistry.js';

export function shotMatchesGrinderForLearning(shot, activeGrinderModel) {
  if (!activeGrinderModel) return true;
  const shotGrinder = shot?.grinderModel;
  if (shotGrinder === null || shotGrinder === undefined || shotGrinder === '') {
    return activeGrinderModel === SETTE_GRINDER_ID;
  }
  return shotGrinder === activeGrinderModel;
}

export function shotHasSavedRecipeTargetContext(shot) {
  return (
    shot?.targetDoseG != null &&
    shot?.targetYieldG != null &&
    shot?.targetTimeMinS != null &&
    shot?.targetTimeMaxS != null
  );
}

/**
 * @returns {null | string} reason code when shot does not match current recipe context
 */
export function shotRecipeMismatchReason(shot, recipe, flairEnabled = false) {
  if (!shot) return 'missing_shot';
  const targetDose = recipe?.targetDoseG ?? 18;
  const targetYield = recipe?.targetYieldG ?? 36;
  const recipeMin = recipe?.targetTimeMinS ?? 27;
  const recipeMax = recipe?.targetTimeMaxS ?? 32;

  if (shotHasSavedRecipeTargetContext(shot)) {
    if (Math.abs(shot.targetDoseG - targetDose) > 0.01) return 'recipe_dose_target';
    if (Math.abs(shot.targetYieldG - targetYield) > 0.01) return 'recipe_yield_target';
    if (shot.targetTimeMinS !== recipeMin || shot.targetTimeMaxS !== recipeMax) return 'recipe_time_changed';
  } else {
    if (shot.actualDoseG == null || shot.actualYieldG == null) return 'missing_comparability_fields';
    if (Math.abs(shot.actualDoseG - targetDose) > 0.5) return 'actual_dose_mismatch';
    if (Math.abs(shot.actualYieldG - targetYield) > 1.5) return 'actual_yield_mismatch';

    if (shot.targetTimeMinS != null && shot.targetTimeMaxS != null) {
      if (shot.targetTimeMinS !== recipeMin || shot.targetTimeMaxS !== recipeMax) return 'recipe_time_changed';
    }
    if (shot.targetDoseG != null && Math.abs(shot.targetDoseG - targetDose) > 0.01) return 'recipe_dose_target';
    if (shot.targetYieldG != null && Math.abs(shot.targetYieldG - targetYield) > 0.01) return 'recipe_yield_target';
  }

  if (!flairEnabled || !recipe?.flairProfile) return null;

  if (!shot.flairProfile) return 'missing_flair_profile';

  const p1 = shot.flairProfile || {};
  const p2 = recipe.flairProfile || {};
  if (p1.preinfusionPressure !== p2.preinfusionPressure) return 'flair_profile_mismatch';
  if (p1.peakPressure !== p2.peakPressure) return 'flair_profile_mismatch';
  if (p1.taperPressure !== p2.taperPressure) return 'flair_profile_mismatch';
  if (p1.preinfusion !== p2.preinfusion) return 'flair_profile_mismatch';
  return null;
}

export function shotMatchesRecipeContext(shot, recipe, flairEnabled = false) {
  return shotRecipeMismatchReason(shot, recipe, flairEnabled) === null;
}
