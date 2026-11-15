export const BREW_EXTRACT_IDLE = 'idle';
export const BREW_EXTRACT_ARMING = 'arming';
export const BREW_EXTRACT_RUNNING = 'running';
export const BREW_EXTRACT_STOPPED = 'stopped';

/**
 * The guide stays armed during 3-2-1 and while App prepares the scale.
 */
export function syncBrewExtractPhaseWithTimer(
  extractPhase,
  { timerRunning, countdownActive, startPending = false }
) {
  if (extractPhase !== BREW_EXTRACT_ARMING) return extractPhase;
  if (timerRunning) return BREW_EXTRACT_RUNNING;
  if (!countdownActive && !startPending) return BREW_EXTRACT_IDLE;
  return BREW_EXTRACT_ARMING;
}
