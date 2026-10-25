/** Settings key: compact weight goals on the full-screen shot timer. Default off. */
export const SHOT_SCREEN_WEIGHT_GOALS_KEY = 'shotScreenWeightGoalsEnabled';

/** @param {Record<string, unknown> | null | undefined} settings */
export function isShotScreenWeightGoalsEnabled(settings) {
  return settings?.[SHOT_SCREEN_WEIGHT_GOALS_KEY] === true;
}
