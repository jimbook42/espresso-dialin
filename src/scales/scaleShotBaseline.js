/**
 * Relative shot weight after Start: software baseline during tare, then post-tare anchor.
 *
 * @param {number} weightBeforeTareG
 * @param {number} weightAfterTareG Live reading when tare command finished
 * @param {boolean} tareSucceeded
 */
export function shotStartWeightBaselineG(weightBeforeTareG, weightAfterTareG, tareSucceeded) {
  if (tareSucceeded) return weightAfterTareG;
  return weightBeforeTareG;
}

/** @param {number} liveWeightG @param {number} baselineG */
export function relativeWeightG(liveWeightG, baselineG) {
  const live = Number(liveWeightG);
  const base = Number(baselineG);
  if (!Number.isFinite(live) || !Number.isFinite(base)) return 0;
  return Math.max(0, live - base);
}
