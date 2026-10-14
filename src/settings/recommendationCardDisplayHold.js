import { beanGrinderStorageKey } from '../grinders/grindDialByBean.js';

export function getRecommendationCardDisplayHold(settings, beanId, grinderModel) {
  const key = beanGrinderStorageKey(beanId, grinderModel);
  if (!key) return null;
  const label = settings?.recommendationCardDisplayByBeanGrinder?.[key];
  return typeof label === 'string' && label.trim() ? label.trim() : null;
}

export function patchRecommendationCardDisplayHold(settings, beanId, grinderModel, displayLabel) {
  const key = beanGrinderStorageKey(beanId, grinderModel);
  if (!key || !displayLabel) return {};
  return {
    recommendationCardDisplayByBeanGrinder: {
      ...(settings?.recommendationCardDisplayByBeanGrinder || {}),
      [key]: displayLabel,
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
