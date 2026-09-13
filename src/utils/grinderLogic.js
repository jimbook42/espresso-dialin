import Dexie from 'dexie';

export const db = new Dexie('EspressoDialDB');

// Bumped to version 17 to accommodate persisted current grind settings
db.version(17).stores({
  beans: 'id, name, roaster, roastDate, storageType, postThawStorage, freezeDate, thawDate, rating, isFinished, createdAt',
  recipes: 'id, beanId, targetDoseG, targetYieldG, targetTimeMinS, targetTimeMaxS',
  shots: 'id, beanId, timestamp, grinderModel, setteMacro, setteMicro, sunbeamSetting',
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

    const isTimeInRange = s.actualTimeS >= recipe.targetTimeMinS && s.actualTimeS <= recipe.targetTimeMaxS;
    const isTasteGood = s.tasteProfile === 'good' || s.tasteProfile === 'balanced';
    const wasFollowed = s.recommendationFollowed !== false;
    
    return isTimeInRange && isTasteGood && wasFollowed;
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
    flairWaterTempAdvice: lastShot.recommendation.flairWaterTempAdvice
  };
}

export function getInitialGrindRecommendation(grinderModel, roastType, activeBean, recipes = [], allShots = [], beans = [], mockDateOverride = null) {
  const beanShots = allShots.filter(s => s.beanId === activeBean?.id && s.grinderModel === grinderModel);
  
  if (beanShots.length > 0) {
    const lastBeanShot = beanShots[0];
    const adjustedRec = getAgeAdjustedRecommendation(lastBeanShot, activeBean, mockDateOverride);
    
    if (adjustedRec && adjustedRec.recommendedSetting) {
      if (grinderModel === 'Sette 270Wi') {
        return { macro: adjustedRec.recommendedSetting.macro, micro: adjustedRec.recommendedSetting.micro };
      } else {
        return { setting: adjustedRec.recommendedSetting.setting };
      }
    } else {
      if (grinderModel === 'Sette 270Wi') {
        return { macro: lastBeanShot.setteMacro || 13, micro: lastBeanShot.setteMicro || 'E' };
      } else {
        return { setting: lastBeanShot.sunbeamSetting || 15 };
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
    recommendationFollowed = true
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
    warning = warning ? warning + " ⚠️ Previous grind recommendation was not followed." : "⚠️ Previous grind recommendation was not followed.";
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
      reason = "Shot is in range but tastes very sour. Go slightly finer.";
    } else if (tasteProfile === 'sour') {
      shift = -1;
      reason = "Shot is in range but tastes sour. Go slightly finer.";
    } else if (tasteProfile === 'bitter') {
      shift = 1;
      reason = "Shot is in range but tastes bitter. Go slightly coarser.";
    } else if (tasteProfile === 'very_bitter') {
      shift = grinderModel === 'Sette 270Wi' ? 2 : 1;
      reason = "Shot is in range but tastes very bitter. Go slightly coarser.";
    } else {
      reason = "Balanced and in range. Keep this setting.";
    }
  } else {
    const sensitivity = grinderModel === 'Sette 270Wi' ? 1.25 : 4.5;
    shift = Math.round(timeDelta / sensitivity);
    if (shift === 0) shift = timeDelta < 0 ? -1 : 1;

    const absShift = Math.abs(shift);
    const direction = shift < 0 ? "finer" : "coarser";
    const secOff = Math.abs(Math.round(timeDelta));

    if (grinderModel === 'Sette 270Wi') {
      let sizeDesc = absShift >= 16 ? "Very large" : absShift >= 10 ? "Large" : absShift >= 6 ? "Moderate" : absShift >= 3 ? "Small" : "Very small";
      reason = `${sizeDesc} adjustment — shot was ${secOff}s off target midpoint. Go ${absShift} micro steps ${direction}.`;
    } else {
      reason = `Shot was ${secOff}s off target midpoint. Go ${absShift} setting(s) ${direction}.`;
    }
  }

  let flairWaterTempAdvice = null;
  if (flairEnabled && isTimeInRange) {
    if (isSour) flairWaterTempAdvice = "Flair Temperature Advisory: Time is dialed in but flavor is sour. Increase brew water by 1-2°C.";
    if (isBitter) flairWaterTempAdvice = "Flair Temperature Advisory: Time is dialed in but flavor is bitter. Decrease brew water by 1-2°C.";
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

  return { recommendedSetting, reason, warning, subRecommendation, flairWaterTempAdvice };
}