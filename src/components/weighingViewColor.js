import { parseRecipeTargetDoseG } from './weighingViewFormat.js';

export const WEIGHING_HIT_TOLERANCE_G = 0.1;

/** @typedef {'off' | 'below' | 'near' | 'hit' | 'over'} WeighingColorState */

/**
 * @param {number} liveWeightG
 * @param {unknown} targetDoseG
 * @param {boolean} targetFeedbackEnabled
 * @returns {{ state: WeighingColorState, diff?: number, approach?: number }}
 */
export function resolveWeighingColorState(liveWeightG, targetDoseG, targetFeedbackEnabled) {
  if (!targetFeedbackEnabled) return { state: 'off' };
  const target = parseRecipeTargetDoseG(targetDoseG);
  if (target == null) return { state: 'off' };

  const live = Number(liveWeightG);
  const n = Number.isFinite(live) ? live : 0;
  const diff = n - target;

  if (diff > WEIGHING_HIT_TOLERANCE_G) {
    return { state: 'over', diff };
  }
  if (Math.abs(diff) <= WEIGHING_HIT_TOLERANCE_G) {
    return { state: 'hit', diff };
  }

  const gap = target - n;
  const approachBandG = Math.max(target * 0.5, 5);
  const approach = 1 - Math.min(1, Math.max(0, gap / approachBandG));
  if (approach >= 0.85) {
    return { state: 'near', diff, approach };
  }
  return { state: 'below', diff, approach };
}

/**
 * @param {string} hex
 * @returns {[number, number, number]}
 */
function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * @param {string} a
 * @param {string} b
 * @param {number} t
 */
function lerpHexColor(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const u = Math.min(1, Math.max(0, t));
  const r = Math.round(r1 + (r2 - r1) * u);
  const g = Math.round(g1 + (g2 - g1) * u);
  const bl = Math.round(b1 + (b2 - b1) * u);
  return `rgb(${r}, ${g}, ${bl})`;
}

/**
 * @param {WeighingColorState} state
 * @param {number} [approach]
 * @returns {string | null} CSS color, or null for default (off)
 */
export function weighingWeightColorForState(state, approach = 0) {
  switch (state) {
    case 'off':
      return null;
    case 'below':
      return lerpHexColor('#9a9690', '#c88a4b', approach);
    case 'near':
      return '#e0a660';
    case 'hit':
      return '#9cb088';
    case 'over':
      return '#c97868';
    default:
      return null;
  }
}

/**
 * @param {WeighingColorState} state
 */
export function weighingWeightIsBold(state) {
  return state === 'hit' || state === 'over';
}
