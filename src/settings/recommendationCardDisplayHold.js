import { beanGrinderStorageKey } from '../grinders/grindDialByBean.js';

export function getRecommendationCardDisplayHold(settings, beanId, grinderModel) {
  const key = beanGrinderStorageKey(beanId, grinderModel);
  if (!key) return null;
  const hold = settings?.recommendationCardDisplayByBeanGrinder?.[key];
  return typeof hold === 'string' ? { label: hold.trim() } : hold ?? null;
}

export function patchRecommendationCardDisplayHold(settings, beanId, grinderModel, displayLabel, basketDirection) {
  const key = beanGrinderStorageKey(beanId, grinderModel);
  if (!key || !displayLabel || !basketDirection) return {};
  return {
    recommendationCardDisplayByBeanGrinder: {
      ...(settings?.recommendationCardDisplayByBeanGrinder || {}),
      [key]: { label: displayLabel, basketDirection },
    },
  };
}

export function clearRecommendationCardDisplayHoldPatch(settings, beanId, grinderModel) {
  const key = beanGrinderStorageKey(beanId, grinderModel);
  if (!key) return {};
  const prev = settings?.recommendationCardDisplayByBeanGrinder || {};
  if (!prev[key]) return {};
  const next = { ...prev };
  delete next[key];
  return { recommendationCardDisplayByBeanGrinder: next };
}
