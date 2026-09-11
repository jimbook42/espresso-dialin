const SETTE_MICROS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

export function setteToNumeric(macro, micro) {
  const macroVal = parseInt(macro, 10) || 13;
  const microIdx = SETTE_MICROS.indexOf(micro);
  return macroVal * 9 + (microIdx !== -1 ? microIdx : 4);
}

export function numericToSette(num) {
  const clamped = Math.min(Math.max(Math.round(num), 9), 31 * 9 + 8);
  const macro = Math.floor(clamped / 9);
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

export function getGrindHistoryTrendOffset(grinderModel, allShots = [], recipes = [], beans = []) {
  const modelShots = allShots.filter(s => s.grinderModel === grinderModel);
  let totalDrift = 0;
  let count = 0;

  modelShots.forEach(s => {
    const recipe = recipes.find(r => r.beanId === s.beanId);
    const bean = beans.find(b => b.id === s.beanId);
    if (!recipe || !bean) return;

    const isSuccessful = s.actualTimeS >= recipe.targetTimeMinS && s.actualTimeS <= recipe.targetTimeMaxS;
    if (!isSuccessful) return;

    const roastType = bean.roastType || 'Medium';
    if (grinderModel === 'Sette 270Wi') {
      const standardMacro = roastType === 'Light' ? 15 : roastType === 'Dark' ? 12 : 13;
      const standardMicroIdx = roastType === 'Light' ? 2 : roastType === 'Dark' ? 5 : 4;
      const standardNumeric = standardMacro * 9 + standardMicroIdx;
      const actualNumeric = setteToNumeric(s.setteMacro, s.setteMicro);
      totalDrift += (actualNumeric - standardNumeric);
      count++;
    } else {
      const standardSetting = roastType === 'Light' ? 17 : roastType === 'Dark' ? 13 : 15;
      const actualSetting = s.sunbeamSetting || 15;
      totalDrift += (actualSetting - standardSetting);
      count++;
    }
  });

  if (count === 0) return 0;
  return (totalDrift / count) * 0.5;
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
  if (!bean || !bean.roastDate) return { daysOld: 0, recommendedOffset: 0, notice: '', isTooFresh: false, isStale: false };

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
        effectiveDays = ageAtFreeze;
      } else {
        const thawDate = new Date(bean.thawDate);
        const daysSinceThaw = Math.max(0, Math.floor((today - thawDate) / (1000 * 60 * 60 * 24)));
        const thawDecayMultiplier = postThawStorage === 'vacuum' ? 0.85 : 1.0;
        effectiveDays = ageAtFreeze + Math.floor(daysSinceThaw * thawDecayMultiplier);
      }
    }
  } else if (storageType === 'vacuum') {
    const rawDays = Math.max(0, Math.floor((today - roastDate) / (1000 * 60 * 60 * 24)));
    effectiveDays = Math.floor(rawDays * 0.85);
  } else {
    effectiveDays = Math.max(0, Math.floor((today - roastDate) / (1000 * 60 * 60 * 24)));
  }

  const freshThresholds = { Light: 10, Medium: 5, Dark: 3 };
  const minFresh = freshThresholds[bean.roastType] || 5;
  const isTooFresh = effectiveDays < minFresh;
  const isStale = effectiveDays > 35;

  let microStepOffset = 0;
  if (isTooFresh) {
    microStepOffset = -2;
  } else if (isStale) {
    const excessDays = Math.min(effectiveDays - 35, 300);
    microStepOffset = -Math.min(Math.round(excessDays * 0.05), 12);
  } else if (effectiveDays > 14) {
    microStepOffset = Math.floor((effectiveDays - 14) * 0.08);
  }

  const storageLabels = { frozen: 'Frozen Storage', vacuum: 'Vacuum Sealed Bag', bag: 'Standard Bag' };
  let notice = `(${storageLabels[storageType] || 'Standard'} • ${bean.roastType} Roast) Effective age: ${effectiveDays} days.`;
  if (isTooFresh) {
    notice += ` ⚠️ Too fresh / High CO₂: Expect erratic gushing. Grind slightly finer to compact resistance.`;
  } else if (isStale) {
    notice += ` ⚠️ Stale / Low Degassing: Lacks backpressure. Grind significantly finer to force extraction time.`;
  }

  return { daysOld: effectiveDays, recommendedOffset: microStepOffset, notice, isTooFresh, isStale };
}

export function getInitialGrindRecommendation(grinderModel, roastType, activeBean, recipes = [], allShots = [], beans = [], mockDate = null) {
  const trendOffset = getGrindHistoryTrendOffset(grinderModel, allShots, recipes, beans);
  const ageData = calculateEffectiveBeanAge(activeBean, mockDate);
  const beanAgeMicroOffset = ageData.recommendedOffset || 0;

  if (grinderModel === 'Sette 270Wi') {
    let baseMacro = roastType === 'Light' ? 15 : roastType === 'Dark' ? 12 : 13;
    let baseMicroIdx = roastType === 'Light' ? 2 : roastType === 'Dark' ? 5 : 4;
    let numeric = baseMacro * 9 + baseMicroIdx + Math.round(trendOffset) + beanAgeMicroOffset;
    return numericToSette(numeric);
  } else {
    let baseSetting = roastType === 'Light' ? 17 : roastType === 'Dark' ? 13 : 15;
    let setting = Math.round(baseSetting + trendOffset + (beanAgeMicroOffset * 0.3));
    return { setting: Math.min(Math.max(setting, 1), 30) };
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
    actualDose,
    actualYield,
    tasteProfile,
    lastShotGrind,
    daysSinceLastShot
  } = shotData;

  const targetMin = recipe.targetTimeMinS;
  const targetMax = recipe.targetTimeMaxS;
  const targetYield = recipe.targetYieldG;

  let warning = null;
  let retentionOffset = 0;

  if (lastShotGrind && JSON.stringify(lastShotGrind) !== JSON.stringify({ setteMacro, setteMicro, sunbeamSetting }) && !wasPurged) {
    warning = "⚠️ Unpurged setting change detected with residual grounds in the chute. Retention skewed flow speed.";
    retentionOffset = -1;
  }

  // Active Inactivity Adjustment (Fixes the dormant daysSinceLastShot math bug)
  let inactivityOffset = 0;
  if (daysSinceLastShot && daysSinceLastShot >= 3) {
    inactivityOffset = -Math.min(Math.floor(daysSinceLastShot / 3), 2);
  }

  // Yield & Flow Rate Sanity Check
  const yieldDelta = actualYield - targetYield;
  if (actualTime >= targetMin && actualTime <= targetMax && Math.abs(yieldDelta) >= 3.5) {
    if (yieldDelta < 0) {
      warning = warning ? warning + " ⚠️ Shot hit target time but under-yielded (restricted flow / puck choking)." : "⚠️ Shot hit target time but under-yielded (restricted flow / puck choking). Consider slightly coarser grind or lighter tamp.";
    } else {
      warning = warning ? warning + " ⚠️ Shot hit target time but over-yielded (high flow / channeling)." : "⚠️ Shot hit target time but over-yielded (high flow / channeling). Check puck prep and distribution.";
    }
  }

  let microShift = 0;
  let sunbeamShift = 0;
  let reason = '';

  const timeStr = `${actualTime}s extraction time`;
  const targetTimeStr = `target window of ${targetMin}–${targetMax}s`;
  const isTimeDialedIn = actualTime >= targetMin && actualTime <= targetMax;

  // Two-Stage Logic Matrix
  if (!isTimeDialedIn) {
    // Stage 1: Time/Velocity dominates when off-target
    if (actualTime < targetMin) {
      const diff = targetMin - actualTime;
      if (grinderModel === 'Sunbeam Barista Max') {
        if (diff <= 2) {
          sunbeamShift = 0;
          reason = `Your ${timeStr} is just ${diff}s faster than the ${targetTimeStr}. Recommendation: Keep grind setting and increase dose by +0.5g or tighten ratio.`;
        } else if (diff <= 5) {
          sunbeamShift = -1;
          reason = `Your ${timeStr} was ${diff}s faster than the ${targetTimeStr}. Making a 1-step finer adjustment.`;
        } else if (diff <= 10) {
          sunbeamShift = -2;
          reason = `Your ${timeStr} was ${diff}s faster than the ${targetTimeStr}. Making a 2-step finer adjustment.`;
        } else {
          sunbeamShift = -3;
          reason = `Your ${timeStr} was severely fast (${diff}s off target). Making a 3-step finer adjustment.`;
        }
      } else {
        if (diff === 1) {
          microShift = -1 + retentionOffset + inactivityOffset;
          reason = `Your ${timeStr} was 1s faster than the ${targetTimeStr}. Nudging 1 micro-step finer.`;
        } else if (diff >= 2 && diff <= 3) {
          microShift = -2 + retentionOffset + inactivityOffset;
          reason = `Your ${timeStr} was ${diff}s faster than the ${targetTimeStr}. Nudging 2 micro-steps finer.`;
        } else if (diff >= 4 && diff <= 6) {
          microShift = -3 + retentionOffset + inactivityOffset;
          reason = `Your ${timeStr} was ${diff}s faster than the ${targetTimeStr}. Adjusting 3 micro-steps finer.`;
        } else if (diff >= 7 && diff <= 10) {
          microShift = -5 + retentionOffset + inactivityOffset;
          reason = `Your ${timeStr} was ${diff}s faster than the ${targetTimeStr}. Adjusting 5 micro-steps finer.`;
        } else {
          microShift = -8 + retentionOffset + inactivityOffset;
          reason = `Your ${timeStr} was severely fast (${diff}s off target). Applying major finer correction.`;
        }
      }
    } else {
      const diff = actualTime - targetMax;
      if (grinderModel === 'Sunbeam Barista Max') {
        if (diff <= 2) {
          sunbeamShift = 0;
          reason = `Your ${timeStr} is just ${diff}s slower than the ${targetTimeStr}. Recommendation: Keep grind setting and decrease dose by -0.5g.`;
        } else if (diff <= 5) {
          sunbeamShift = 1;
          reason = `Your ${timeStr} was ${diff}s slower than the ${targetTimeStr}. Making a 1-step coarser adjustment.`;
        } else if (diff <= 10) {
          sunbeamShift = 2;
          reason = `Your ${timeStr} was ${diff}s slower than the ${targetTimeStr}. Making a 2-step coarser adjustment.`;
        } else {
          sunbeamShift = 3;
          reason = `Your ${timeStr} was severely slow (${diff}s off target). Making a 3-step coarser adjustment.`;
        }
      } else {
        if (diff === 1) {
          microShift = 1 + retentionOffset + inactivityOffset;
          reason = `Your ${timeStr} was 1s slower than the ${targetTimeStr}. Nudging 1 micro-step coarser.`;
        } else if (diff >= 2 && diff <= 3) {
          microShift = 2 + retentionOffset + inactivityOffset;
          reason = `Your ${timeStr} was ${diff}s slower than the ${targetTimeStr}. Nudging 2 micro-steps coarser.`;
        } else if (diff >= 4 && diff <= 6) {
          microShift = 3 + retentionOffset + inactivityOffset;
          reason = `Your ${timeStr} was ${diff}s slower than the ${targetTimeStr}. Adjusting 3 micro-steps coarser.`;
        } else if (diff >= 7 && diff <= 10) {
          microShift = 5 + retentionOffset + inactivityOffset;
          reason = `Your ${timeStr} was ${diff}s slower than the ${targetTimeStr}. Adjusting 5 micro-steps coarser.`;
        } else {
          microShift = 8 + retentionOffset + inactivityOffset;
          reason = `Your ${timeStr} was severely slow (${diff}s off target). Applying major coarser correction.`;
        }
      }
    }
  } else {
    // Stage 2: Time is dialed in; taste and secondary refinements take priority
    if (tasteProfile === 'very_sour' || tasteProfile === 'sour') {
      microShift = -1 + retentionOffset + inactivityOffset;
      sunbeamShift = 0;
      reason = `Extraction time (${timeStr}) hit target window, but taste is ${tasteProfile}. Nudging 1 micro-step finer.`;
    } else if (tasteProfile === 'bitter' || tasteProfile === 'very_bitter') {
      microShift = 1 + retentionOffset + inactivityOffset;
      sunbeamShift = 0;
      reason = `Extraction time (${timeStr}) hit target window, but taste is ${tasteProfile}. Nudging 1 micro-step coarser.`;
    } else {
      microShift = 0 + retentionOffset + inactivityOffset;
      sunbeamShift = 0;
      reason = `Extraction time (${timeStr}) and flavor profile are perfectly balanced within target window.`;
    }
  }

  // Flair Water Temp Recommendations (Only when Flair is enabled, dialed in, and taste is off)
  let flairWaterTempAdvice = null;
  if (flairEnabled && isTimeDialedIn) {
    if (tasteProfile === 'sour' || tasteProfile === 'very_sour') {
      flairWaterTempAdvice = "🌡️ Flair Temperature Advisory: Extraction time is dialed in but flavor is sour. Increase brew water temperature by 1–2°C to boost extraction yield.";
    } else if (tasteProfile === 'bitter' || tasteProfile === 'very_bitter') {
      flairWaterTempAdvice = "🌡️ Flair Temperature Advisory: Extraction time is dialed in but flavor is bitter. Decrease brew water temperature by 1–2°C to suppress over-extraction.";
    }
  }

  if (daysSinceLastShot && daysSinceLastShot >= 3) {
    reason += ` (Note: ${daysSinceLastShot} days elapsed since previous shot; active inactivity offset applied).`;
  }

  let subRecommendation = null;
  if (isTimeDialedIn && recentShots.length >= 2) {
    const veryBitterCount = recentShots.filter(s => s.tasteProfile === 'very_bitter' || s.tasteProfile === 'bitter').length;
    const verySourCount = recentShots.filter(s => s.tasteProfile === 'very_sour' || s.tasteProfile === 'sour').length;
    
    if ((tasteProfile === 'very_bitter' || veryBitterCount >= 2) && recipe.targetYieldG / recipe.targetDoseG <= 2.0) {
      subRecommendation = "💡 Ratio Advisory: Time is dialed in with persistent bitterness. Consider lengthening your ratio (e.g., from 1:2 to 1:2.2).";
    } else if ((tasteProfile === 'very_sour' || verySourCount >= 2)) {
      subRecommendation = "💡 Ratio Advisory: Time is dialed in with persistent sourness. Consider tightening your ratio or increasing brew temperature.";
    }
  }

  let recommendedSetting = {};
  if (grinderModel === 'Sette 270Wi') {
    recommendedSetting = adjustSette(setteMacro, setteMicro, microShift);
  } else {
    recommendedSetting = { setting: adjustSunbeam(sunbeamSetting, sunbeamShift) };
  }

  return { recommendedSetting, reason, warning, subRecommendation, flairWaterTempAdvice };
}