import Dexie from 'dexie';
import { formatRecentRecipeShotEvidence } from './shotCountDisplay.js';
import {
  SETTE_GRINDER_ID,
  SUNBEAM_GRINDER_ID,
  adjustSette,
  adjustSunbeam,
  numericToSette,
  setteToNumeric,
  getRecommendationGrinderProfile,
  resolveShotStatsGrinderModel,
  getShotStatsGrinderProfile,
  isSetteGrinderModel,
  isNicheZeroGrinderModel,
  isSunbeamGrinderModel,
  isCustomGrinderModel,
  grinderSupportsQuantitativeRecommendations,
  NICHE_ZERO_GRINDER_ID,
  getGrinderDefinitionById,
} from '../grinders/grinderRegistry.js';
import { adjustCustomGrind, defaultCustomGrindValue } from '../grinders/customGrinder.js';
import {
  parseNicheZeroSetting,
  NICHE_ZERO_DEFAULT_SETTING,
  NICHE_ZERO_DIAL_MIN,
  NICHE_ZERO_DIAL_MAX,
} from '../grinders/nicheZero.js';
import {
  recommendNicheZeroFromEvidence,
  recommendNicheTimingBounded,
  buildNicheEmpiricalReason,
  NICHE_EMPIRICAL_VALIDATION_NOTE,
  buildNicheFallbackReason,
  buildNicheTimingBoundedReason,
  TIMING_BOUNDED_UNRELIABLE_CODES,
} from '../grinders/nicheZeroLearning.js';
import {
  diagnoseNicheLearningEligibility,
  buildNicheEligibilityLearningNote,
} from '../grinders/nicheEligibility.js';
import { isBalancedTaste, normalizeTasteProfile } from './tasteProfile.js';
import {
  CURRENT_PULL_ELIGIBILITY_ID,
  isPersistedLearningShot,
} from './learningShotIdentity.js';
import {
  buildOutlierRecommendationReason,
  dampQuantitativeShift,
  detectLikelyShotOutlier,
  filterComparableShotsForNicheLearning,
  grindNumericFromShotData,
  sensitivityConfidenceForQuantitativeGrinder,
  shotsForOutlierContext,
  KNOWN_ISSUE_OUTLIER_HINT,
} from './recommendationTuning.js';

export { CURRENT_PULL_ELIGIBILITY_ID, isPersistedLearningShot } from './learningShotIdentity.js';

export { NICHE_ZERO_GRINDER_ID } from '../grinders/grinderRegistry.js';

export {
  setteToNumeric,
  numericToSette,
  adjustSette,
  adjustSunbeam,
  grinderSupportsQuantitativeRecommendations,
} from '../grinders/grinderRegistry.js';

export const db = new Dexie('EspressoDialDB');

// Bumped to version 17 to accommodate persisted current grind settings.
// isDecaf is a non-indexed property on the bean object. No version bump:
// Dexie keeps existing beans, recipes, and shots. Beans saved before this
// field existed omit it; readers treat a missing value as regular coffee.
// excludeFromLearning / knownIssueReason are non-indexed shot properties.
// Missing excludeFromLearning means the shot participates in learning (legacy behaviour).
db.version(17).stores({
  beans: 'id, name, roaster, roastDate, storageType, postThawStorage, freezeDate, thawDate, rating, isFinished, createdAt',
  recipes: 'id, beanId, targetDoseG, targetYieldG, targetTimeMinS, targetTimeMaxS',
  shots: 'id, beanId, timestamp, grinderModel, setteMacro, setteMicro, sunbeamSetting',
  // settings row also stores darkMode, Brew Guide config, and brew guidance UI prefs (UI only); no schema bump — Dexie keeps existing shot/bean data at v17
  settings: 'id, grinderModel, flairEnabled, preInfusionEnabled, lastSetteMacro, lastSetteMicro, lastSunbeamSetting'
});

/**
 * True only when the bean was explicitly marked decaf.
 * Missing, false, and any other value stay regular coffee.
 * Do not infer decaf from the name, roaster, or shot history.
 */
export function beanIsDecaf(bean) {
  return bean?.isDecaf === true;
}

/** Shots marked with a known non-grind issue stay in history but are omitted from learning. */
export function shotEligibleForLearning(shot) {
  return shot?.excludeFromLearning !== true;
}

export {
  shotMatchesGrinderForLearning,
  shotHasSavedRecipeTargetContext,
  shotRecipeMismatchReason,
  findLatestShotForBeanAndGrinder,
} from '../grinders/grinderLearningMatch.js';
import {
  shotMatchesGrinderForLearning,
  shotMatchesRecipeContext as shotMatchesRecipeContextImpl,
} from '../grinders/grinderLearningMatch.js';

/** Shots that may influence recommendations for the active grinder and bean. */
export function filterShotsForGrinderLearning(shots, { beanId, grinderModel }) {
  if (!beanId || !grinderModel) return [];
  return shots.filter(
    (s) => s.beanId === beanId && shotEligibleForLearning(s) && shotMatchesGrinderForLearning(s, grinderModel)
  );
}

export const KNOWN_ISSUE_REASONS = {
  puck_prep: 'Puck prep issue',
  overheated: 'Grounds/beans overheated or left exposed',
  stopped_early: 'Shot stopped early',
  other: 'Other known issue',
};

/** In-range yield miss that blocks a dialled-in result and raises a yield warning. */
const MATERIAL_YIELD_DELTA_G = 3.5;

export function knownIssueReasonLabel(reasonKey) {
  return KNOWN_ISSUE_REASONS[reasonKey] || KNOWN_ISSUE_REASONS.other;
}

/**
 * Explainability only. Does not change grind, age, yield, taste, or warnings.
 * Regular and legacy beans return null so their recommendation UI is unchanged.
 *
 * source:
 * - 'shots' — this bean already has logged results
 * - 'decaf-history' — starting point comes from other decaf shots of this roast
 * - 'roast-baseline' — no decaf history yet; roast-class default plus the usual age adjustment
 */
export function decafContextNote(bean, source = 'roast-baseline') {
  if (!beanIsDecaf(bean)) return null;
  if (source === 'shots') {
    return 'Decaf can behave differently from regular coffee, and that varies by the coffee. This grind follows your logged shots, not a fixed decaf adjustment.';
  }
  if (source === 'decaf-history') {
    return 'Decaf can behave differently from regular coffee, and that varies by the coffee. This starting grind follows your previous decaf shots for this roast, not a fixed decaf adjustment.';
  }
  return 'Decaf can behave differently from regular coffee, and that varies by the coffee. This starting grind uses this roast\'s usual baseline, not your regular-coffee dial-ins, until you log a shot.';
}

export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
}

/** Recipe + optional Flair context for evidence (current recipe targets). */
export function shotMatchesRecipeContext(shot, recipe, flairEnabled = false) {
  return shotMatchesRecipeContextImpl(shot, recipe, flairEnabled);
}

export const PREVIOUS_RECIPE_REC_DISCLAIMER =
  'Based on your previous recipe — treat as a starting point';

/**
 * When the recipe changed but nothing is logged yet for the new targets, keep showing
 * the last shot's saved recommendation until the user logs on the current recipe.
 */
export function shouldUsePreviousRecipeRecommendation({
  lastLoggedShot,
  activeRecipe,
  beanShotsForGrinder,
  flairEnabled = false,
}) {
  if (!lastLoggedShot || !activeRecipe) return false;
  const hasLoggedShotOnCurrentRecipe = beanShotsForGrinder.some((s) =>
    shotMatchesRecipeContext(s, activeRecipe, flairEnabled)
  );
  if (hasLoggedShotOnCurrentRecipe) return false;
  if (shotMatchesRecipeContext(lastLoggedShot, activeRecipe, flairEnabled)) return false;
  return Boolean(lastLoggedShot.recommendation?.recommendedSetting);
}

export function recipeContextForShot(shot, recipe = {}) {
  return {
    targetTimeMinS: shot.targetTimeMinS ?? recipe.targetTimeMinS ?? 27,
    targetTimeMaxS: shot.targetTimeMaxS ?? recipe.targetTimeMaxS ?? 32,
    targetDoseG: recipe.targetDoseG ?? 18,
    targetYieldG: recipe.targetYieldG ?? 36,
    brewTemperatureC: shot.brewTemperatureC ?? recipe.brewTemperatureC,
    flairProfile: shot.flairProfile ?? recipe.flairProfile,
  };
}

/**
 * Severe choke: the shot is at least one full target window past targetMax
 * AND yield is at or below half the recipe target. That is a stalled
 * extraction, not a completed shot that finished a few grams short.
 * Elapsed time is not a target-yield extraction and is not scaled up to one.
 */
export function shotIsSevereChoke(actualTimeS, actualYieldG, targetTimeMinS, targetTimeMaxS, targetYieldG) {
  const targetMin = Number(targetTimeMinS);
  const targetMax = Number(targetTimeMaxS);
  const targetYield = Number(targetYieldG);
  const time = Number(actualTimeS);
  const yieldG = Number(actualYieldG);
  if (![targetMin, targetMax, targetYield, time, yieldG].every(Number.isFinite)) return false;
  if (targetYield <= 0 || targetMax < targetMin) return false;

  const windowS = targetMax - targetMin;
  const substantiallySlower = time >= targetMax + windowS;
  const substantiallyUnderYield = yieldG <= targetYield / 2;
  return substantiallySlower && substantiallyUnderYield;
}

/**
 * Coarse steps for a severe choke, using the same seconds-per-step sensitivity
 * as a normal out-of-range shot. The clock stops counting at the choke
 * boundary (one target window past targetMax). Extra seconds are ignored.
 */
function severeChokeCoarseShift(grinderModel, targetMin, targetMax, settings = null) {
  const windowS = Math.max(targetMax - targetMin, 0);
  const cappedDelta = 1.5 * windowS;
  const sensitivity = getRecommendationGrinderProfile(grinderModel, settings).sensitivity;
  const shift = Math.round(cappedDelta / sensitivity);
  return shift > 0 ? shift : 1;
}

/** Derived shot state for the active recipe context (not persisted). */
export function classifyShotOutcome(shot, recipe) {
  const ctx = recipeContextForShot(shot, recipe);
  const time = Number(shot.actualTimeS ?? shot.actualTime ?? 0);
  const yieldG = Number(shot.actualYieldG ?? shot.actualYield ?? 0);
  const taste = normalizeTasteProfile(shot.tasteProfile);
  const targetMin = ctx.targetTimeMinS;
  const targetMax = ctx.targetTimeMaxS;
  const targetYield = ctx.targetYieldG ?? 36;

  const isTimeInRange = time >= targetMin && time <= targetMax;
  const isSour = taste === 'sour' || taste === 'very_sour';
  const isBitter = taste === 'bitter' || taste === 'very_bitter';
  const isNegativeTaste = isSour || isBitter;
  const isGoodTaste = isBalancedTaste(taste);
  const yieldDelta = yieldG - targetYield;
  const hasYieldIssue = isTimeInRange && Math.abs(yieldDelta) >= MATERIAL_YIELD_DELTA_G;
  const isSevereChoke = shotIsSevereChoke(time, yieldG, targetMin, targetMax, targetYield);

  const isDialledIn = isTimeInRange && isGoodTaste && !hasYieldIssue;

  let statusLabel = null;
  if (isDialledIn) statusLabel = 'DIALLED IN';
  else if (isTimeInRange) statusLabel = 'IN RANGE';

  return {
    isDialledIn,
    isTimeInRange,
    isNegativeTaste,
    hasYieldIssue,
    isSevereChoke,
    statusLabel,
  };
}

export function shotResultImproved(previousShot, currentShotData, recipe) {
  if (!previousShot) return false;
  const prev = classifyShotOutcome(previousShot, recipeContextForShot(previousShot, recipe));
  const curr = classifyShotOutcome(
    {
      actualTimeS: currentShotData.actualTime,
      actualYieldG: currentShotData.actualYield,
      tasteProfile: normalizeTasteProfile(currentShotData.tasteProfile),
      targetTimeMinS: recipe.targetTimeMinS,
      targetTimeMaxS: recipe.targetTimeMaxS,
    },
    recipe
  );

  if (curr.isDialledIn && !prev.isDialledIn) return true;

  const targetMid = ((recipe.targetTimeMinS || 27) + (recipe.targetTimeMaxS || 32)) / 2;
  const prevTime = Number(previousShot.actualTimeS ?? 0);
  const currTime = Number(currentShotData.actualTime ?? 0);
  const prevDist = Math.abs(prevTime - targetMid);
  const currDist = Math.abs(currTime - targetMid);

  if (curr.isTimeInRange && !prev.isTimeInRange && currDist <= prevDist) return true;
  if (prev.isNegativeTaste && !curr.isNegativeTaste && curr.isTimeInRange) return true;
  if (currDist + 0.5 < prevDist && !curr.isNegativeTaste) return true;

  return false;
}

function loggedRecipeComparableShots(shots, recipe, flairEnabled) {
  return [...shots]
    .filter(isPersistedLearningShot)
    .filter(shotEligibleForLearning)
    .filter((s) => shotMatchesRecipeContext(s, recipe, flairEnabled))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

export function getRecommendationEvidenceContext(recentShots, recipe, flairEnabled = false) {
  const comparable = loggedRecipeComparableShots(recentShots, recipe, flairEnabled);
  if (comparable.length === 0) return null;
  return formatRecentRecipeShotEvidence(comparable.length);
}

function evidenceContextForRecommendation(recentShots, shotData, recipe, flairEnabled, options) {
  const pool = shotsForNicheEligibilityDiagnosis(recentShots, shotData, recipe, options);
  return getRecommendationEvidenceContext(pool, recipe, flairEnabled);
}

function freshnessOffsetsForEffectiveDays(effectiveDays) {
  const days = Math.max(0, Math.floor(Number(effectiveDays) || 0));
  let offsetSette = 0;
  let offsetSunbeam = 0;
  if (days <= 3) { offsetSette = -3; offsetSunbeam = -2; }
  else if (days <= 7) { offsetSette = -2; offsetSunbeam = -1; }
  else if (days <= 14) { offsetSette = -1; offsetSunbeam = 0; }
  else if (days <= 30) { offsetSette = 0; offsetSunbeam = 0; }
  else if (days <= 45) { offsetSette = 1; offsetSunbeam = 1; }
  else if (days <= 60) { offsetSette = 2; offsetSunbeam = 1; }
  else { offsetSette = 3; offsetSunbeam = 2; }
  return { offsetSette, offsetSunbeam };
}

export function getIdealFreezeWindow(roastType) {
  switch (roastType) {
    case 'Light': return { min: 14, max: 21, label: '14–21 days post-roast' };
    case 'Dark': return { min: 5, max: 7, label: '5–7 days post-roast' };
    case 'Medium':
    default:
      return { min: 7, max: 14, label: '7–14 days post-roast' };
  }
}

export function calculateEffectiveBeanAge(bean, mockDateOverride = null) {
  if (!bean || !bean.roastDate) return { daysOld: 0, recommendedOffsetSette: 0, recommendedOffsetSunbeam: 0, notice: '' };

  const roastDate = new Date(bean.roastDate);
  const today = mockDateOverride ? new Date(mockDateOverride) : new Date();
  let effectiveDays = 0;
  const storageType = bean.storageType || 'bag';
  const postThawStorage = bean.postThawStorage || 'bag';

  if (storageType === 'frozen') {
    if (!bean.freezeDate) {
      effectiveDays = Math.max(0, Math.floor((today - roastDate) / (1000 * 60 * 60 * 24)));
    } else {
      const freezeDate = new Date(bean.freezeDate);
      const ageAtFreeze = Math.max(0, Math.floor((freezeDate - roastDate) / (1000 * 60 * 60 * 24)));
      if (!bean.thawDate) {
        effectiveDays = ageAtFreeze; // Clock paused
      } else {
        const thawDate = new Date(bean.thawDate);
        const daysSinceThaw = Math.max(0, Math.floor((today - thawDate) / (1000 * 60 * 60 * 24)));
        const thawDecayMultiplier = postThawStorage === 'vacuum' ? 0.9 : 1.1;
        effectiveDays = ageAtFreeze + Math.floor(daysSinceThaw * thawDecayMultiplier);
      }
    }
  } else if (storageType === 'vacuum') {
    const rawDays = Math.max(0, Math.floor((today - roastDate) / (1000 * 60 * 60 * 24)));
    effectiveDays = Math.floor(rawDays * 0.85);
  } else {
    effectiveDays = Math.max(0, Math.floor((today - roastDate) / (1000 * 60 * 60 * 24)));
  }

  const { offsetSette, offsetSunbeam } = freshnessOffsetsForEffectiveDays(effectiveDays);

  const storageLabels = { frozen: 'Frozen Storage', vacuum: 'Vacuum Sealed Bag', bag: 'Standard Bag' };
  let notice = `(${storageLabels[storageType] || 'Standard'} • ${bean.roastType} Roast) Effective age: ${effectiveDays} days.`;

  return { daysOld: effectiveDays, recommendedOffsetSette: offsetSette, recommendedOffsetSunbeam: offsetSunbeam, notice };
}

export function getHistoricalRoastBaseline(grinderModel, roastType, recipes = [], allShots = [], beans = [], decafScope = 'regular') {
  const successfulShots = allShots.filter(s => {
    if (!shotEligibleForLearning(s)) return false;
    if (s.grinderModel !== grinderModel) return false;
    const bean = beans.find(b => b.id === s.beanId);
    if (!bean || bean.roastType !== roastType) return false;
    // Explicit decaf shots stay in their own pool so they cannot move regular baselines.
    // Legacy beans omit isDecaf and remain in the regular pool.
    const shotIsDecaf = beanIsDecaf(bean);
    if (decafScope === 'decaf') {
      if (!shotIsDecaf) return false;
    } else if (shotIsDecaf) {
      return false;
    }
    const recipe = recipes.find(r => r.beanId === s.beanId);
    if (!recipe) return false;

    const ctx = recipeContextForShot(s, recipe);
    return classifyShotOutcome(s, ctx).isDialledIn;
  }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (successfulShots.length === 0) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  successfulShots.forEach((s, idx) => {
    const weight = Math.pow(0.7, idx);
    const profile = getRecommendationGrinderProfile(grinderModel);
    const num = profile.shotToNumeric(s);
    if (!Number.isFinite(num)) return;
    weightedSum += num * weight;
    totalWeight += weight;
  });
  const average = weightedSum / totalWeight;
  if (isNicheZeroGrinderModel(grinderModel)) {
    return Math.round(average * 10) / 10;
  }
  return Math.round(average);
}

export function getAgeAdjustedRecommendation(lastShot, activeBean, mockDate = null, settings = null) {
  if (!lastShot || !lastShot.recommendation || !lastShot.recommendation.recommendedSetting) return null;

  const currentAgeData = calculateEffectiveBeanAge(activeBean, mockDate);
  const currentAge = currentAgeData.daysOld;
  const shotAge = lastShot.beanAgeDays !== undefined ? lastShot.beanAgeDays : currentAge;

  const ageDelta = currentAge - shotAge;
  let ageShiftSette = 0;
  let ageShiftSunbeam = 0;
  let ageWarning = null;

  if (ageDelta <= -4) {
    ageShiftSette = 2;
    ageShiftSunbeam = 1;
    ageWarning = `Thaw/Freshness detected: Active beans are ${Math.abs(ageDelta)} days fresher than your last logged shot. Recommendation dynamically shifted coarser to compensate.`;
  } else if (ageDelta <= -2) {
    ageShiftSette = 1;
    ageShiftSunbeam = 1;
    ageWarning = `Bean freshness shift detected. Recommendation dynamically shifted coarser.`;
  } else if (ageDelta >= 10) {
    ageShiftSette = -2;
    ageShiftSunbeam = -1;
    ageWarning = `Aging detected: Active beans are ${ageDelta} days older than your last logged shot. Recommendation dynamically shifted finer to compensate.`;
  } else if (ageDelta >= 5) {
    ageShiftSette = -1;
    ageShiftSunbeam = 0;
    ageWarning = `Bean aged ${ageDelta} days since last shot. Recommendation dynamically shifted finer.`;
  }

  let adjustedSetting = { ...lastShot.recommendation.recommendedSetting };

  if (lastShot.grinderModel === SETTE_GRINDER_ID && ageShiftSette !== 0) {
    adjustedSetting = adjustSette(adjustedSetting.macro, adjustedSetting.micro, ageShiftSette);
  } else if (lastShot.grinderModel === SUNBEAM_GRINDER_ID && ageShiftSunbeam !== 0) {
    adjustedSetting.setting = adjustSunbeam(adjustedSetting.setting, ageShiftSunbeam);
  } else if (isNicheZeroGrinderModel(lastShot.grinderModel)) {
    // Niche has no calibrated quantitative age shift.
  } else if (isCustomGrinderModel(lastShot.grinderModel, settings)) {
    const def = getGrinderDefinitionById(lastShot.grinderModel, settings);
    const shift = ageShiftSunbeam !== 0 ? ageShiftSunbeam : ageShiftSette;
    if (shift !== 0 && adjustedSetting.customGrindValue != null) {
      adjustedSetting = def.adjustSetting(shift, { customGrindValue: adjustedSetting.customGrindValue });
    }
  }

  return {
    recommendedSetting: adjustedSetting,
    ageWarning: ageWarning,
    originalReason: lastShot.recommendation.reason,
    warning: lastShot.recommendation.warning,
    subRecommendation: lastShot.recommendation.subRecommendation,
    flairWaterTempAdvice: lastShot.recommendation.flairWaterTempAdvice,
    evidenceContext: lastShot.recommendation.evidenceContext,
  };
}

/**
 * Re-run Niche recommendation for display using full saved shot history (excluding the evaluated shot from learning pool).
 */
export function recomputeQuantitativeRecommendationFromLastShot(
  lastShot,
  recipe,
  grinderBeanShots = [],
  flairEnabled = false,
  settings = null
) {
  if (!lastShot || !recipe) return null;
  if (
    !grinderSupportsQuantitativeRecommendations(lastShot.grinderModel, settings)
    || isNicheZeroGrinderModel(lastShot.grinderModel)
  ) {
    return null;
  }
  const history = grinderBeanShots.filter((s) => s.id !== lastShot.id);
  return calculateRecommendation(
    {
      id: lastShot.id,
      beanId: lastShot.beanId,
      grinderModel: lastShot.grinderModel,
      setteMacro: lastShot.setteMacro,
      setteMicro: lastShot.setteMicro,
      sunbeamSetting: lastShot.sunbeamSetting,
      nicheZeroSetting: null,
      customGrindValue: lastShot.customGrindValue,
      wasPurged: lastShot.wasPurged !== false,
      actualTime: lastShot.actualTimeS,
      actualYield: lastShot.actualYieldG,
      tasteProfile: lastShot.tasteProfile,
      lastShotGrind: null,
      recommendationFollowed: true,
      previousShot: null,
    },
    recipe,
    history,
    flairEnabled,
    { eligibilityShots: grinderBeanShots, settings }
  );
}

export function recomputeNicheRecommendationFromLastShot(lastShot, recipe, grinderBeanShots = [], flairEnabled = false) {
  if (!lastShot || !isNicheZeroGrinderModel(lastShot.grinderModel) || !recipe) return null;
  const history = grinderBeanShots.filter((s) => s.id !== lastShot.id);
  return calculateRecommendation(
    {
      id: lastShot.id,
      beanId: lastShot.beanId,
      grinderModel: lastShot.grinderModel,
      setteMacro: null,
      setteMicro: null,
      sunbeamSetting: null,
      nicheZeroSetting: lastShot.nicheZeroSetting,
      wasPurged: lastShot.wasPurged !== false,
      actualTime: lastShot.actualTimeS,
      actualYield: lastShot.actualYieldG,
      tasteProfile: lastShot.tasteProfile,
      lastShotGrind: null,
      recommendationFollowed: true,
      previousShot: null,
    },
    recipe,
    history,
    flairEnabled,
    { eligibilityShots: grinderBeanShots }
  );
}

/** Shot-shaped row for eligibility counts when the current pull is not in the history pool yet. */
export function eligibilityShotFromCurrentPull(shotData, recipe, beanId) {
  if (!beanId || shotData?.actualTime == null) return null;
  return {
    id: shotData.id ?? CURRENT_PULL_ELIGIBILITY_ID,
    beanId,
    grinderModel: shotData.grinderModel,
    nicheZeroSetting: shotData.nicheZeroSetting,
    actualTimeS: shotData.actualTime,
    actualDoseG: shotData.actualDose,
    actualYieldG: shotData.actualYield,
    targetDoseG: recipe?.targetDoseG,
    targetYieldG: recipe?.targetYieldG,
    targetTimeMinS: recipe?.targetTimeMinS,
    targetTimeMaxS: recipe?.targetTimeMaxS,
    excludeFromLearning: shotData.excludeFromLearning === true,
  };
}

function shotsForNicheEligibilityDiagnosis(recentShots, shotData, recipe, options = {}) {
  const pool = options.eligibilityShots ?? recentShots;
  const current = eligibilityShotFromCurrentPull(shotData, recipe, shotData.beanId ?? pool[0]?.beanId);
  if (!current) return pool;
  const inPool = pool.some((s) => s.id && current.id && s.id === current.id);
  if (inPool) return pool;
  return [current, ...pool];
}

export function getInitialGrindRecommendation(
  grinderModel,
  roastType,
  activeBean,
  recipes = [],
  allShots = [],
  beans = [],
  mockDateOverride = null,
  flairEnabled = undefined,
  settings = null
) {
  const beanShots = allShots.filter(
    (s) =>
      s.beanId === activeBean?.id
      && shotEligibleForLearning(s)
      && shotMatchesGrinderForLearning(s, grinderModel)
  );
  const currentRecipe = recipes.find(r => r.beanId === activeBean?.id) || {};
  const flairForMatch = flairEnabled === undefined ? Boolean(currentRecipe.flairProfile) : flairEnabled;

  let bestShot = null;
  let sameRecipeShots = [];
  if (beanShots.length > 0) {
    const sortedBeanShots = [...beanShots].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    sameRecipeShots = sortedBeanShots.filter((s) => shotMatchesRecipeContext(s, currentRecipe, flairForMatch));

    const dialledInRecipeShots = sameRecipeShots.filter((s) =>
      classifyShotOutcome(s, recipeContextForShot(s, currentRecipe)).isDialledIn
    );

    if (dialledInRecipeShots.length > 0) bestShot = dialledInRecipeShots[0];
    else if (sameRecipeShots.length > 0) bestShot = sameRecipeShots[0];
    else bestShot = sortedBeanShots[0];
  }

  if (bestShot) {
    const adjustedRec = getAgeAdjustedRecommendation(bestShot, activeBean, mockDateOverride, settings);
    const fromComparableRecipe = sameRecipeShots.some((s) => s.id === bestShot.id);
    const historySource = fromComparableRecipe ? 'bean-history' : 'bean-history-other-recipe';

    if (adjustedRec && adjustedRec.recommendedSetting) {
      if (isSetteGrinderModel(grinderModel)) {
        return { macro: adjustedRec.recommendedSetting.macro, micro: adjustedRec.recommendedSetting.micro, initialSource: historySource };
      }
      if (isNicheZeroGrinderModel(grinderModel)) {
        return {
          nicheZeroSetting:
            parseNicheZeroSetting(adjustedRec.recommendedSetting.nicheZeroSetting)
            ?? parseNicheZeroSetting(bestShot.nicheZeroSetting)
            ?? NICHE_ZERO_DEFAULT_SETTING,
          initialSource: historySource,
        };
      }
      if (isCustomGrinderModel(grinderModel, settings)) {
        return {
          customGrindValue:
            adjustedRec.recommendedSetting.customGrindValue ?? bestShot.customGrindValue,
          initialSource: historySource,
        };
      }
      return { setting: adjustedRec.recommendedSetting.setting, initialSource: historySource };
    }
    if (isSetteGrinderModel(grinderModel)) {
      return { macro: bestShot.setteMacro || 13, micro: bestShot.setteMicro || 'E', initialSource: historySource };
    }
    if (isNicheZeroGrinderModel(grinderModel)) {
      return {
        nicheZeroSetting: parseNicheZeroSetting(bestShot.nicheZeroSetting) ?? NICHE_ZERO_DEFAULT_SETTING,
        initialSource: historySource,
      };
    }
    if (isCustomGrinderModel(grinderModel, settings)) {
      const def = getGrinderDefinitionById(grinderModel, settings);
      return {
        customGrindValue: bestShot.customGrindValue ?? defaultCustomGrindValue(def.customProfile),
        initialSource: historySource,
      };
    }
    return { setting: bestShot.sunbeamSetting || 15, initialSource: historySource };
  }

  const ageData = calculateEffectiveBeanAge(activeBean, mockDateOverride);
  const decafBean = beanIsDecaf(activeBean);
  // No shots for this bean yet. Same-roast decaf dial-ins are the decaf prior's
  // evidence. Regular dial-ins stay out of that pool. With no decaf evidence,
  // baseline stays null and the Light/Medium/Dark default below is the prior,
  // then the existing age offset. There is no decaf grind-direction offset.
  const baseline = getHistoricalRoastBaseline(
    grinderModel,
    roastType,
    recipes,
    allShots,
    beans,
    decafBean ? 'decaf' : 'regular'
  );

  if (isSetteGrinderModel(grinderModel)) {
    let baseNumeric = baseline !== null ? baseline : (roastType === 'Light' ? 15 * 9 + 2 : roastType === 'Dark' ? 12 * 9 + 5 : 13 * 9 + 4);
    return numericToSette(baseNumeric + ageData.recommendedOffsetSette);
  }
  if (isNicheZeroGrinderModel(grinderModel)) {
    const baseDial = baseline !== null ? baseline : NICHE_ZERO_DEFAULT_SETTING;
    return {
      nicheZeroSetting: parseNicheZeroSetting(baseDial) ?? NICHE_ZERO_DEFAULT_SETTING,
      initialSource: baseline !== null ? 'roast-baseline' : 'app-default',
    };
  }
  if (isCustomGrinderModel(grinderModel, settings)) {
    const def = getGrinderDefinitionById(grinderModel, settings);
    const profile = def.customProfile;
    let base = baseline !== null ? baseline : defaultCustomGrindValue(profile);
    base = adjustCustomGrind(base, ageData.recommendedOffsetSunbeam, profile);
    return { customGrindValue: base, initialSource: baseline !== null ? 'roast-baseline' : 'app-default' };
  }
  let baseSetting = baseline !== null ? baseline : (roastType === 'Light' ? 17 : roastType === 'Dark' ? 13 : 15);
  return { setting: Math.min(Math.max(baseSetting + ageData.recommendedOffsetSunbeam, 1), 30) };
}

function prefixEstimatedGrindReason(reason, grinderProfile) {
  if (!grinderProfile?.recommendationIsEstimated) return reason;
  const text = reason || '';
  if (text.toUpperCase().startsWith('ESTIMATED')) return text;
  return `ESTIMATED — ${text}`;
}

function buildNicheZeroQualitativeReason({
  severeChoke,
  isTimeInRange,
  tasteProfile,
  timeDelta,
}) {
  if (severeChoke) {
    return 'SEVERE CHOKE — Grind substantially coarser on the Niche dial (higher number). Dial step size is not auto-calibrated in this app.';
  }
  if (isTimeInRange) {
    if (tasteProfile === 'very_sour') {
      return 'Shot is in range but tastes very sour — grind finer (lower dial number). Auto step size is not calibrated.';
    }
    if (tasteProfile === 'sour') {
      return 'Shot is in range but tastes sour — grind finer (lower dial number). Auto step size is not calibrated.';
    }
    if (tasteProfile === 'bitter') {
      return 'Shot is in range but tastes bitter — grind coarser (higher dial number). Auto step size is not calibrated.';
    }
    if (tasteProfile === 'very_bitter') {
      return 'Shot is in range but tastes very bitter — grind coarser (higher dial number). Auto step size is not calibrated.';
    }
    return 'KEEP GRIND — Balanced and in range.';
  }
  const secOff = Math.abs(Math.round(timeDelta));
  if (timeDelta < 0) {
    return `Shot was ${secOff}s fast — consider grinding finer (lower dial number). Timing guidance only; dial steps are not auto-calibrated.`;
  }
  return `Shot was ${secOff}s slow — consider grinding coarser (higher dial number). Timing guidance only; dial steps are not auto-calibrated.`;
}

export function calculateRecommendation(shotData, recipe, recentShots = [], flairEnabled = false, options = {}) {
  const settings = options.settings ?? null;
  const learningRecentShots = recentShots.filter(
    (s) => shotEligibleForLearning(s) && shotMatchesGrinderForLearning(s, shotData.grinderModel)
  );
  const {
    grinderModel,
    setteMacro,
    setteMicro,
    sunbeamSetting,
    nicheZeroSetting,
    customGrindValue,
    wasPurged,
    actualTime,
    actualYield,
    tasteProfile: rawTasteProfile,
    lastShotGrind,
    recommendationFollowed = null,
    previousShot = null,
  } = shotData;
  const tasteProfile = normalizeTasteProfile(rawTasteProfile);

  const targetMin = recipe.targetTimeMinS || 27;
  const targetMax = recipe.targetTimeMaxS || 32;
  const targetMid = (targetMin + targetMax) / 2;
  const targetYield = recipe.targetYieldG || 36;
  const timeDelta = actualTime - targetMid;

  const isTimeInRange = actualTime >= targetMin && actualTime <= targetMax;
  const isBitter = tasteProfile === 'bitter' || tasteProfile === 'very_bitter';
  const isSour = tasteProfile === 'sour' || tasteProfile === 'very_sour';

  let shift = 0;
  let reason = '';
  let warning = null;
  let effectiveSensitivity = null;

  if (
    lastShotGrind
    && JSON.stringify(lastShotGrind)
      !== JSON.stringify({ setteMacro, setteMicro, sunbeamSetting, nicheZeroSetting, customGrindValue })
    && !wasPurged
  ) {
    warning = "⚠️ Unpurged setting change detected. Retention may have skewed flow.";
  }

  if (recommendationFollowed === false) {
    const improved = shotResultImproved(previousShot, shotData, recipe);
    if (!improved) {
      warning = warning
        ? `${warning} Previous grind recommendation was not followed and the result did not clearly improve.`
        : 'Previous grind recommendation was not followed and the result did not clearly improve.';
    }
  }

  const yieldDelta = actualYield - targetYield;
  const severeChoke = shotIsSevereChoke(actualTime, actualYield, targetMin, targetMax, targetYield);
  if (isTimeInRange && Math.abs(yieldDelta) >= MATERIAL_YIELD_DELTA_G) {
    if (yieldDelta < 0) {
      warning = warning ? warning + " Shot hit target time but under-yielded." : "Shot hit target time but under-yielded (restricted flow).";
    } else {
      warning = warning ? warning + " Shot hit target time but over-yielded." : "Shot hit target time but over-yielded (high flow / channeling).";
    }
  } else if (!isTimeInRange && !severeChoke && Math.abs(yieldDelta) >= MATERIAL_YIELD_DELTA_G) {
    const outsideYieldWarning = "Shot was far outside the target time and yield. Check that the shot was stopped at the intended yield and puck preparation was normal before relying heavily on this result.";
    warning = warning ? `${warning} ${outsideYieldWarning}` : outsideYieldWarning;
  }

  if (timeDelta < 0 && isBitter) {
    warning = (warning ? warning + " " : "") + "Shot ran fast but tasted bitter. Uneven extraction likely. Check puck prep before large grind changes.";
  }

  const grinderProfile = getRecommendationGrinderProfile(grinderModel, settings);
  effectiveSensitivity = grinderProfile.sensitivity;

  if (!grinderSupportsQuantitativeRecommendations(grinderModel, settings)) {
    const currentDial = parseNicheZeroSetting(nicheZeroSetting) ?? NICHE_ZERO_DEFAULT_SETTING;

    const comparableHistory = [...learningRecentShots]
      .filter((s) => shotMatchesRecipeContext(s, recipe, flairEnabled))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const comparableForLearning = filterComparableShotsForNicheLearning(
      comparableHistory,
      recipe,
      grinderModel
    );

    const currentGrindNumeric = parseNicheZeroSetting(nicheZeroSetting) ?? currentDial;
    const outlierCheck = detectLikelyShotOutlier({
      actualTime,
      grindNumeric: currentGrindNumeric,
      recipe,
      comparableShots: shotsForOutlierContext(learningRecentShots, comparableHistory),
      grinderProfile,
    });

    const empiricalInput = {
      currentDial,
      actualTime,
      targetMin,
      targetMax,
      tasteProfile,
      severeChoke,
      isTimeInRange,
      comparableShots: comparableForLearning,
      currentObservation: outlierCheck.isOutlier
        ? null
        : {
            nicheZeroSetting: currentDial,
            actualTimeS: actualTime,
          },
    };
    const empirical = recommendNicheZeroFromEvidence(empiricalInput);

    const eligibilityShotPool = shotsForNicheEligibilityDiagnosis(recentShots, shotData, recipe, options);
    const beanIdForEligibility =
      shotData.beanId ?? learningRecentShots[0]?.beanId ?? eligibilityShotPool[0]?.beanId ?? null;
    const nicheEligibility = diagnoseNicheLearningEligibility({
      shots: eligibilityShotPool,
      beanId: beanIdForEligibility,
      grinderModel,
      recipe,
      flairEnabled,
      currentObservation: {
        nicheZeroSetting: currentDial,
        actualTimeS: actualTime,
      },
    });

    let recommendedDial = currentDial;
    let shift = 0;
    let reason;
    let nicheEvidenceMode = 'qualitative-fallback';
    let nicheEmpiricalReasonCode = empirical.ok ? null : empirical.reasonCode;
    let nicheLearningNote = null;
    let nicheEmpiricalValidationNote = null;

    const attachLearningNote = () => {
      if (empirical.ok) return;
      nicheLearningNote = buildNicheEligibilityLearningNote(
        nicheEligibility,
        empirical.reasonCode,
        {
          recipeComparableCount: nicheEligibility.counts.recipeMatched,
          grinderLearningShotCount: nicheEligibility.counts.grinderMatched,
        }
      );
    };

    const { confidence: nicheStepConfidence } = sensitivityConfidenceForQuantitativeGrinder(
      comparableForLearning,
      grinderModel,
      recipe,
      settings
    );

    if (empirical.ok) {
      recommendedDial = empirical.recommendedDial;
      let rawShift = empirical.shift ?? recommendedDial - currentDial;
      if (!empirical.keepGrind && rawShift !== 0) {
        rawShift = dampQuantitativeShift(rawShift, nicheStepConfidence, {
          isOutlier: outlierCheck.isOutlier,
          holdOutlier: outlierCheck.holdGrind === true,
        });
        recommendedDial = Math.round(Math.min(NICHE_ZERO_DIAL_MAX, Math.max(NICHE_ZERO_DIAL_MIN, currentDial + rawShift)) * 10) / 10;
        shift = Math.round((recommendedDial - currentDial) * 10) / 10;
      } else {
        shift = rawShift;
      }
      nicheEvidenceMode = 'empirical';
      nicheEmpiricalValidationNote = NICHE_EMPIRICAL_VALIDATION_NOTE;
      reason = buildNicheEmpiricalReason({
        currentDial,
        recommendedDial,
        shift,
        secondsPerMark: empirical.secondsPerMark,
        keepGrind: empirical.keepGrind || shift === 0,
      });
      if (outlierCheck.isOutlier) {
        reason = buildOutlierRecommendationReason({
          baseReason: shift === 0 ? 'KEEP GRIND — Balanced and in range.' : reason,
          outlierDetail: outlierCheck.detail,
        });
        if (shift === 0) {
          recommendedDial = currentDial;
          nicheEvidenceMode = empirical.keepGrind ? nicheEvidenceMode : 'qualitative-fallback';
        }
      }
      if (empirical.secondsPerMark) effectiveSensitivity = empirical.secondsPerMark;
    } else {
      const canUseTimingBounded = !TIMING_BOUNDED_UNRELIABLE_CODES.has(empirical.reasonCode);
      const timingBounded = canUseTimingBounded
        ? recommendNicheTimingBounded({
            currentDial,
            actualTime,
            targetMin,
            targetMax,
            tasteProfile,
            severeChoke,
            isTimeInRange,
          })
        : { ok: false };

      let usedTimingBounded = false;
      if (timingBounded.ok) {
        shift = dampQuantitativeShift(timingBounded.shift, nicheStepConfidence, {
          isOutlier: outlierCheck.isOutlier,
          holdOutlier: outlierCheck.holdGrind === true,
        });
        recommendedDial = Math.round(Math.min(NICHE_ZERO_DIAL_MAX, Math.max(NICHE_ZERO_DIAL_MIN, currentDial + shift)) * 10) / 10;
        shift = Math.round((recommendedDial - currentDial) * 10) / 10;
        if (shift !== 0) {
          usedTimingBounded = true;
          nicheEvidenceMode = 'timing-bounded';
          attachLearningNote();
          reason = buildNicheTimingBoundedReason({
            recommendedDial,
            shift,
            empiricalUnavailable: true,
          });
          if (outlierCheck.isOutlier) {
            reason = buildOutlierRecommendationReason({ baseReason: reason, outlierDetail: outlierCheck.detail });
          }
        }
      }
      if (!usedTimingBounded) {
        attachLearningNote();
        reason = buildNicheFallbackReason({
          severeChoke,
          isTimeInRange,
          tasteProfile,
          timeDelta,
          reasonCode: empirical.reasonCode,
        });
        if (!reason) {
          reason = buildNicheZeroQualitativeReason({
            severeChoke,
            isTimeInRange,
            tasteProfile,
            timeDelta,
          });
        }
        if (outlierCheck.isOutlier) {
          reason = buildOutlierRecommendationReason({
            baseReason: reason || 'KEEP GRIND — Balanced and in range.',
            outlierDetail: outlierCheck.detail,
          });
        }
      }
    }

    let flairWaterTempAdvice = null;
    const currentTemp = recipe.brewTemperatureC;
    const currentOutcome = classifyShotOutcome(
      { actualTimeS: actualTime, actualYieldG: actualYield, tasteProfile, targetTimeMinS: targetMin, targetTimeMaxS: targetMax },
      recipe
    );

    if (isTimeInRange && currentTemp && (isSour || isBitter) && !currentOutcome.isDialledIn) {
      const qualifyingHistory = learningRecentShots.filter((s) => {
        const ctx = recipeContextForShot(s, recipe);
        const outcome = classifyShotOutcome(s, ctx);
        if (!outcome.isTimeInRange || outcome.isDialledIn) return false;
        if (!shotMatchesRecipeContext(s, recipe, flairEnabled)) return false;
        const temp = s.brewTemperatureC || (s.flairProfile && s.flairProfile.waterTempC);
        if (!temp || temp !== currentTemp) return false;
        if (!s.tasteProfile) return false;
        return true;
      });
      const allQualifying = [{ tasteProfile }, ...qualifyingHistory.map((s) => ({ tasteProfile: s.tasteProfile }))];
      if (allQualifying.length >= 3) {
        const recent3 = allQualifying.slice(0, 3);
        const allSour = recent3.every((s) => s.tasteProfile === 'sour' || s.tasteProfile === 'very_sour');
        const allBitter = recent3.every((s) => s.tasteProfile === 'bitter' || s.tasteProfile === 'very_bitter');
        if (allSour) {
          flairWaterTempAdvice =
            'Persistent sourness despite shots in target time — consider increasing Flair temperature 1–2°C.';
        } else if (allBitter) {
          flairWaterTempAdvice =
            'Persistent bitterness despite shots in target time — consider decreasing Flair temperature 1–2°C.';
        }
      }
    }

    let subRecommendation = null;
    if (isTimeInRange) {
      const dialedInRecentShots = learningRecentShots.filter(s => s.actualTimeS >= targetMin && s.actualTimeS <= targetMax);
      const dialedInBitterCount = dialedInRecentShots.filter(s => s.tasteProfile === 'bitter' || s.tasteProfile === 'very_bitter').length;
      const dialedInSourCount = dialedInRecentShots.filter(s => s.tasteProfile === 'sour' || s.tasteProfile === 'very_sour').length;
      const totalDialedInBitter = dialedInBitterCount + (isBitter ? 1 : 0);
      const totalDialedInSour = dialedInSourCount + (isSour ? 1 : 0);
      const safeDoseG = recipe.targetDoseG || 18;
      if (totalDialedInBitter >= 2 && targetYield / safeDoseG <= 2.0) {
        subRecommendation = "Ratio Advisory: Time is dialed in with persistent bitterness. Consider lengthening your ratio.";
      } else if (totalDialedInSour >= 2) {
        subRecommendation = "Ratio Advisory: Time is dialed in with persistent sourness. Consider tightening your ratio or increasing brew temperature.";
      }
    }

    const evidenceContext = evidenceContextForRecommendation(
      recentShots,
      shotData,
      recipe,
      flairEnabled,
      options
    );
    const shotOutcome = classifyShotOutcome(
      { actualTimeS: actualTime, actualYieldG: actualYield, tasteProfile, targetTimeMinS: targetMin, targetTimeMaxS: targetMax },
      recipe
    );

    return {
      recommendedSetting: { nicheZeroSetting: recommendedDial },
      reason,
      warning,
      subRecommendation,
      flairWaterTempAdvice,
      evidenceContext,
      shotOutcome,
      nicheEvidenceMode,
      nicheEmpiricalReasonCode,
      nicheLearningNote,
      nicheEmpiricalValidationNote,
      nicheEligibility,
      engineStats: {
        timeDelta,
        yieldDelta,
        targetMid,
        targetYield,
        sensitivity: empirical.ok ? effectiveSensitivity : null,
        shift,
        shiftUnit: grinderProfile.shiftUnit,
        severeChoke: severeChoke,
        tasteOverride: isTimeInRange && !isBalancedTaste(tasteProfile),
      },
    };
  }

  if (severeChoke) {
    shift = severeChokeCoarseShift(grinderModel, targetMin, targetMax, settings);
    const absShift = Math.abs(shift);
    const chokeReason = "Severe choke detected — shot produced very little yield over an extended time. Go substantially coarser.";
    reason = `GO ${absShift} ${grinderProfile.chokeReasonStepLabel} COARSER — ${chokeReason}`;
  } else if (isTimeInRange) {
    if (tasteProfile === 'very_sour') {
      shift = grinderProfile.inRangeVerySourShift;
      reason = `GO ${Math.abs(shift)} STEP(S) FINER — Shot is in range but tastes very sour.`;
    } else if (tasteProfile === 'sour') {
      shift = -1;
      reason = `GO 1 STEP FINER — Shot is in range but tastes sour.`;
    } else if (tasteProfile === 'bitter') {
      shift = 1;
      reason = `GO 1 STEP COARSER — Shot is in range but tastes bitter.`;
    } else if (tasteProfile === 'very_bitter') {
      shift = grinderProfile.inRangeVeryBitterShift;
      reason = `GO ${Math.abs(shift)} STEP(S) COARSER — Shot is in range but tastes very bitter.`;
    } else {
      reason = "KEEP GRIND — Balanced and in range.";
    }
  } else {
    const comparableHistory = [...learningRecentShots]
      .filter((s) => shotMatchesRecipeContext(s, recipe, flairEnabled))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const { secondsPerStep, confidence } = sensitivityConfidenceForQuantitativeGrinder(
      comparableHistory,
      grinderModel,
      recipe,
      settings
    );
    effectiveSensitivity = secondsPerStep || grinderProfile.sensitivity;
    const sensitivity = effectiveSensitivity;
    const rawShift = Math.round(timeDelta / sensitivity);
    const signedRaw = rawShift === 0 ? (timeDelta < 0 ? -1 : 1) : rawShift;

    const currentGrindNumeric = grindNumericFromShotData(shotData, grinderProfile);
    const outlierCheck = detectLikelyShotOutlier({
      actualTime,
      grindNumeric: currentGrindNumeric,
      recipe,
      comparableShots: shotsForOutlierContext(learningRecentShots, comparableHistory),
      grinderProfile,
    });

    shift = dampQuantitativeShift(signedRaw, confidence, {
      isOutlier: outlierCheck.isOutlier,
      holdOutlier: outlierCheck.holdGrind === true,
    });

    const absShift = Math.abs(shift);
    const direction = shift < 0 ? "FINER" : "COARSER";
    const secOff = Math.abs(Math.round(timeDelta));

    if (shift === 0 && outlierCheck.isOutlier) {
      reason = buildOutlierRecommendationReason({
        baseReason: 'KEEP GRIND — Balanced and in range.',
        outlierDetail: outlierCheck.detail,
      });
    } else if (shift === 0) {
      reason = 'KEEP GRIND — Shot time was off target but grind step is capped until more comparable shots are logged.';
    } else {
      reason = `GO ${absShift} ${grinderProfile.timeOffTargetStepLabel} ${direction} — Shot was ${secOff}s off target midpoint.`;
      if (outlierCheck.isOutlier) {
        reason = buildOutlierRecommendationReason({ baseReason: reason, outlierDetail: outlierCheck.detail });
      }
    }
    if (outlierCheck.isOutlier) {
      warning = warning
        ? `${warning} ${KNOWN_ISSUE_OUTLIER_HINT}`
        : KNOWN_ISSUE_OUTLIER_HINT;
    }
  }

  let flairWaterTempAdvice = null;
  const currentTemp = recipe.brewTemperatureC;
  const currentFlairProfile = flairEnabled ? recipe.flairProfile : null;

  const currentOutcome = classifyShotOutcome(
    { actualTimeS: actualTime, actualYieldG: actualYield, tasteProfile, targetTimeMinS: targetMin, targetTimeMaxS: targetMax },
    recipe
  );

  if (isTimeInRange && currentTemp && (isSour || isBitter) && !currentOutcome.isDialledIn) {
    const qualifyingHistory = learningRecentShots.filter((s) => {
      const ctx = recipeContextForShot(s, recipe);
      const outcome = classifyShotOutcome(s, ctx);
      if (!outcome.isTimeInRange || outcome.isDialledIn) return false;
      if (!shotMatchesRecipeContext(s, recipe, flairEnabled)) return false;

      const temp = s.brewTemperatureC || (s.flairProfile && s.flairProfile.waterTempC);
      if (!temp || temp !== currentTemp) return false;

      if (!s.tasteProfile) return false;
      return true;
    });

    const allQualifying = [{ tasteProfile }, ...qualifyingHistory.map((s) => ({ tasteProfile: s.tasteProfile }))];

    if (allQualifying.length >= 3) {
      const recent3 = allQualifying.slice(0, 3);
      const allSour = recent3.every((s) => s.tasteProfile === 'sour' || s.tasteProfile === 'very_sour');
      const allBitter = recent3.every((s) => s.tasteProfile === 'bitter' || s.tasteProfile === 'very_bitter');

      if (allSour) {
        flairWaterTempAdvice =
          'Persistent sourness despite shots in target time — consider increasing Flair temperature 1–2°C.';
      } else if (allBitter) {
        flairWaterTempAdvice =
          'Persistent bitterness despite shots in target time — consider decreasing Flair temperature 1–2°C.';
      }
    }
  }

  let subRecommendation = null;
  if (isTimeInRange) {
    const dialedInRecentShots = learningRecentShots.filter(s => s.actualTimeS >= targetMin && s.actualTimeS <= targetMax);
    const dialedInBitterCount = dialedInRecentShots.filter(s => s.tasteProfile === 'bitter' || s.tasteProfile === 'very_bitter').length;
    const dialedInSourCount = dialedInRecentShots.filter(s => s.tasteProfile === 'sour' || s.tasteProfile === 'very_sour').length;

    const totalDialedInBitter = dialedInBitterCount + (isBitter ? 1 : 0);
    const totalDialedInSour = dialedInSourCount + (isSour ? 1 : 0);

    const safeDoseG = recipe.targetDoseG || 18;
    if (totalDialedInBitter >= 2 && targetYield / safeDoseG <= 2.0) {
      subRecommendation = "Ratio Advisory: Time is dialed in with persistent bitterness. Consider lengthening your ratio.";
    } else if (totalDialedInSour >= 2) {
      subRecommendation = "Ratio Advisory: Time is dialed in with persistent sourness. Consider tightening your ratio or increasing brew temperature.";
    }
  }

  const recommendedSetting = grinderProfile.adjustSetting(shift, {
    setteMacro,
    setteMicro,
    sunbeamSetting,
    customGrindValue,
  });

  const evidenceContext = evidenceContextForRecommendation(
    recentShots,
    shotData,
    recipe,
    flairEnabled,
    options
  );
  const shotOutcome = classifyShotOutcome(
    { actualTimeS: actualTime, actualYieldG: actualYield, tasteProfile, targetTimeMinS: targetMin, targetTimeMaxS: targetMax },
    recipe
  );

  const shiftUnit = grinderProfile.shiftUnit;

  return {
    recommendedSetting,
    reason: prefixEstimatedGrindReason(reason, grinderProfile),
    warning,
    subRecommendation,
    flairWaterTempAdvice,
    evidenceContext,
    shotOutcome,
    engineStats: {
      timeDelta,
      yieldDelta,
      targetMid,
      targetYield,
      sensitivity: effectiveSensitivity,
      shift,
      shiftUnit,
      severeChoke: severeChoke,
      tasteOverride: isTimeInRange && !isBalancedTaste(tasteProfile),
    },
  };
}

/** Diagnostics for shot history "Stats for Nerds" — safe for legacy shots missing engineStats. */
export function getShotEngineStats(shot, recipe = {}) {
  const rec = shot?.recommendation;
  const stored = rec?.engineStats;
  const ctx = recipeContextForShot(shot, recipe);
  const actualTime = Number(shot?.actualTimeS ?? shot?.actualTime ?? 0);
  const actualYield = Number(shot?.actualYieldG ?? shot?.actualYield ?? 0);
  const targetMin = ctx.targetTimeMinS;
  const targetMax = ctx.targetTimeMaxS;
  const targetMid = stored?.targetMid ?? (targetMin + targetMax) / 2;
  const targetYield = stored?.targetYield ?? ctx.targetYieldG ?? 36;
  const grinderModel = resolveShotStatsGrinderModel(shot?.grinderModel);
  const statsProfile = getShotStatsGrinderProfile(grinderModel);
  const sensitivity = stored?.sensitivity ?? statsProfile.sensitivity;
  const timeDelta = stored?.timeDelta ?? actualTime - targetMid;
  const yieldDelta = stored?.yieldDelta ?? actualYield - targetYield;
  const shift = stored?.shift ?? null;
  const shiftUnit = stored?.shiftUnit ?? statsProfile.shiftUnit;

  let shiftSummary = rec?.reason || null;
  if (shift !== null && shift !== 0) {
    const abs = Math.abs(shift);
    const dir = shift < 0 ? 'finer' : 'coarser';
    const stepLabel = shiftUnit === 'micro' ? 'micro step(s)' : 'setting(s)';
    shiftSummary = `${shift > 0 ? '+' : '-'}${abs} ${stepLabel} ${dir}${rec?.reason ? ` — ${rec.reason}` : ''}`;
  } else if (shift === 0 && rec?.reason) {
    shiftSummary = rec.reason;
  }

  const beanAgeDays = shot?.beanAgeDays;
  let ageOffsetNote = null;
  if (beanAgeDays !== undefined && beanAgeDays !== null) {
    const { offsetSette, offsetSunbeam } = freshnessOffsetsForEffectiveDays(beanAgeDays);
    const offsetSteps = isSetteGrinderModel(grinderModel) ? offsetSette : offsetSunbeam;
    if (offsetSteps !== 0) {
      ageOffsetNote = `Effective age ${beanAgeDays}d → freshness offset ${offsetSteps > 0 ? '+' : ''}${offsetSteps} ${shiftUnit} step(s) on starting grind only`;
    } else {
      ageOffsetNote = `Effective age ${beanAgeDays}d — no freshness grind offset at log time`;
    }
  }

  return {
    timeDelta,
    yieldDelta,
    targetMid,
    targetYield,
    sensitivity,
    shift,
    shiftUnit,
    shiftSummary: shiftSummary || 'No recommendation recorded for this shot.',
    ageOffsetNote,
    evidenceContext: rec?.evidenceContext || null,
    warning: rec?.warning || null,
    severeChoke: stored?.severeChoke ?? false,
    tasteOverride: stored?.tasteOverride ?? false,
  };
}