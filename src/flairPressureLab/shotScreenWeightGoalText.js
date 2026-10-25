import {
  preinfusionAutoEndTargets,
  resolveFlairPressurePhase,
  resolveTaperStartTrigger,
} from '../scales/flairScaleTriggers.js';

function positiveNum(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatGoalGrams(g) {
  const v = positiveNum(g);
  if (v == null) return null;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Compact weight-goal line for the full-screen shot timer (display only).
 *
 * @returns {string | null}
 */
export function shotScreenWeightGoalText({
  flairProfile,
  targetYieldG,
  settingEnabled = false,
  scaleConnected = false,
  scaleFeatureEnabled = true,
  timerRunning = false,
  timerUsePreInfusion = false,
  preInfusionPhase = false,
  extractionElapsedS = 0,
  liveRelativeWeightG = 0,
  targetTimeMaxS,
}) {
  if (!settingEnabled || !scaleConnected) return null;

  const stopG = formatGoalGrams(targetYieldG) ?? formatGoalGrams(36);
  if (stopG == null) return null;

  const scaleCtx = { scaleFeatureEnabled, scaleConnected };
  const preTargets = preinfusionAutoEndTargets(flairProfile, scaleCtx);
  const preWeightG =
    preTargets.trigger === 'weight' ? positiveNum(preTargets.weightG) : null;
  const taperByWeight =
    resolveTaperStartTrigger(flairProfile) === 'weight'
    && scaleConnected;
  const peakEndG = taperByWeight ? positiveNum(flairProfile?.peakEndYield) : null;

  const hasWeightStage = preWeightG != null || peakEndG != null;

  if (!hasWeightStage) {
    return `Stop ${stopG} g`;
  }

  const phase = resolveFlairPressurePhase({
    profile: flairProfile,
    timerRunning,
    timerUsePreInfusion,
    preInfusionPhase,
    extractionElapsedS,
    liveRelativeWeightG,
    scaleConnected,
    targetTimeMaxS,
  });

  let stagePart = null;
  if (phase === 'pre' && preWeightG != null) {
    stagePart = `Pre → ${formatGoalGrams(preWeightG)} g`;
  } else if (phase === 'peak' && peakEndG != null) {
    stagePart = `Peak → ${formatGoalGrams(peakEndG)} g`;
  } else if (phase === 'taper') {
    stagePart = `Taper · Stop ${stopG} g`;
    return stagePart;
  }

  if (stagePart) {
    return `${stagePart} · Stop ${stopG} g`;
  }
  return `Stop ${stopG} g`;
}
