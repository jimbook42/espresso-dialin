import { isBalancedTaste } from './tasteProfile.js';

/** Tolerance for floating-point comparisons at inclusive boundaries. */
export const PERFECT_SHOT_FLOAT_EPS = 1e-9;

const YIELD_TOLERANCE_G = 0.1;
const TIME_TOLERANCE_S = 0.5;

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * True when a logged shot hits yield, time (vs window midpoint), and balanced taste.
 * @param {{ yieldG?: number, targetYieldG?: number, timeS?: number, timeMinS?: number, timeMaxS?: number, taste?: string }} params
 */
export function isPerfectShot({
  yieldG,
  targetYieldG,
  timeS,
  timeMinS,
  timeMaxS,
  taste,
}) {
  const y = finiteNumber(yieldG);
  const targetY = finiteNumber(targetYieldG);
  const t = finiteNumber(timeS);
  const minS = finiteNumber(timeMinS);
  const maxS = finiteNumber(timeMaxS);

  if (y === null || targetY === null || t === null || minS === null || maxS === null) {
    return false;
  }
  if (maxS < minS) return false;

  if (!isBalancedTaste(taste)) return false;

  const yieldDelta = Math.abs(y - targetY);
  if (yieldDelta > YIELD_TOLERANCE_G + PERFECT_SHOT_FLOAT_EPS) return false;

  const midS = (minS + maxS) / 2;
  const timeDelta = Math.abs(t - midS);
  if (timeDelta > TIME_TOLERANCE_S + PERFECT_SHOT_FLOAT_EPS) return false;

  return true;
}

/** @param {( ) => number} [rand] */
export function pickCameo(rand = Math.random) {
  return rand() < 0.05 ? 'gold' : 'suit';
}

export const PERFECT_SHOT_CELEBRATION_MS = 1400;
export const PERFECT_SHOT_CELEBRATION_REDUCED_MS = 1200;
