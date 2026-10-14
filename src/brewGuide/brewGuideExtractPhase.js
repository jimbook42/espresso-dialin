export const BREW_EXTRACT_IDLE = 'idle';
export const BREW_EXTRACT_ARMING = 'arming';
export const BREW_EXTRACT_RUNNING = 'running';
export const BREW_EXTRACT_STOPPED = 'stopped';

/** Brew Guide timer step: arm on Start, run only when App timer is actually running. */
export function syncBrewExtractPhaseWithTimer(extractPhase, { timerRunning, countdownActive }) {
  if (extractPhase !== BREW_EXTRACT_ARMING) return extractPhase;
  if (timerRunning) return BREW_EXTRACT_RUNNING;
  if (!countdownActive) return BREW_EXTRACT_IDLE;
  return BREW_EXTRACT_ARMING;
}
