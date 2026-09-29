import Dexie from 'dexie';

export const db = new Dexie('EspressoDialDB');

// Bumped to version 17 to accommodate persisted current grind settings
db.version(17).stores({
  beans: 'id, name, roaster, roastDate, storageType, postThawStorage, freezeDate, thawDate, rating, isFinished, createdAt',
  recipes: 'id, beanId, targetDoseG, targetYieldG, targetTimeMinS, targetTimeMaxS',
  shots: 'id, beanId, timestamp, grinderModel, setteMacro, setteMicro, sunbeamSetting',
  // settings row also stores darkMode and Brew Guide config (UI only); no schema bump — Dexie keeps existing shot/bean data at v17
  settings: 'id, grinderModel, flairEnabled, preInfusionEnabled, lastSetteMacro, lastSetteMicro, lastSunbeamSetting'
});

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
  const hasYieldIssue = isTimeInRange && Math.abs(yieldDelta) >= 3.5;

  const isDialledIn = isTimeInRange && isGoodTaste && !hasYieldIssue;

  let statusLabel = null;
  if (isDialledIn) statusLabel = 'DIALLED IN';
  else if (isTimeInRange) statusLabel = 'IN RANGE';

  return {
    isDialledIn,
    isTimeInRange,
    isNegativeTaste,
    hasYieldIssue,
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
  const sorted = [...recentShots].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const comparable = sorted.filter((s) => shotMatchesRecipeContext(s, recipe, flairEnabled));
  if (comparable.length === 0) return null;
  const count = Math.min(comparable.length, 3);
  if (count >= 2) return `Based on ${count} recent shots with this recipe`;
  return 'Based on recent shots with this recipe';
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

  let offsetSette = 0;
  let offsetSunbeam = 0;
  if (effectiveDays <= 3) { offsetSette = -3; offsetSunbeam = -2; }
  else if (effectiveDays <= 7) { offsetSette = -2; offsetSunbeam = -1; }
  else if (effectiveDays <= 14) { offsetSette = -1; offsetSunbeam = 0; }
  else if (effectiveDays <= 30) { offsetSette = 0; offsetSunbeam = 0; }
  else if (effectiveDays <= 45) { offsetSette = 1; offsetSunbeam = 1; }
  else if (effectiveDays <= 60) { offsetSette = 2; offsetSunbeam = 1; }
  else { offsetSette = 3; offsetSunbeam = 2; }

  const storageLabels = { frozen: 'Frozen Storage', vacuum: 'Vacuum Sealed Bag', bag: 'Standard Bag' };
  let notice = `(${storageLabels[storageType] || 'Standard'} • ${bean.roastType} Roast) Effective age: ${effectiveDays} days.`;

  return { daysOld: effectiveDays, recommendedOffsetSette: offsetSette, recommendedOffsetSunbeam: offsetSunbeam, notice };
}

export function getHistoricalRoastBaseline(grinderModel, roastType, recipes = [], allShots = [], beans = []) {
  const successfulShots = allShots.filter(s => {
    if (s.grinderModel !== grinderModel) return false;
    const bean = beans.find(b => b.id === s.beanId);
    if (!bean || bean.roastType !== roastType) return false;
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
  const beanShots = allShots.filter(s => s.beanId === activeBean?.id && s.grinderModel === grinderModel);
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
  const baseline = getHistoricalRoastBaseline(grinderModel, roastType, recipes, allShots, beans);

  if (grinderModel === 'Sette 270Wi') {
    let baseNumeric = baseline !== null ? baseline : (roastType === 'Light' ? 15 * 9 + 2 : roastType === 'Dark' ? 12 * 9 + 5 : 13 * 9 + 4);
    return numericToSette(baseNumeric + ageData.recommendedOffsetSette);
  } else {
    let baseSetting = baseline !== null ? baseline : (roastType === 'Light' ? 17 : roastType === 'Dark' ? 13 : 15);
    return { setting: Math.min(Math.max(baseSetting + ageData.recommendedOffsetSunbeam, 1), 30) };
  }
}

export function calculateRecommendation(shotData, recipe, recentShots = [], flairEnabled = false) {
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
  if (isTimeInRange && Math.abs(yieldDelta) >= 3.5) {
    if (yieldDelta < 0) {
      warning = warning ? warning + " Shot hit target time but under-yielded." : "Shot hit target time but under-yielded (restricted flow).";
    } else {
      warning = warning ? warning + " Shot hit target time but over-yielded." : "Shot hit target time but over-yielded (high flow / channeling).";
    }
  }

  if (timeDelta < 0 && isBitter) {
    warning = (warning ? warning + " " : "") + "Shot ran fast but tasted bitter. Uneven extraction likely. Check puck prep before large grind changes.";
  }

  if (isTimeInRange) {
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
    const qualifyingHistory = recentShots.filter((s) => {
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
    const dialedInRecentShots = recentShots.filter(s => s.actualTimeS >= targetMin && s.actualTimeS <= targetMax);
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

  const sortedRecent = [...recentShots].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const evidenceContext = getRecommendationEvidenceContext(sortedRecent, recipe, flairEnabled);
  const shotOutcome = classifyShotOutcome(
    { actualTimeS: actualTime, actualYieldG: actualYield, tasteProfile, targetTimeMinS: targetMin, targetTimeMaxS: targetMax },
    recipe
  );

  return {
    recommendedSetting,
    reason,
    warning,
    subRecommendation,
    flairWaterTempAdvice,
    evidenceContext,
    shotOutcome,
  };
}