import { beanGrinderStorageKey } from '../grinders/grindDialByBean.js';

/** Stable dependency key for grind UI restore (avoids re-running on unrelated settings churn). */
export function grindSettingsRestoreDeps(settings, beanId, grinderModel) {
  const key = beanGrinderStorageKey(beanId, grinderModel);
  const ui = key ? settings?.grindUiByBeanGrinder?.[key] : null;
  return JSON.stringify({
    ui,
    lastSetteMacro: settings?.lastSetteMacro ?? null,
    lastSetteMicro: settings?.lastSetteMicro ?? null,
    lastSunbeamSetting: settings?.lastSunbeamSetting ?? null,
  });
}
