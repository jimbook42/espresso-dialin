export const BREW_EXTRACT_IDLE = 'idle';
export const BREW_EXTRACT_ARMING = 'arming';
export const BREW_EXTRACT_RUNNING = 'running';
export const BREW_EXTRACT_STOPPED = 'stopped';

/**
 * Brew Guide timer step: arm on Start, run only when App timer is actually running.
 * `countdownHandoffPending` covers the gap after 3-2-1 ends and before timer.running flips true.
 */
export function syncBrewExtractPhaseWithTimer(
  extractPhase,
  { timerRunning, countdownActive, countdownHandoffPending = false }
) {
  if (extractPhase !== BREW_EXTRACT_ARMING) return extractPhase;
  if (timerRunning) return BREW_EXTRACT_RUNNING;
  if (!countdownActive && !countdownHandoffPending) return BREW_EXTRACT_IDLE;
  return BREW_EXTRACT_ARMING;
}
