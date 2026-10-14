import { getPresetGrinderSpec, isPresetGrinderId } from './catalog.js';
import { parsePresetGrindValue } from './dial.js';
import {
  getGrindUiForBeanGrinder,
  patchGrindUiForBeanGrinder,
} from '../grindDialByBean.js';

/**
 * Per-bean, per-grinder preset dial (never shared across beans).
 */
export function getPersistedPresetGrindValue(settings, grinderModel, beanId) {
  if (!isPresetGrinderId(grinderModel) || !beanId) return null;
  const snap = getGrindUiForBeanGrinder(settings, beanId, grinderModel);
  if (snap?.customGrindValue == null) return null;
  const spec = getPresetGrinderSpec(grinderModel);
  if (!spec) return null;
  return parsePresetGrindValue(snap.customGrindValue, spec);
}

export function persistedPresetGrindSettingsPatch(
  grinderModel,
  value,
  existingSettings = {},
  beanId
) {
  if (!isPresetGrinderId(grinderModel) || !beanId) return {};
  const spec = getPresetGrinderSpec(grinderModel);
  if (!spec) return {};
  const parsed = parsePresetGrindValue(value, spec);
  if (parsed === null) return {};
  return patchGrindUiForBeanGrinder(existingSettings, beanId, grinderModel, {
    customGrindValue: parsed,
  });
}
