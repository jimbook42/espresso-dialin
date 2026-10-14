export const SHOT_YIELD_SETTLE_MS = 1000;

export function roundYieldG(liveWeightG) {
  return Math.max(0, Math.round(liveWeightG * 10) / 10);
}
