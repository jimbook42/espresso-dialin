const SETTE_MICROS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

export function adjustSette(macro, microLetter, letterShift) {
  let microIdx = SETTE_MICROS.indexOf(microLetter) + letterShift;
  let newMacro = parseInt(macro, 10);

  while (microIdx > 8) {
    microIdx -= 9;
    newMacro += 1;
  }
  while (microIdx < 0) {
    microIdx += 9;
    newMacro -= 1;
  }

  newMacro = Math.min(Math.max(newMacro, 1), 31);
  return { macro: newMacro, micro: SETTE_MICROS[microIdx] };
}

export function adjustSunbeam(currentSetting, stepShift) {
  const setting = parseInt(currentSetting, 10);
  return Math.min(Math.max(setting + stepShift, 1), 30);
}

export function calculateEffectiveBeanAge(bean, mockDateOverride = null) {
  if (!bean || !bean.roastDate) return { daysOld: 0, recommendedOffset: 0, notice: '' };

  const roastDate = new Date(bean.roastDate);
  const today = mockDateOverride ? new Date(mockDateOverride) : new Date();
  let effectiveDays = 0;
  const storageType = bean.storageType || 'bag';

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
        effectiveDays = ageAtFreeze + daysSinceThaw;
      }
    }
  } else if (storageType === 'vacuum') {
    const rawDays = Math.max(0, Math.floor((today - roastDate) / (1000 * 60 * 60 * 24)));
    effectiveDays = Math.floor(rawDays * 0.85); // Vacuum slows staling by ~15%
  } else {
    effectiveDays = Math.max(0, Math.floor((today - roastDate) / (1000 * 60 * 60 * 24)));
  }

  // Roast-type aging kinetics: Light roasts off-gas slowly (peak ~18 days); 
  // Dark roasts off-gas rapidly and degrade faster (~10 days).
  const agingRates = { Light: 0.05, Medium: 0.08, Dark: 0.12 };
  const rate = agingRates[bean.roastType] || 0.08;

  let microStepOffset = 0;
  const peakWindowEnd = bean.roastType === 'Light' ? 18 : bean.roastType === 'Dark' ? 10 : 14;
  
  if (effectiveDays > peakWindowEnd) {
    microStepOffset = Math.floor((effectiveDays - peakWindowEnd) * rate);
  }

  const storageLabels = {
    frozen: 'Frozen Storage',
    vacuum: 'Vacuum Sealed Bag',
    bag: 'Standard Bag'
  };

  return {
    daysOld: effectiveDays,
    recommendedOffset: microStepOffset,
    notice: `(${storageLabels[storageType] || 'Standard'} • ${bean.roastType} Roast) Effective age: ${effectiveDays} days.`
  };
}

export function calculateRecommendation(shotData, recipe, recentShots = []) {
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

  const targetAvg = (recipe.targetTimeMinS + recipe.targetTimeMaxS) / 2;
  const timeDiff = actualTime - targetAvg;

  let warning = null;
  if (lastShotGrind && JSON.stringify(lastShotGrind) !== JSON.stringify({ setteMacro, setteMicro, sunbeamSetting }) && !wasPurged) {
    warning = "⚠️ Unpurged setting change detected. Residual grounds from the previous setting were likely included.";
  }

  let microShift = 0;
  let sunbeamShift = 0;
  let reason = '';

  const doseStr = `${actualDose}g dose`;
  const yieldStr = `${actualYield}g yield`;
  const timeStr = `${actualTime}s extraction time`;
  const targetTimeStr = `target window of ${recipe.targetTimeMinS}–${recipe.targetTimeMaxS}s`;

  if (timeDiff < -7) {
    microShift = -9;
    sunbeamShift = -2;
    reason = `Your ${timeStr} on ${doseStr} / ${yieldStr} was significantly faster than the ${targetTimeStr} (under-extracted).`;
  } else if (timeDiff > 7) {
    microShift = 9;
    sunbeamShift = 2;
    reason = `Your ${timeStr} on ${doseStr} / ${yieldStr} was significantly slower than the ${targetTimeStr} (over-extracted).`;
  } else if (timeDiff >= -7 && timeDiff <= -3) {
    microShift = -3;
    sunbeamShift = -1;
    reason = `Your ${timeStr} on ${doseStr} / ${yieldStr} ran slightly fast relative to the ${targetTimeStr}.`;
  } else if (timeDiff >= 3 && timeDiff <= 7) {
    microShift = 3;
    sunbeamShift = 1;
    reason = `Your ${timeStr} on ${doseStr} / ${yieldStr} ran slightly slow relative to the ${targetTimeStr}.`;
  } else {
    if (tasteProfile === 'very_sour' || tasteProfile === 'sour') {
      microShift = -2;
      sunbeamShift = -1;
      reason = `Extraction time (${timeStr}) hit the ${targetTimeStr}, but flavor profile indicates acidity/sourness.`;
    } else if (tasteProfile === 'bitter' || tasteProfile === 'very_bitter') {
      microShift = 2;
      sunbeamShift = 1;
      reason = `Extraction time (${timeStr}) hit the ${targetTimeStr}, but flavor profile indicates harsh bitterness.`;
    } else {
      reason = `Extraction time (${timeStr}) and flavor profile are perfectly balanced within the ${targetTimeStr}.`;
    }
  }

  if (daysSinceLastShot && daysSinceLastShot > 1) {
    reason += ` Note: ${daysSinceLastShot} days elapsed since your previous shot; background degassing has been factored into this adjustment.`;
  }

  let subRecommendation = null;
  if (recentShots.length >= 3) {
    const bitterCount = recentShots.filter(s => s.tasteProfile === 'bitter' || s.tasteProfile === 'very_bitter').length;
    const sourCount = recentShots.filter(s => s.tasteProfile === 'sour' || s.tasteProfile === 'very_sour').length;
    if (bitterCount >= 2 && recipe.targetYieldG / recipe.targetDoseG <= 2.0) {
      subRecommendation = "💡 Advisory: Recent shots lean bitter. Consider lengthening your recipe ratio (e.g., from 1:2 to 1:2.2) or slightly coarsening the grind.";
    } else if (sourCount >= 2) {
      subRecommendation = "💡 Advisory: Recent shots lean sour. Consider tightening your ratio or increasing brew temperature if extraction persists.";
    }
  }

  let recommendedSetting = {};
  if (grinderModel === 'Sette 270Wi') {
    recommendedSetting = adjustSette(setteMacro, setteMicro, microShift);
  } else {
    recommendedSetting = { setting: adjustSunbeam(sunbeamSetting, sunbeamShift) };
  }

  return { recommendedSetting, reason, warning, subRecommendation };
}