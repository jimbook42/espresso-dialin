import { roundYieldG } from './scaleShotStopSettle.js';

/** Grams; sudden drop larger than this is treated as cup removal. */
export const SETTLE_SHARP_DROP_G = 2.5;

/**
 * Pick settled yield from stop-tap weight, peak during settle window, and live reading.
 * Never returns meaningfully below the weight at stop (within 0.2g tolerance).
 */
export function resolveSettledYieldG(weightAtStopG, peakDuringSettleG, liveNowG) {
  const atStop = Number(weightAtStopG) || 0;
  const peak = Math.max(atStop, Number(peakDuringSettleG) || 0);
  const now = Number(liveNowG) || 0;
  if (atStop <= 0) return roundYieldG(peak || now);

  if (atStop - now > SETTLE_SHARP_DROP_G) {
    return roundYieldG(atStop);
  }

  const candidate = Math.max(atStop, peak, now);
  const settled = Math.max(candidate, atStop - 0.2);
  return roundYieldG(settled);
}
