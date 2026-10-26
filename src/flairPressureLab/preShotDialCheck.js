import { dialPoseMismatchWarning } from './shotStartDialPoseCheck.js';

export const PRE_SHOT_DIAL_FOUND_LABEL = 'Dial found';
export const PRE_SHOT_DIAL_NOT_FOUND_LABEL =
  'Dial not found. Check the phone hasn\'t moved, or recalibrate.';

/** ~3 Hz pose samples before Start; stop processing after a stable verdict. */
export const PRE_SHOT_DIAL_SAMPLE_MS = 333;
export const PRE_SHOT_DIAL_STABLE_MS = 1000;

export const PRE_SHOT_DIAL_WINDOW_SIZE = 6;
/** Need this many samples before a "found" window verdict (full window not required). */
export const PRE_SHOT_DIAL_WINDOW_MIN_FOR_FOUND = 4;
/** At most this many bad samples in the window still counts as "pose matches". */
export const PRE_SHOT_DIAL_WINDOW_MAX_BAD = 2;
export const PRE_SHOT_DIAL_NOT_FOUND_MIN_BAD = 5;
export const PRE_SHOT_DIAL_NOT_FOUND_MIN_MS = 1500;
export const PRE_SHOT_DIAL_FOUND_CLEAR_MS = 2000;

/**
 * @param {boolean[]} window newest sample last
 */
export function dialPoseWindowSaysFound(window) {
  if (window.length < PRE_SHOT_DIAL_WINDOW_MIN_FOR_FOUND) return false;
  const bad = window.filter(Boolean).length;
  return bad <= PRE_SHOT_DIAL_WINDOW_MAX_BAD;
}

/**
 * @param {boolean[]} window newest sample last
 */
export function dialPoseWindowSaysLost(window) {
  if (window.length < PRE_SHOT_DIAL_WINDOW_SIZE) return false;
  const bad = window.filter(Boolean).length;
  return bad > PRE_SHOT_DIAL_WINDOW_MAX_BAD;
}

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
 * Debounced pose mismatch for UI (pre-shot check + shot-start hint).
 * Feeds raw per-frame mismatch booleans; exposes window-smoothed verdicts.
 */
export function createDialPoseMismatchDebouncer({
  windowSize = PRE_SHOT_DIAL_WINDOW_SIZE,
  windowMaxBad = PRE_SHOT_DIAL_WINDOW_MAX_BAD,
} = {}) {
  const window = [];

  const reset = () => {
    window.length = 0;
  };

  const push = (mismatch) => {
    window.push(Boolean(mismatch));
    while (window.length > windowSize) window.shift();
  };

  const badCount = () => window.filter(Boolean).length;

  const saysFound = () => {
    if (window.length < PRE_SHOT_DIAL_WINDOW_MIN_FOR_FOUND) return false;
    return badCount() <= windowMaxBad;
  };

  const saysLost = () => window.length >= windowSize && badCount() > windowMaxBad;

  return { reset, push, saysFound, saysLost, getWindow: () => [...window] };
}

/**
 * Tracks a dial-found verdict with rolling-window smoothing and hysteresis.
 */
export function createPreShotDialVerdictSampler({
  stableMs = PRE_SHOT_DIAL_STABLE_MS,
  notFoundMinBad = PRE_SHOT_DIAL_NOT_FOUND_MIN_BAD,
  notFoundMinMs = PRE_SHOT_DIAL_NOT_FOUND_MIN_MS,
  foundClearMs = PRE_SHOT_DIAL_FOUND_CLEAR_MS,
  debouncer = createDialPoseMismatchDebouncer(),
} = {}) {
  let lockedStatus = null;
  let goodStableSince = null;
  let lostClearSince = null;
  let consecutiveBad = 0;
  let consecutiveBadSince = null;
  let notFoundRecoverSince = null;

  const reset = () => {
    lockedStatus = null;
    goodStableSince = null;
    lostClearSince = null;
    consecutiveBad = 0;
    consecutiveBadSince = null;
    notFoundRecoverSince = null;
    debouncer.reset();
  };

  /**
   * @param {boolean} mismatch from preShotDialMismatch
   * @param {number} [nowMs]
   * @returns {{ status: 'checking' | 'found' | 'not_found', locked: boolean }}
   */
  const observe = (mismatch, nowMs = Date.now()) => {
    if (lockedStatus === 'found') {
      debouncer.push(mismatch);
      if (debouncer.saysLost()) {
        if (lostClearSince == null) lostClearSince = nowMs;
        if (nowMs - lostClearSince >= foundClearMs) {
          lockedStatus = 'not_found';
          return { status: 'not_found', locked: true };
        }
      } else {
        lostClearSince = null;
      }
      return { status: 'found', locked: true };
    }

    if (lockedStatus === 'not_found') {
      debouncer.push(mismatch);
      if (debouncer.saysFound()) {
        if (notFoundRecoverSince == null) notFoundRecoverSince = nowMs;
        if (nowMs - notFoundRecoverSince >= stableMs) {
          lockedStatus = 'found';
          lostClearSince = null;
          return { status: 'found', locked: true };
        }
      } else {
        notFoundRecoverSince = null;
      }
      return { status: 'not_found', locked: true };
    }

    debouncer.push(mismatch);

    if (mismatch) {
      consecutiveBad += 1;
      if (consecutiveBad === 1) consecutiveBadSince = nowMs;
    } else {
      consecutiveBad = 0;
      consecutiveBadSince = null;
    }

    if (
      consecutiveBad >= notFoundMinBad
      && consecutiveBadSince != null
      && nowMs - consecutiveBadSince >= notFoundMinMs
    ) {
      lockedStatus = 'not_found';
      notFoundRecoverSince = null;
      return { status: 'not_found', locked: true };
    }

    if (debouncer.saysFound()) {
      if (goodStableSince == null) goodStableSince = nowMs;
      if (nowMs - goodStableSince >= stableMs) {
        lockedStatus = 'found';
        lostClearSince = null;
        return { status: 'found', locked: true };
      }
    } else {
      goodStableSince = null;
    }

    return { status: 'checking', locked: false };
  };

  return { reset, observe };
}

/**
 * Shot-start recalibrate hint: same window debounce as pre-shot check (no lock).
 */
export function createShotStartDialHintTracker({
  debouncer = createDialPoseMismatchDebouncer(),
  stableMs = PRE_SHOT_DIAL_STABLE_MS,
  foundClearMs = PRE_SHOT_DIAL_FOUND_CLEAR_MS,
} = {}) {
  let hintVisible = false;
  let mismatchSince = null;
  let clearSince = null;

  const reset = () => {
    hintVisible = false;
    mismatchSince = null;
    clearSince = null;
    debouncer.reset();
  };

  /**
   * @param {boolean} mismatch raw per-frame
   * @param {number} [nowMs]
   * @returns {{ showHint: boolean, done: boolean }}
   */
  const observe = (mismatch, nowMs = Date.now()) => {
    debouncer.push(mismatch);

    if (!hintVisible) {
      if (debouncer.saysLost()) {
        if (mismatchSince == null) mismatchSince = nowMs;
        if (nowMs - mismatchSince >= stableMs) {
          hintVisible = true;
          return { showHint: true, done: false };
        }
      } else {
        mismatchSince = null;
      }
      return { showHint: false, done: false };
    }

    if (debouncer.saysFound()) {
      if (clearSince == null) clearSince = nowMs;
      if (nowMs - clearSince >= foundClearMs) {
        return { showHint: false, done: true };
      }
      return { showHint: true, done: false };
    }
    clearSince = null;
    return { showHint: true, done: false };
  };

  return { reset, observe };
}
