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
 * }} state
 */
export function flairProfileMarkerProgress(built, state) {
  const { timerProgress, scaleConnected, profile, extractionElapsedS, liveRelativeWeightG, targetTimeMaxS } =
    state;
  if (!built || !profile) return timerProgress;

  const taperTrigger = resolveTaperStartTrigger(profile);
  const holdEndSec = built.preDur + built.rampDur + (built.totalSec - built.preDur - built.rampDur - built.taperDur);
  const taperStartProgress = holdEndSec / built.totalSec;

  if (!scaleConnected) {
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
