const SESSION_KEY = 'espressoDialIn.weighingTargetFeedback';

/**
 * @returns {boolean}
 */
export function readWeighingTargetFeedbackSession() {
  if (typeof sessionStorage === 'undefined') return true;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw === '0') return false;
    if (raw === '1') return true;
  } catch {
    return true;
  }
  return true;
}

/**
 * @param {boolean} enabled
 */
export function writeWeighingTargetFeedbackSession(enabled) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(SESSION_KEY, enabled ? '1' : '0');
  } catch {
    // ignore quota / private mode
  }
}
