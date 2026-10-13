export const CURRENT_PULL_ELIGIBILITY_ID = '__current_pull__';

export function isPersistedLearningShot(shot) {
  return Boolean(shot && shot.id !== CURRENT_PULL_ELIGIBILITY_ID);
}
