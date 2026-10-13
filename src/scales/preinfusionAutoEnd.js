/** @param {unknown} raw */
function parsePositiveNumber(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Flair recipe targets for scale-driven auto end of pre-infusion (scale mode only).
 * Time from pre-infusion duration; grams from peak-end yield (lever / profile decrease).
 *
 * @param {{ preinfusionTime?: string | number, peakEndYield?: string | number } | null | undefined} flairProfile
 */
export function preinfusionAutoEndTargets(flairProfile) {
  return {
    timeS: parsePositiveNumber(flairProfile?.preinfusionTime),
    weightG: parsePositiveNumber(flairProfile?.peakEndYield),
  };
}

/**
 * @param {{ timeS: number | null, weightG: number | null }} targets
 * @param {{ preInfusionElapsedS: number, liveWeightG: number }} state
 */
export function shouldAutoEndPreinfusion(targets, state) {
  const { timeS, weightG } = targets;
  const hasTime = timeS != null;
  const hasWeight = weightG != null;
  if (!hasTime && !hasWeight) return false;

  const timeReached = hasTime && state.preInfusionElapsedS >= timeS;
  const weightReached = hasWeight && state.liveWeightG >= weightG;
  if (hasTime && hasWeight) return timeReached || weightReached;
  if (hasTime) return timeReached;
  return weightReached;
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
