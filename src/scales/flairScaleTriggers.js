/** @param {unknown} raw */
function parsePositiveNumber(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {{ preinfusionEndTrigger?: string } | null | undefined} flairProfile
 * @param {boolean} scaleConnected
 * @returns {'manual' | 'time' | 'weight'}
 */
export function resolvePreinfusionEndTrigger(flairProfile, scaleConnected) {
  if (!scaleConnected) return 'manual';
  const raw = flairProfile?.preinfusionEndTrigger;
  if (raw === 'manual' || raw === 'time' || raw === 'weight') return raw;
  return 'time';
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
 * Scale-driven pre-infusion auto-end targets (relative grams when weight mode).
 *
 * @param {{
 *   preinfusionEndTrigger?: string,
 *   preinfusionTime?: string | number,
 *   preinfusionEndWeightG?: string | number,
 * } | null | undefined} flairProfile
 * @param {boolean} scaleConnected
 */
export function preinfusionAutoEndTargets(flairProfile, scaleConnected = true) {
  const trigger = resolvePreinfusionEndTrigger(flairProfile, scaleConnected);
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
