/** @param {unknown} raw */
function parsePositiveNumber(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @typedef {{ scaleFeatureEnabled?: boolean, scaleConnected?: boolean }} PreinfusionScaleContext
 */

/**
 * @param {{ preinfusionEndTrigger?: string } | null | undefined} flairProfile
 * @param {boolean | PreinfusionScaleContext} scaleContext
 * @returns {'manual' | 'time' | 'weight'}
 */
export function resolvePreinfusionEndTrigger(flairProfile, scaleContext = {}) {
  const ctx =
    typeof scaleContext === 'boolean'
      ? { scaleFeatureEnabled: scaleContext, scaleConnected: scaleContext }
      : scaleContext;
  const { scaleFeatureEnabled = false, scaleConnected = false } = ctx;

  const raw = flairProfile?.preinfusionEndTrigger;
  let trigger = raw === 'manual' || raw === 'time' || raw === 'weight' ? raw : 'manual';

  if (trigger === 'weight' && (!scaleFeatureEnabled || !scaleConnected)) {
    return 'manual';
  }
  return trigger;
}

/**
 * @param {{ taperStartTrigger?: string } | null | undefined} flairProfile
 * @returns {'time' | 'weight'}
 */
export function resolveTaperStartTrigger(flairProfile) {
  const raw = flairProfile?.taperStartTrigger;
  if (raw === 'time' || raw === 'weight') return raw;
  return 'weight';
}

/**
 * @param {{
 *   preinfusionEndTrigger?: string,
 *   preinfusionTime?: string | number,
 *   preinfusionEndWeightG?: string | number,
 * } | null | undefined} flairProfile
 * @param {boolean | PreinfusionScaleContext} scaleContext
 */
export function preinfusionAutoEndTargets(flairProfile, scaleContext = {}) {
  const trigger = resolvePreinfusionEndTrigger(flairProfile, scaleContext);
  if (trigger === 'manual') {
    return { trigger, timeS: null, weightG: null };
  }
  if (trigger === 'weight') {
    return {
      trigger,
      timeS: null,
      weightG: parsePositiveNumber(flairProfile?.preinfusionEndWeightG),
    };
  }
  return {
    trigger,
    timeS: parsePositiveNumber(flairProfile?.preinfusionTime),
    weightG: null,
  };
}

/**
 * @param {{ trigger: string, timeS: number | null, weightG: number | null }} targets
 * @param {{ preInfusionElapsedS: number, liveRelativeWeightG: number }} state
 */
export function shouldAutoEndPreinfusion(targets, state) {
  if (targets.trigger === 'manual') return false;
  if (targets.trigger === 'time') {
    return targets.timeS != null && state.preInfusionElapsedS >= targets.timeS;
  }
  if (targets.trigger === 'weight') {
    return targets.weightG != null && state.liveRelativeWeightG >= targets.weightG;
  }
  return false;
}

/**
 * Flair recipe with time-based pre-infusion auto-end (works with or without scale).
 *
 * @param {PreinfusionScaleContext} ctx
 */
export function recipeUsesTimedPreinfusionAutoEnd(flairProfile, flairEnabled, ctx = {}) {
  if (!flairEnabled || !recipeDefinesPreinfusion(flairProfile)) return false;
  const trigger = resolvePreinfusionEndTrigger(flairProfile, ctx);
  return trigger === 'time' && parsePositiveNumber(flairProfile?.preinfusionTime) != null;
}

/**
 * @param {{ preinfusionTime?: string | number, preinfusionPressure?: string | number } | null | undefined} flairProfile
 */
export function recipeDefinesPreinfusion(flairProfile) {
  return (
    parsePositiveNumber(flairProfile?.preinfusionTime) != null
    || parsePositiveNumber(flairProfile?.preinfusionPressure) != null
  );
}

/**
 * Where the taper segment begins on the static chart (0–1), from recipe taper triggers.
 *
 * @param {{
 *   preDur: number,
 *   rampDur: number,
 *   taperDur: number,
 *   totalSec: number,
 * } | null} built
 * @param {Record<string, unknown> | null | undefined} profile
 * @param {{ targetYieldG?: string | number }} [options]
 */
export function flairProfileTaperStartChartProgress(built, profile, options = {}) {
  if (!built || !profile) {
    return built ? (built.preDur + built.rampDur) / built.totalSec : 0;
  }

  const holdDur = built.totalSec - built.preDur - built.rampDur - built.taperDur;
  const defaultTaperStartSec = built.preDur + built.rampDur + holdDur;
  const taperTrigger = resolveTaperStartTrigger(profile);

  if (taperTrigger === 'time') {
    const taperTimeS = parsePositiveNumber(profile.taperStartTimeS);
    const taperStartSec =
      taperTimeS != null ? built.preDur + built.rampDur + taperTimeS : defaultTaperStartSec;
    return Math.min(1, Math.max(0, taperStartSec / built.totalSec));
  }

  const peakG = parsePositiveNumber(profile.peakEndYield);
  const targetG = parsePositiveNumber(options.targetYieldG) ?? 36;
  if (peakG == null) {
    return defaultTaperStartSec / built.totalSec;
  }
  const holdFraction = Math.min(1, peakG / targetG);
  const taperStartSec = built.preDur + built.rampDur + holdFraction * holdDur;
  return Math.min(1, Math.max(0, taperStartSec / built.totalSec));
}

/**
 * Live pressure-profile phase for chart labeling.
 *
 * @returns {'pre' | 'peak' | 'taper'}
 */
export function resolveFlairPressurePhase({
  profile,
  timerRunning = false,
  timerUsePreInfusion = false,
  preInfusionPhase = false,
  extractionElapsedS = 0,
  liveRelativeWeightG = 0,
  scaleConnected = false,
  targetTimeMaxS,
}) {
  if (!timerRunning) return 'peak';
  if (timerUsePreInfusion && preInfusionPhase) return 'pre';
  if (!profile) return 'peak';

  const taperTrigger = resolveTaperStartTrigger(profile);
  if (taperTrigger === 'weight' && scaleConnected) {
    const peakG = parsePositiveNumber(profile.peakEndYield);
    if (peakG != null && liveRelativeWeightG >= peakG) return 'taper';
    return 'peak';
  }

  const taperTimeS =
    parsePositiveNumber(profile.taperStartTimeS) ?? parsePositiveNumber(targetTimeMaxS);
  if (taperTimeS != null && extractionElapsedS >= taperTimeS) return 'taper';
  return 'peak';
}

/**
 * Marker progress on the static pressure chart (0–1), optionally driven by scale taper triggers.
 *
 * @param {{
 *   preDur: number,
 *   rampDur: number,
 *   taperDur: number,
 *   totalSec: number,
 * } | null} built
 * @param {{
 *   timerProgress: number,
 *   scaleConnected: boolean,
 *   profile: Record<string, unknown> | null | undefined,
 *   extractionElapsedS: number,
 *   liveRelativeWeightG: number,
 *   targetTimeMaxS?: number,
 *   targetYieldG?: string | number,
 * }} state
 */
export function flairProfileMarkerProgress(built, state) {
  const {
    timerProgress,
    scaleConnected,
    profile,
    extractionElapsedS,
    liveRelativeWeightG,
    targetTimeMaxS,
    targetYieldG,
  } = state;
  if (!built || !profile) return timerProgress;

  const taperTrigger = resolveTaperStartTrigger(profile);
  const taperStartProgress = flairProfileTaperStartChartProgress(built, profile, { targetYieldG });

  if (!scaleConnected) {
    if (taperTrigger === 'time') {
      const taperTimeS =
        parsePositiveNumber(profile.taperStartTimeS) ?? parsePositiveNumber(targetTimeMaxS);
      if (taperTimeS != null && extractionElapsedS >= taperTimeS) {
        return Math.max(timerProgress, taperStartProgress);
      }
      return Math.min(timerProgress, taperStartProgress);
    }
    return timerProgress;
  }

  if (taperTrigger === 'weight') {
    const peakG = parsePositiveNumber(profile.peakEndYield);
    if (peakG == null) return timerProgress;
    if (liveRelativeWeightG >= peakG) {
      return Math.max(timerProgress, taperStartProgress);
    }
    return Math.min(timerProgress, taperStartProgress);
  }

  const taperTimeS =
    parsePositiveNumber(profile.taperStartTimeS) ?? parsePositiveNumber(targetTimeMaxS);
  if (taperTimeS != null && extractionElapsedS >= taperTimeS) {
    return Math.max(timerProgress, taperStartProgress);
  }
  return Math.min(timerProgress, taperStartProgress);
}
