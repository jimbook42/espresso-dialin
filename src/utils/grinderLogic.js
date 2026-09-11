import Dexie from 'dexie';

export const db = new Dexie('EspressoDialDB');

db.version(11).stores({
  beans: 'id, name, roaster, roastDate, storageType, postThawStorage, freezeDate, thawDate, rating, createdAt',
  recipes: 'id, beanId, targetDoseG, targetYieldG, targetTimeMinS, targetTimeMaxS',
  shots: 'id, beanId, timestamp, grinderModel, setteMacro, setteMicro, sunbeamSetting',
  settings: 'id, grinderModel, flairEnabled'
});

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

  const freshThresholds = { Light: 10, Medium: 5, Dark: 3 };
  const minFresh = freshThresholds[bean.roastType] || 5;
  const isTooFresh = effectiveDays < minFresh;
  const isStale = effectiveDays > 35;

  let microStepOffset = 0;
  if (isTooFresh) {
    microStepOffset = 1;
  } else if (isStale) {
    const excessDays = Math.min(effectiveDays - 35, 300);
    microStepOffset = -Math.min(Math.round(excessDays * 0.05), 12);
  } else if (effectiveDays > 14) {
    microStepOffset = Math.floor((effectiveDays - 14) * 0.08);
  }

  const storageLabels = { frozen: 'Frozen Storage', vacuum: 'Vacuum Sealed Bag', bag: 'Standard Bag' };
  let notice = `(${storageLabels[storageType] || 'Standard'} • ${bean.roastType} Roast) Effective age: ${effectiveDays} days.`;
  if (isTooFresh) {
    notice += ` Too fresh / High CO2: Gas creates pneumatic resistance. Grind slightly coarser to prevent choking.`;
  } else if (isStale) {
    notice += ` Stale / Low Degassing: Lacks backpressure. Grind significantly finer to force extraction time.`;
  }

  return { daysOld: effectiveDays, recommendedOffset: microStepOffset, notice, isTooFresh, isStale };
}

export function getInitialGrindRecommendation(grinderModel, roastType, activeBean, recipes = [], allShots = [], beans = [], mockDateOverride = null) {
  const trendOffset = getGrindHistoryTrendOffset(grinderModel, allShots, recipes, beans);
  const ageData = calculateEffectiveBeanAge(activeBean, mockDateOverride);
  const totalOffset = ageData.recommendedOffset + Math.round(trendOffset);

  if (grinderModel === 'Sette 270Wi') {
    const baseMacro = roastType === 'Light' ? 15 : roastType === 'Dark' ? 12 : 13;
    const baseMicroIdx = roastType === 'Light' ? 2 : roastType === 'Dark' ? 5 : 4;
    const baseNumeric = baseMacro * 9 + baseMicroIdx + totalOffset;
    return numericToSette(baseNumeric);
  } else {
    const baseSetting = roastType === 'Light' ? 17 : roastType === 'Dark' ? 13 : 15;
    const finalSetting = Math.min(Math.max(baseSetting + totalOffset, 1), 30);
    return { setting: finalSetting };
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
    daysSinceLastShot,
    recommendationFollowed = true
  } = shotData;

  const targetMin = recipe.targetTimeMinS;
  const targetMax = recipe.targetTimeMaxS;
  const targetYield = recipe.targetYieldG;

  let warning = null;
  let retentionOffset = 0;

  if (lastShotGrind && JSON.stringify(lastShotGrind) !== JSON.stringify({ setteMacro, setteMicro, sunbeamSetting }) && !wasPurged) {
    warning = "Unpurged setting change detected with residual grounds in the chute. Retention skewed flow speed.";
    retentionOffset = -1;
  }

  if (!recommendationFollowed) {
    warning = warning ? warning + " ⚠️ Previous grind recommendation was not followed." : "⚠️ Previous grind recommendation was not followed.";
  }

  let inactivityOffset = 0;
  if (daysSinceLastShot && daysSinceLastShot >= 3) {
    inactivityOffset = -Math.min(Math.floor(daysSinceLastShot / 3), 2);
  }

  const yieldDelta = actualYield - targetYield;
  if (actualTime >= targetMin && actualTime <= targetMax && Math.abs(yieldDelta) >= 3.5) {
    if (yieldDelta < 0) {
      warning = warning ? warning + " Shot hit target time but under-yielded." : "Shot hit target time but under-yielded (restricted flow).";
    } else {
      warning = warning ? warning + " Shot hit target time but over-yielded." : "Shot hit target time but over-yielded (high flow / channeling).";
    }
  }

  let microShift = 0;
  let sunbeamShift = 0;
  let reason = '';

  const timeStr = `${actualTime}s`;
  const isTimeDialedIn = actualTime >= targetMin && actualTime <= targetMax;
  const isBitter = tasteProfile === 'bitter' || tasteProfile === 'very_bitter';
  const isSour = tasteProfile === 'sour' || tasteProfile === 'very_sour';
  const prettyTaste = tasteProfile === 'very_sour' ? 'very sour' : tasteProfile === 'very_bitter' ? 'very bitter' : tasteProfile;

  if (!isTimeDialedIn) {
    if (actualTime < targetMin) {
      if (isBitter) {
        reason = `Your extraction time was ${timeStr}, but tastes ${prettyTaste}. This indicates severe channeling. DO NOT grind finer. Focus on WDT/puck prep.`;
        warning = warning ? warning + " Severe channeling detected." : "Severe channeling detected.";
        microShift = 0;
        sunbeamShift = 0;
      } else {
        const diff = targetMin - actualTime;
        if (grinderModel === 'Sunbeam Barista Max') {
          if (diff <= 2) {
            sunbeamShift = 0;
            reason = `Your extraction time was ${timeStr} (${diff}s faster than target). Keep grind setting and increase dose by +0.5g.`;
          } else if (diff <= 5) {
            sunbeamShift = -1;
            reason = `Your extraction time was ${timeStr} (${diff}s faster than target). Making a 1-step finer adjustment.`;
          } else if (diff <= 9) {
            sunbeamShift = -2;
            reason = `Your extraction time was ${timeStr} (${diff}s faster than target). Making a 2-step finer adjustment.`;
          } else if (diff <= 14) {
            sunbeamShift = -3;
            reason = `Your extraction time was fast at ${timeStr} (${diff}s off target). Making a 3-step finer adjustment.`;
          } else {
            sunbeamShift = -4;
            reason = `Your extraction time was severely fast at ${timeStr} (${diff}s off target). Making an aggressive 4-step finer adjustment to dial in faster.`;
          }
        } else {
          if (diff <= 1) {
            microShift = -1 + retentionOffset + inactivityOffset;
            reason = `Your extraction time was ${timeStr} (1s faster than target). Nudging 1 micro-step finer.`;
          } else if (diff <= 3) {
            microShift = -2 + retentionOffset + inactivityOffset;
            reason = `Your extraction time was ${timeStr} (${diff}s faster than target). Nudging 2 micro-steps finer.`;
          } else if (diff <= 6) {
            microShift = -4 + retentionOffset + inactivityOffset;
            reason = `Your extraction time was ${timeStr} (${diff}s faster than target). Adjusting 4 micro-steps finer.`;
          } else if (diff <= 10) {
            microShift = -8 + retentionOffset + inactivityOffset;
            reason = `Your extraction time was fast at ${timeStr} (${diff}s off target). Adjusting 8 micro-steps (almost a macro step) finer.`;
          } else {
            microShift = -12 + retentionOffset + inactivityOffset;
            reason = `Your extraction time was severely fast at ${timeStr} (${diff}s off target). Applying an aggressive >1 macro step finer correction to dial in faster.`;
          }
        }
      }
    } else {
      const diff = actualTime - targetMax;
      if (grinderModel === 'Sunbeam Barista Max') {
        if (diff <= 2) {
          sunbeamShift = 0;
          reason = `Your extraction time was ${timeStr} (${diff}s slower than target). Keep grind setting and decrease dose by -0.5g.`;
        } else if (diff <= 5) {
          sunbeamShift = 1;
          reason = `Your extraction time was ${timeStr} (${diff}s slower than target). Making a 1-step coarser adjustment.`;
        } else if (diff <= 9) {
          sunbeamShift = 2;
          reason = `Your extraction time was ${timeStr} (${diff}s slower than target). Making a 2-step coarser adjustment.`;
        } else if (diff <= 14) {
          sunbeamShift = 3;
          reason = `Your extraction time was slow at ${timeStr} (${diff}s off target). Making a 3-step coarser adjustment.`;
        } else {
          sunbeamShift = 4;
          reason = `Your extraction time was severely slow at ${timeStr} (${diff}s off target). Making an aggressive 4-step coarser adjustment to dial in faster.`;
        }
      } else {
        if (diff <= 1) {
          microShift = 1 + retentionOffset + inactivityOffset;
          reason = `Your extraction time was ${timeStr} (1s slower than target). Nudging 1 micro-step coarser.`;
        } else if (diff <= 3) {
          microShift = 2 + retentionOffset + inactivityOffset;
          reason = `Your extraction time was ${timeStr} (${diff}s slower than target). Nudging 2 micro-steps coarser.`;
        } else if (diff <= 6) {
          microShift = 4 + retentionOffset + inactivityOffset;
          reason = `Your extraction time was ${timeStr} (${diff}s slower than target). Adjusting 4 micro-steps coarser.`;
        } else if (diff <= 10) {
          microShift = 8 + retentionOffset + inactivityOffset;
          reason = `Your extraction time was slow at ${timeStr} (${diff}s off target). Adjusting 8 micro-steps coarser.`;
        } else {
          microShift = 12 + retentionOffset + inactivityOffset;
          reason = `Your extraction time was severely slow at ${timeStr} (${diff}s off target). Applying an aggressive >1 macro step coarser correction to dial in faster.`;
        }
      }
    }
  } else {
    if (isSour) {
      microShift = -1 + retentionOffset + inactivityOffset;
      sunbeamShift = 0;
      reason = `Extraction time (${timeStr}) hit target window, but taste is ${prettyTaste}. Nudging 1 micro-step finer to push extraction.`;
    } else if (isBitter) {
      microShift = 1 + retentionOffset + inactivityOffset;
      sunbeamShift = 0;
      reason = `Extraction time (${timeStr}) hit target window, but taste is ${prettyTaste}. Nudging 1 micro-step coarser to limit over-extraction.`;
    } else {
      microShift = 0 + retentionOffset + inactivityOffset;
      sunbeamShift = 0;
      reason = `Extraction time (${timeStr}) and flavor profile are perfectly balanced within target window.`;
    }
  }

  let flairWaterTempAdvice = null;
  if (flairEnabled && isTimeDialedIn) {
    if (isSour) {
      flairWaterTempAdvice = "Flair Temperature Advisory: Extraction time is dialed in but flavor is sour. Increase brew water temperature by 1-2C to boost extraction yield.";
    } else if (isBitter) {
      flairWaterTempAdvice = "Flair Temperature Advisory: Extraction time is dialed in but flavor is bitter. Decrease brew water temperature by 1-2C to suppress over-extraction.";
    }
  }

  let subRecommendation = null;
  if (isTimeDialedIn) {
    const dialedInRecentShots = recentShots.filter(s => s.actualTimeS >= targetMin && s.actualTimeS <= targetMax);
    const dialedInBitterCount = dialedInRecentShots.filter(s => s.tasteProfile === 'bitter' || s.tasteProfile === 'very_bitter').length;
    const dialedInSourCount = dialedInRecentShots.filter(s => s.tasteProfile === 'sour' || s.tasteProfile === 'very_sour').length;

    const totalDialedInBitter = dialedInBitterCount + (isBitter ? 1 : 0);
    const totalDialedInSour = dialedInSourCount + (isSour ? 1 : 0);

    if (totalDialedInBitter >= 2 && recipe.targetYieldG / recipe.targetDoseG <= 2.0) {
      subRecommendation = "Ratio Advisory: Time is dialed in with persistent bitterness across dialed-in shots. Consider lengthening your ratio.";
    } else if (totalDialedInSour >= 2) {
      subRecommendation = "Ratio Advisory: Time is dialed in with persistent sourness across dialed-in shots. Consider tightening your ratio or increasing brew temperature.";
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