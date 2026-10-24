import { isPressureSimAllowed } from './pressureSimFlag.js';

/** IndexedDB recipe id used by QA screenshot seeds when sim pressure is enabled. */
export const PRESSURE_SIM_RECIPE_ID = 'lab-recipe';

/**
 * Flair profile with pre-infusion, peak, and taper pressure steps (QA / screenshot builds only).
 * @returns {Record<string, string> | null}
 */
export function pressureSimRecipeFlairProfile() {
  if (!isPressureSimAllowed()) return null;
  return {
    preinfusionPressure: '2',
    preinfusionTime: '5',
    preinfusionEndTrigger: 'time',
    peakPressure: '9',
    taperPressure: '6',
    taperStartTrigger: 'time',
    taperStartTimeS: '12',
    peakEndYield: '28',
  };
}

/**
 * @param {string} beanId
 * @returns {object | null}
 */
export function pressureSimRecipeRecord(beanId = 'lab-bean') {
  const flairProfile = pressureSimRecipeFlairProfile();
  if (!flairProfile) return null;
  return {
    id: PRESSURE_SIM_RECIPE_ID,
    beanId,
    targetTimeMinS: 27,
    targetTimeMaxS: 32,
    targetDoseG: 18,
    targetYieldG: 36,
    flairProfile,
  };
}
