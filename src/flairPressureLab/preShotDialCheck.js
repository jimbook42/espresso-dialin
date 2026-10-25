import { dialPoseMismatchWarning } from './shotStartDialPoseCheck.js';

export const PRE_SHOT_DIAL_FOUND_LABEL = 'Dial found';
export const PRE_SHOT_DIAL_NOT_FOUND_LABEL =
  'Dial not found. Check the phone hasn\'t moved, or recalibrate.';

/** ~3 Hz pose samples before Start; stop processing after a stable verdict. */
export const PRE_SHOT_DIAL_SAMPLE_MS = 333;
export const PRE_SHOT_DIAL_STABLE_MS = 1000;

/**
 * @param {{
 *   trackedHub?: { x: number, y: number } | null,
 *   calibratedHub?: { x: number, y: number } | null,
 *   calibratedRadius?: number | null,
 *   poseLost?: boolean,
 *   distanceFactor?: number,
 * }} pose
 */
export function preShotDialMismatch(pose) {
  return dialPoseMismatchWarning(pose);
}

/**
 * Tracks a dial-found verdict until it stays unchanged for stableMs, then locks.
 */
export function createPreShotDialVerdictSampler({
  stableMs = PRE_SHOT_DIAL_STABLE_MS,
} = {}) {
  let lastVerdict = null;
  let stableSince = null;
  let locked = false;

  const reset = () => {
    lastVerdict = null;
    stableSince = null;
    locked = false;
  };

  /**
   * @param {boolean} mismatch from preShotDialMismatch
   * @param {number} [nowMs]
   * @returns {{ status: 'checking' | 'found' | 'not_found', locked: boolean }}
   */
  const observe = (mismatch, nowMs = Date.now()) => {
    if (locked) {
      return { status: lastVerdict === 'found' ? 'found' : 'not_found', locked: true };
    }
    const verdict = mismatch ? 'not_found' : 'found';
    if (lastVerdict !== verdict) {
      lastVerdict = verdict;
      stableSince = nowMs;
      return { status: 'checking', locked: false };
    }
    if (stableSince != null && nowMs - stableSince >= stableMs) {
      locked = true;
      return { status: verdict, locked: true };
    }
    return { status: 'checking', locked: false };
  };

  return { reset, observe };
}
