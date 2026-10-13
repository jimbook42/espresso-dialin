/** Proportional damping for grind moves (no hard step-count caps). */
export const GRIND_SHIFT_DAMPING = {
  DEFAULT_OR_LOW_CONFIDENCE: 0.8,
  OUTLIER: 0.6,
  HIGH_LEARNED_CONFIDENCE: 1.0,
};

export const HIGH_LEARNED_CONFIDENCE_THRESHOLD = 0.75;

export function grindShiftDampingFactor({
  isOutlier = false,
  confidence = 0,
  reliableLearnedSensitivity = false,
} = {}) {
  if (isOutlier) return GRIND_SHIFT_DAMPING.OUTLIER;
  if (
    reliableLearnedSensitivity
    && confidence >= HIGH_LEARNED_CONFIDENCE_THRESHOLD
  ) {
    return GRIND_SHIFT_DAMPING.HIGH_LEARNED_CONFIDENCE;
  }
  return GRIND_SHIFT_DAMPING.DEFAULT_OR_LOW_CONFIDENCE;
}

/**
 * @param {number} timeDelta signed seconds off recipe midpoint (negative = fast)
 * @param {number} secondsPerStep learned or default grinder sensitivity
 */
export function proportionalGrindShiftFromTimeDelta(
  timeDelta,
  secondsPerStep,
  options = {}
) {
  if (!Number.isFinite(timeDelta) || !Number.isFinite(secondsPerStep) || secondsPerStep === 0) {
    return 0;
  }
  const damping = grindShiftDampingFactor(options);
  const scaled = (timeDelta / secondsPerStep) * damping;
  const rounded = Math.round(scaled);
  if (rounded === 0) {
    return timeDelta < 0 ? -1 : 1;
  }
  return rounded;
}

/** Scale a precomputed integer/raw shift (e.g. Niche empirical) by the same damping rules. */
export function applyGrindShiftDamping(rawShift, options = {}) {
  if (!rawShift) return 0;
  const sign = rawShift < 0 ? -1 : 1;
  const damping = grindShiftDampingFactor(options);
  const magnitude = Math.abs(rawShift) * damping;
  const rounded = Math.round(magnitude);
  if (rounded === 0) {
    return sign;
  }
  return sign * rounded;
}
