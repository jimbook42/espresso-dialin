import { defaultBrewTemperatureForGrinder } from '../grinders/grinderRegistry.js';
import { generateId } from './grinderLogic.js';

export const DEFAULT_RECIPE_TARGETS = {
  targetDoseG: 18,
  targetYieldG: 36,
  targetTimeMinS: 27,
  targetTimeMaxS: 32,
};

function finiteNumbers(values) {
  return values.filter((v) => Number.isFinite(v));
}

function modeRounded(values) {
  const nums = finiteNumbers(values.map((v) => Number(v)));
  if (nums.length === 0) return null;
  const counts = new Map();
  for (const n of nums) {
    const key = Math.round(n * 10) / 10;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = nums[0];
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = value;
    }
  }
  return best;
}

function recipeTargetFilled(value) {
  return value !== null && value !== undefined && value !== '';
}

/**
 * Infer dose/yield/time targets from logged shots (export import or legacy history).
 */
export function inferRecipeTargetsFromShots(shotsForBean = []) {
  if (!shotsForBean.length) {
    return { ...DEFAULT_RECIPE_TARGETS };
  }

  const shotTargets = shotsForBean.filter(
    (s) => recipeTargetFilled(s.targetYieldG) || recipeTargetFilled(s.targetTimeMinS)
  );
  const targetTimeMinS = modeRounded(
    shotTargets.map((s) => s.targetTimeMinS).filter(recipeTargetFilled)
  );
  const targetTimeMaxS = modeRounded(
    shotTargets.map((s) => s.targetTimeMaxS).filter(recipeTargetFilled)
  );
  const targetDoseG = modeRounded([
    ...shotTargets.map((s) => s.targetDoseG).filter(recipeTargetFilled),
    ...shotsForBean.map((s) => s.actualDoseG),
  ]);
  const targetYieldG = modeRounded([
    ...shotTargets.map((s) => s.targetYieldG).filter(recipeTargetFilled),
    ...shotsForBean.map((s) => s.actualYieldG),
  ]);

  return {
    targetDoseG: targetDoseG ?? DEFAULT_RECIPE_TARGETS.targetDoseG,
    targetYieldG: targetYieldG ?? DEFAULT_RECIPE_TARGETS.targetYieldG,
    targetTimeMinS: targetTimeMinS ?? DEFAULT_RECIPE_TARGETS.targetTimeMinS,
    targetTimeMaxS: targetTimeMaxS ?? DEFAULT_RECIPE_TARGETS.targetTimeMaxS,
  };
}

/**
 * Recipe used on Dial / learning when a stored row is missing or incomplete.
 */
export function resolveRecipeForBean(bean, storedRecipe, shotsForBean, grinderModel) {
  const inferred = inferRecipeTargetsFromShots(shotsForBean);
  const brewTemperatureC =
    storedRecipe?.brewTemperatureC ?? defaultBrewTemperatureForGrinder(grinderModel);

  if (!storedRecipe) {
    return {
      id: null,
      beanId: bean?.id ?? null,
      ...inferred,
      brewTemperatureC,
      flairProfile: null,
    };
  }

  return {
    ...storedRecipe,
    targetDoseG: recipeTargetFilled(storedRecipe.targetDoseG)
      ? storedRecipe.targetDoseG
      : inferred.targetDoseG,
    targetYieldG: recipeTargetFilled(storedRecipe.targetYieldG)
      ? storedRecipe.targetYieldG
      : inferred.targetYieldG,
    targetTimeMinS: recipeTargetFilled(storedRecipe.targetTimeMinS)
      ? storedRecipe.targetTimeMinS
      : inferred.targetTimeMinS,
    targetTimeMaxS: recipeTargetFilled(storedRecipe.targetTimeMaxS)
      ? storedRecipe.targetTimeMaxS
      : inferred.targetTimeMaxS,
    brewTemperatureC,
  };
}

/**
 * @param {import('dexie').Dexie} database
 */
export async function persistBeanRecipeForBean(database, beanId, recipeForm, existingRecipe, grinderModel) {
  const payload = recipeFormToPersisted(recipeForm, grinderModel);
  if (existingRecipe?.id) {
    await database.recipes.update(existingRecipe.id, {
      ...existingRecipe,
      ...payload,
      beanId,
    });
    return existingRecipe.id;
  }
  const id = generateId();
  await database.recipes.add({
    id,
    beanId,
    ...payload,
  });
  return id;
}

export function recipeFormToPersisted(recipeForm, grinderModel) {
  const dose = parseFloat(recipeForm.targetDoseG);
  const yieldG = parseFloat(recipeForm.targetYieldG);
  const tMin = parseInt(String(recipeForm.targetTimeMinS), 10);
  const tMax = parseInt(String(recipeForm.targetTimeMaxS), 10);
  return {
    targetDoseG: Number.isFinite(dose) ? dose : DEFAULT_RECIPE_TARGETS.targetDoseG,
    targetYieldG: Number.isFinite(yieldG) ? yieldG : DEFAULT_RECIPE_TARGETS.targetYieldG,
    targetTimeMinS: Number.isFinite(tMin) ? tMin : DEFAULT_RECIPE_TARGETS.targetTimeMinS,
    targetTimeMaxS: Number.isFinite(tMax) ? tMax : DEFAULT_RECIPE_TARGETS.targetTimeMaxS,
    brewTemperatureC:
      recipeForm.brewTemperatureC ?? defaultBrewTemperatureForGrinder(grinderModel),
    flairProfile: recipeForm.flairProfile ?? null,
  };
}
