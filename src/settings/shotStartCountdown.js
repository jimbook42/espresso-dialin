export const SHOT_START_COUNTDOWN_OFF = 'off';
export const SHOT_START_COUNTDOWN_ON = 'on';
export const SHOT_START_COUNTDOWN_FLAIR_ONLY = 'flair_only';

export const DEFAULT_SHOT_START_COUNTDOWN = SHOT_START_COUNTDOWN_FLAIR_ONLY;

const VALID = new Set([
  SHOT_START_COUNTDOWN_OFF,
  SHOT_START_COUNTDOWN_ON,
  SHOT_START_COUNTDOWN_FLAIR_ONLY,
]);

export function normalizeShotStartCountdown(value) {
  if (value && VALID.has(value)) return value;
  return DEFAULT_SHOT_START_COUNTDOWN;
}

/** Whether the 3-2-1 overlay should run before the shot timer starts. */
export function isShotStartCountdownActive(setting, flairEnabled) {
  const mode = normalizeShotStartCountdown(setting);
  if (mode === SHOT_START_COUNTDOWN_ON) return true;
  if (mode === SHOT_START_COUNTDOWN_FLAIR_ONLY) return Boolean(flairEnabled);
  return false;
}
