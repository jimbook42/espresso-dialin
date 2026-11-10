import { savedShotMeasurements } from './shotProfile.js';
import { tasteProfileDisplayLabel } from './tasteProfile.js';
import { isStandalonePressureShot } from '../flairPressureLab/standalonePressureShot.js';

const finite = (value) => Number.isFinite(value);
const hasSettingValue = (value) => finite(value) || (typeof value === 'string' && value.trim() !== '');
const numberOrNull = (value) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && value !== null && value !== '' ? number : null;
};
const grams = (value) => `${Number(value.toFixed(1))} g`;
const seconds = (value) => `${Number(value.toFixed(1))} s`;

function insight(category, priority, message, evidenceSource, options = {}) {
  return { category, priority, message, evidenceSource, ...options };
}

function savedGrindLabel(grinderModel, setting) {
  if (!setting || typeof setting !== 'object') return null;
  if (finite(setting.nicheZeroSetting)) return `Niche Zero ${setting.nicheZeroSetting}`;
  if (hasSettingValue(setting.setteMacro) && hasSettingValue(setting.setteMicro)) return `macro ${setting.setteMacro}, micro ${setting.setteMicro}`;
  if (hasSettingValue(setting.macro) && hasSettingValue(setting.micro)) return `macro ${setting.macro}, micro ${setting.micro}`;
  if (finite(setting.sunbeamSetting)) return `setting ${setting.sunbeamSetting}`;
  if (finite(setting.customGrindValue)) return `setting ${setting.customGrindValue}`;
  if (hasSettingValue(setting.setting)) return `${grinderModel || 'grinder'} ${setting.setting}`;
  return null;
}

/**
 * Build concise, local explanations from persisted shot facts and the B08 profile.
 * Does not read storage, use the active recipe, or calculate recommendations.
 */
export function generateShotInsights({
  shot,
  profile,
  recommendation = shot?.recommendation,
  excludeFromLearning = shot?.excludeFromLearning === true,
  knownIssueReason = shot?.knownIssueReason,
} = {}) {
  const findings = [];
  if (!shot || typeof shot !== 'object') {
    return { mainTakeaway: null, observations: [], nextStep: null, insights: [] };
  }

  const pressureOnly = isStandalonePressureShot(shot);
  const targetMin = numberOrNull(shot.targetTimeMinS);
  const targetMax = numberOrNull(shot.targetTimeMaxS);
  const actualTime = numberOrNull(shot.actualTimeS ?? shot.actualTime);
  const targetYield = numberOrNull(shot.targetYieldG);
  const targetDose = numberOrNull(shot.targetDoseG);
  const measurements = savedShotMeasurements(shot);

  if (!pressureOnly && actualTime != null && targetMin != null && targetMax != null && targetMax >= targetMin) {
    if (actualTime < targetMin) {
      findings.push(insight('recipe-comparison', 1,
        `Extraction time was faster than the saved ${seconds(targetMin)}–${seconds(targetMax)} range.`, 'saved-shot-target',
        { contextualDetail: `Recorded time: ${seconds(actualTime)}.` }));
    } else if (actualTime > targetMax) {
      findings.push(insight('recipe-comparison', 1,
        `Extraction time was slower than the saved ${seconds(targetMin)}–${seconds(targetMax)} range.`, 'saved-shot-target',
        { contextualDetail: `Recorded time: ${seconds(actualTime)}.` }));
    } else {
      findings.push(insight('recipe-comparison', 1,
        `Extraction finished within the saved ${seconds(targetMin)}–${seconds(targetMax)} time range.`, 'saved-shot-target',
        { contextualDetail: `Recorded time: ${seconds(actualTime)}.` }));
    }
  } else if (!pressureOnly && actualTime != null) {
    findings.push(insight('shot-measurement', 2,
      `Recorded extraction time was ${seconds(actualTime)}; this shot has no saved time target to compare.`, 'saved-shot-measurement'));
  }

  if (!pressureOnly && measurements.yieldG != null && targetYield != null && targetYield >= 0) {
    const difference = measurements.yieldG - targetYield;
    if (difference !== 0) {
      findings.push(insight('recipe-comparison', 2,
        `Recorded yield was ${grams(Math.abs(difference))} ${difference > 0 ? 'above' : 'below'} the saved target of ${grams(targetYield)}.`,
        'saved-shot-target', { contextualDetail: 'Yield comparison uses the shot-level target saved at the time.' }));
    }
  }

  if (!pressureOnly && measurements.doseG != null && targetDose != null && targetDose >= 0
    && measurements.doseG !== targetDose) {
    findings.push(insight('recipe-comparison', 2,
      `Recorded dose was ${grams(measurements.doseG)}; the saved target was ${grams(targetDose)}.`,
      'saved-shot-target'));
  }

  if (!pressureOnly && measurements.doseG != null && measurements.yieldG != null
    && targetYield == null && targetMin == null && measurements.ratio != null) {
    findings.push(insight('brew-ratio', 2,
      `Recorded ${grams(measurements.doseG)} in and ${grams(measurements.yieldG)} out (1:${measurements.ratio.toFixed(1)}).`,
      'saved-shot-measurement'));
  }

  if (!pressureOnly && shot.tasteProfile) {
    const tasteLabel = tasteProfileDisplayLabel(shot.tasteProfile);
    findings.push(insight('taste-feedback', 2, `You described this shot as ${tasteLabel}.`, 'saved-taste-feedback'));
  }

  if (!pressureOnly && recommendation?.recommendedSetting) {
    const setting = savedGrindLabel(shot.grinderModel, recommendation.recommendedSetting);
    if (setting) {
      const reason = typeof recommendation.reason === 'string' && recommendation.reason.trim()
        ? ` ${recommendation.reason.trim()}` : '';
      findings.push(insight('saved-recommendation', 2,
        `At the time, the app recommended ${setting}.${reason}`, 'saved-recommendation',
        { contextualDetail: 'This is the recommendation saved with this shot; it may no longer fit if your bean, grinder, or recipe has changed.' }));
    }
  }

  if (excludeFromLearning) {
    const reason = knownIssueReason ? ` (${String(knownIssueReason).replace(/[_-]/g, ' ')})` : '';
    findings.push(insight('learning-status', 1,
      `This shot was marked not for learning${reason}.`, 'saved-shot-metadata',
      { contextualDetail: 'It remains in History and was excluded from recommendation learning.' }));
  }

  if (pressureOnly || profile?.pressure?.length) {
    if (finite(profile?.peakPressureBar)) {
      findings.push(insight('pressure-observation', 3,
        `Peak recorded pressure was ${profile.peakPressureBar.toFixed(1)} bar.`, 'shot-profile-derived-measurement',
        { contextualDetail: 'Pressure alone does not establish extraction quality or taste.' }));
    }
    if (profile?.pressure?.length > 1) {
      const spanS = profile.pressure.at(-1).tS - profile.pressure[0].tS;
      if (finite(spanS) && spanS >= 0) {
        findings.push(insight('pressure-observation', 3,
          `Available pressure samples span ${seconds(spanS)}.`, 'shot-profile-derived-measurement'));
      }
    }
  }
  if ((pressureOnly || profile?.weight?.length) && finite(profile?.finalWeightG)) {
    findings.push(insight('scale-observation', 3,
      `Last observed scale weight was ${grams(profile.finalWeightG)}.`, 'shot-profile-measurement'));
  }
  if ((pressureOnly || profile?.flow?.length) && finite(profile?.averageFlowGs)) {
    findings.push(insight('flow-observation', 3,
      `Average flow over observed intervals was ${profile.averageFlowGs.toFixed(2)} g/s.`, 'shot-profile-derived-measurement'));
  }
  if ((pressureOnly || profile?.flow?.length) && finite(profile?.peakFlowGs)) {
    findings.push(insight('flow-observation', 3,
      `Peak smoothed flow was ${profile.peakFlowGs.toFixed(2)} g/s.`, 'shot-profile-derived-measurement'));
  }
  if ((pressureOnly || profile?.pressure?.length || profile?.weight?.length) && profile?.pressureInterrupted) {
    findings.push(insight('sensor-availability', 2, 'Pressure recording was interrupted.', 'shot-profile-measurement'));
  }
  if ((pressureOnly || profile?.pressure?.length || profile?.weight?.length) && profile?.scaleInterrupted) {
    findings.push(insight('sensor-availability', 2, 'Scale recording was interrupted.', 'shot-profile-measurement'));
  }
  if (profile?.approximate) {
    findings.push(insight('timing-context', 3,
      'Sensor timing is approximately aligned for this historical shot.', 'shot-profile-timing-metadata'));
  }

  const main = findings.find((item) => item.category === 'learning-status')
    || findings.find((item) => item.priority === 1)
    || findings.find((item) => item.category !== 'sensor-availability' && item.category !== 'timing-context')
    || null;
  const remaining = findings.filter((item) => item !== main);
  const recommendationInsight = remaining.find((item) => item.category === 'saved-recommendation') || null;
  const facts = remaining.filter((item) => item !== recommendationInsight)
    .sort((left, right) => left.priority - right.priority);
  const observations = recommendationInsight ? [...facts.slice(0, 1), recommendationInsight] : facts.slice(0, 2);
  const nextStep = recommendationInsight ? insight('next-step', 3,
    'If your setup has changed since this shot, check the current Dial recommendation before reusing this setting.',
    'saved-recommendation', { contextualDetail: 'This reminder does not recalculate the saved recommendation.' }) : null;

  if (!main && observations.length === 0 && !nextStep) {
    const fallback = pressureOnly
      ? insight('summary', 3, 'No pressure or scale measurements are available for this recording.', 'saved-shot-data')
      : insight('summary', 3, 'No saved targets or measurements are available to compare for this shot.', 'saved-shot-data');
    findings.push(fallback);
    return { mainTakeaway: fallback, observations: [], nextStep: null, insights: findings };
  }

  return { mainTakeaway: main, observations, nextStep, insights: findings };
}
