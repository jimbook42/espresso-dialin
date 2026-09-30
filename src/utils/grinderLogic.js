import Dexie from 'dexie';

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

const SETTE_MICROS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

export function setteToNumeric(macro, micro) {
  const macroVal = parseInt(macro, 10) || 13;
  const microIdx = SETTE_MICROS.indexOf(micro);
  // (Macro - 1) gives us a 0-based index so 1A starts at 0.
  return (macroVal - 1) * 9 + (microIdx !== -1 ? microIdx : 4);
}

export function numericToSette(num) {
  // Clamp between 0 (1A) and 278 (31I)
  const clamped = Math.min(Math.max(Math.round(num), 0), (31 - 1) * 9 + 8);
  const macro = Math.floor(clamped / 9) + 1;
  const microIdx = clamped % 9;
  return { macro, micro: SETTE_MICROS[microIdx] };
}

export function adjustSette(macro, microLetter, letterShift) {
  const numeric = setteToNumeric(macro, microLetter) + letterShift;
  return numericToSette(numeric);
}

export function adjustSunbeam(currentSetting, stepShift) {
  const setting = parseInt(currentSetting, 10);
  return Math.min(Math.max(setting + stepShift, 1), 30);
}

/** Recipe + optional Flair context for evidence (current recipe targets). */
export function shotMatchesRecipeContext(shot, recipe, flairEnabled = false) {
  const targetDose = recipe?.targetDoseG ?? 18;
  const targetYield = recipe?.targetYieldG ?? 36;
  if (Math.abs((shot.actualDoseG || 0) - targetDose) > 0.5) return false;
  if (Math.abs((shot.actualYieldG || 0) - targetYield) > 1.5) return false;

  if (!flairEnabled || !recipe?.flairProfile) return true;

  const p1 = shot.flairProfile || {};
  const p2 = recipe.flairProfile || {};
  if (p1.preinfusionPressure !== p2.preinfusionPressure) return false;
  if (p1.peakPressure !== p2.peakPressure) return false;
  if (p1.taperPressure !== p2.taperPressure) return false;
  if (p1.preinfusion !== p2.preinfusion) return false;
  return true;
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
function severeChokeCoarseShift(grinderModel, targetMin, targetMax) {
  const windowS = Math.max(targetMax - targetMin, 0);
  const cappedDelta = 1.5 * windowS;
  const sensitivity = grinderModel === 'Sette 270Wi' ? 1.25 : 4.5;
  const shift = Math.round(cappedDelta / sensitivity);
  return shift > 0 ? shift : 1;
}

/** Derived shot state for the active recipe context (not persisted). */
export function classifyShotOutcome(shot, recipe) {
  const ctx = recipeContextForShot(shot, recipe);
  const time = Number(shot.actualTimeS ?? shot.actualTime ?? 0);
  const yieldG = Number(shot.actualYieldG ?? shot.actualYield ?? 0);
  const taste = shot.tasteProfile;
  const targetMin = ctx.targetTimeMinS;
  const targetMax = ctx.targetTimeMaxS;
  const targetYield = ctx.targetYieldG ?? 36;

  const isTimeInRange = time >= targetMin && time <= targetMax;
  const isSour = taste === 'sour' || taste === 'very_sour';
  const isBitter = taste === 'bitter' || taste === 'very_bitter';
  const isNegativeTaste = isSour || isBitter;
  const isGoodTaste = taste === 'good' || taste === 'balanced';
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
      tasteProfile: currentShotData.tasteProfile,
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

export function getRecommendationEvidenceContext(recentShots, recipe, flairEnabled = false) {
  const sorted = [...recentShots]
    .filter(shotEligibleForLearning)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const comparable = sorted.filter((s) => shotMatchesRecipeContext(s, recipe, flairEnabled));
  if (comparable.length === 0) return null;
  const count = Math.min(comparable.length, 3);
  if (count >= 2) return `Based on ${count} recent shots with this recipe`;
  return 'Based on recent shots with this recipe';
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
    const num = grinderModel === 'Sette 270Wi' ? setteToNumeric(s.setteMacro, s.setteMicro) : s.sunbeamSetting;
    weightedSum += num * weight;
    totalWeight += weight;
  });
  return Math.round(weightedSum / totalWeight);
}

export function getAgeAdjustedRecommendation(lastShot, activeBean, mockDate = null) {
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

  if (lastShot.grinderModel === 'Sette 270Wi' && ageShiftSette !== 0) {
    adjustedSetting = adjustSette(adjustedSetting.macro, adjustedSetting.micro, ageShiftSette);
  } else if (lastShot.grinderModel === 'Sunbeam Barista Max' && ageShiftSunbeam !== 0) {
    adjustedSetting.setting = adjustSunbeam(adjustedSetting.setting, ageShiftSunbeam);
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

export function getInitialGrindRecommendation(grinderModel, roastType, activeBean, recipes = [], allShots = [], beans = [], mockDateOverride = null) {
  const beanShots = allShots.filter(
    (s) => s.beanId === activeBean?.id && s.grinderModel === grinderModel && shotEligibleForLearning(s)
  );
  const currentRecipe = recipes.find(r => r.beanId === activeBean?.id) || {};
  
  let bestShot = null;
  if (beanShots.length > 0) {
    const sortedBeanShots = [...beanShots].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const sameRecipeShots = sortedBeanShots.filter((s) => shotMatchesRecipeContext(s, currentRecipe, Boolean(currentRecipe.flairProfile)));

    const dialledInRecipeShots = sameRecipeShots.filter((s) =>
      classifyShotOutcome(s, recipeContextForShot(s, currentRecipe)).isDialledIn
    );

    if (dialledInRecipeShots.length > 0) bestShot = dialledInRecipeShots[0];
    else if (sameRecipeShots.length > 0) bestShot = sameRecipeShots[0];
    else bestShot = sortedBeanShots[0];
  }

  if (bestShot) {
    const adjustedRec = getAgeAdjustedRecommendation(bestShot, activeBean, mockDateOverride);
    
    if (adjustedRec && adjustedRec.recommendedSetting) {
      if (grinderModel === 'Sette 270Wi') {
        return { macro: adjustedRec.recommendedSetting.macro, micro: adjustedRec.recommendedSetting.micro };
      } else {
        return { setting: adjustedRec.recommendedSetting.setting };
      }
    } else {
      if (grinderModel === 'Sette 270Wi') {
        return { macro: bestShot.setteMacro || 13, micro: bestShot.setteMicro || 'E' };
      } else {
        return { setting: bestShot.sunbeamSetting || 15 };
      }
    }
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

  if (grinderModel === 'Sette 270Wi') {
    let baseNumeric = baseline !== null ? baseline : (roastType === 'Light' ? 15 * 9 + 2 : roastType === 'Dark' ? 12 * 9 + 5 : 13 * 9 + 4);
    return numericToSette(baseNumeric + ageData.recommendedOffsetSette);
  } else {
    let baseSetting = baseline !== null ? baseline : (roastType === 'Light' ? 17 : roastType === 'Dark' ? 13 : 15);
    return { setting: Math.min(Math.max(baseSetting + ageData.recommendedOffsetSunbeam, 1), 30) };
  }
}

export function calculateRecommendation(shotData, recipe, recentShots = [], flairEnabled = false) {
  const learningRecentShots = recentShots.filter(shotEligibleForLearning);
  const {
    grinderModel,
    setteMacro,
    setteMicro,
    sunbeamSetting,
    wasPurged,
    actualTime,
    actualYield,
    tasteProfile,
    lastShotGrind,
    recommendationFollowed = true,
    previousShot = null,
  } = shotData;

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

  if (lastShotGrind && JSON.stringify(lastShotGrind) !== JSON.stringify({ setteMacro, setteMicro, sunbeamSetting }) && !wasPurged) {
    warning = "⚠️ Unpurged setting change detected. Retention may have skewed flow.";
  }

  if (!recommendationFollowed) {
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

  if (severeChoke) {
    shift = severeChokeCoarseShift(grinderModel, targetMin, targetMax);
    const absShift = Math.abs(shift);
    const chokeReason = "Severe choke detected — shot produced very little yield over an extended time. Go substantially coarser.";
    if (grinderModel === 'Sette 270Wi') {
      reason = `GO ${absShift} MICRO STEP(S) COARSER — ${chokeReason}`;
    } else {
      reason = `GO ${absShift} SETTING(S) COARSER — ${chokeReason}`;
    }
  } else if (isTimeInRange) {
    if (tasteProfile === 'very_sour') {
      shift = grinderModel === 'Sette 270Wi' ? -2 : -1;
      reason = `GO ${Math.abs(shift)} STEP(S) FINER — Shot is in range but tastes very sour.`;
    } else if (tasteProfile === 'sour') {
      shift = -1;
      reason = `GO 1 STEP FINER — Shot is in range but tastes sour.`;
    } else if (tasteProfile === 'bitter') {
      shift = 1;
      reason = `GO 1 STEP COARSER — Shot is in range but tastes bitter.`;
    } else if (tasteProfile === 'very_bitter') {
      shift = grinderModel === 'Sette 270Wi' ? 2 : 1;
      reason = `GO ${Math.abs(shift)} STEP(S) COARSER — Shot is in range but tastes very bitter.`;
    } else {
      reason = "KEEP GRIND — Balanced and in range.";
    }
  } else {
    const sensitivity = grinderModel === 'Sette 270Wi' ? 1.25 : 4.5;
    shift = Math.round(timeDelta / sensitivity);
    if (shift === 0) shift = timeDelta < 0 ? -1 : 1;

    const absShift = Math.abs(shift);
    const direction = shift < 0 ? "FINER" : "COARSER";
    const secOff = Math.abs(Math.round(timeDelta));

    if (grinderModel === 'Sette 270Wi') {
      reason = `GO ${absShift} MICRO STEP(S) ${direction} — Shot was ${secOff}s off target midpoint.`;
    } else {
      reason = `GO ${absShift} SETTING(S) ${direction} — Shot was ${secOff}s off target midpoint.`;
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

  let recommendedSetting = {};
  if (grinderModel === 'Sette 270Wi') {
    recommendedSetting = adjustSette(setteMacro || 13, setteMicro || 'E', shift);
  } else {
    recommendedSetting = { setting: adjustSunbeam(sunbeamSetting || 15, shift) };
  }

  const sortedRecent = [...learningRecentShots].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const evidenceContext = getRecommendationEvidenceContext(sortedRecent, recipe, flairEnabled);
  const shotOutcome = classifyShotOutcome(
    { actualTimeS: actualTime, actualYieldG: actualYield, tasteProfile, targetTimeMinS: targetMin, targetTimeMaxS: targetMax },
    recipe
  );

  const sensitivity = grinderModel === 'Sette 270Wi' ? 1.25 : 4.5;
  const shiftUnit = grinderModel === 'Sette 270Wi' ? 'micro' : 'macro';

  return {
    recommendedSetting,
    reason,
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
      sensitivity,
      shift,
      shiftUnit,
      severeChoke: severeChoke,
      tasteOverride: isTimeInRange && tasteProfile !== 'good' && tasteProfile !== 'balanced',
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
  const grinderModel = shot?.grinderModel || 'Sette 270Wi';
  const sensitivity = stored?.sensitivity ?? (grinderModel === 'Sette 270Wi' ? 1.25 : 4.5);
  const timeDelta = stored?.timeDelta ?? actualTime - targetMid;
  const yieldDelta = stored?.yieldDelta ?? actualYield - targetYield;
  const shift = stored?.shift ?? null;
  const shiftUnit = stored?.shiftUnit ?? (grinderModel === 'Sette 270Wi' ? 'micro' : 'macro');

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
    const offsetSteps = grinderModel === 'Sette 270Wi' ? offsetSette : offsetSunbeam;
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