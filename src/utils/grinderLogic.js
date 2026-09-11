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

export function calculateBeanAgeFactor(roastDateString, roastType) {
  if (!roastDateString) return { daysOld: 0, recommendedOffset: 0, notice: '' };

  const roastDate = new Date(roastDateString);
  const today = new Date();
  const daysOld = Math.floor((today - roastDate) / (1000 * 60 * 60 * 24));

  const rates = { Light: 0.05, Medium: 0.08, Dark: 0.12 };
  const rate = rates[roastType] || 0.08;

  if (daysOld > 14) {
    const effectiveDaysAging = daysOld - 14;
    const microStepOffset = Math.floor(effectiveDaysAging * rate);
    return {
      daysOld,
      recommendedOffset: microStepOffset,
      notice: `Beans are ${daysOld} days old. Off-gassing speeds up flow; consider leaning ${microStepOffset > 0 ? microStepOffset + ' step(s) finer' : 'finer'}.`
    };
  }

  return { daysOld, recommendedOffset: 0, notice: `Beans are ${daysOld} days post-roast (Peak freshness window).` };
}

export function calculateRecommendation(shotData, recipe) {
  const {
    grinderModel,
    setteMacro,
    setteMicro,
    sunbeamSetting,
    wasPurged,
    actualTime,
    tasteProfile,
    lastShotGrind
  } = shotData;

  const targetAvg = (recipe.targetTimeMinS + recipe.targetTimeMaxS) / 2;
  const timeDiff = actualTime - targetAvg;

  let warning = null;
  if (lastShotGrind && JSON.stringify(lastShotGrind) !== JSON.stringify({ setteMacro, setteMicro, sunbeamSetting }) && !wasPurged) {
    warning = "⚠️ You changed the grind setting for this shot but didn't purge residual grounds. 2-3g of stale grounds were likely included. Run 1 purged shot before adjusting grind setting again.";
  }

  let microShift = 0;
  let sunbeamShift = 0;
  let reason = '';

  if (timeDiff < -7) {
    microShift = -9;
    sunbeamShift = -2;
    reason = 'Shot ran very fast. Substantial under-extraction detected.';
  } else if (timeDiff > 7) {
    microShift = 9;
    sunbeamShift = 2;
    reason = 'Shot ran very slow. Substantial over-extraction detected.';
  } else if (timeDiff >= -7 && timeDiff <= -3) {
    microShift = -3;
    sunbeamShift = -1;
    reason = 'Shot ran slightly fast.';
  } else if (timeDiff >= 3 && timeDiff <= 7) {
    microShift = 3;
    sunbeamShift = 1;
    reason = 'Shot ran slightly slow.';
  } else {
    if (tasteProfile === 'very_sour' || tasteProfile === 'sour') {
      microShift = -2;
      sunbeamShift = -1;
      reason = 'Timing is within range, but flavor profile indicates sourness/under-extraction.';
    } else if (tasteProfile === 'very_bitter' || tasteProfile === 'bitter') {
      microShift = 2;
      sunbeamShift = 1;
      reason = 'Timing is within range, but flavor profile indicates bitterness/over-extraction.';
    } else {
      reason = 'Shot is balanced and within target time bounds! Retain current grind settings.';
    }
  }

  let recommendedSetting = {};
  if (grinderModel === 'Sette 270Wi') {
    recommendedSetting = adjustSette(setteMacro, setteMicro, microShift);
  } else {
    recommendedSetting = { setting: adjustSunbeam(sunbeamSetting, sunbeamShift) };
  }

  return { recommendedSetting, reason, warning };
}