import { isPresetGrinderId } from './presetGrinders/catalog.js';
import { parsePresetGrindValue } from './presetGrinders/dial.js';
import { getPresetGrinderSpec } from './presetGrinders/catalog.js';

export function beanGrinderStorageKey(beanId, grinderModel) {
  if (!beanId || !grinderModel) return '';
  return `${beanId}::${grinderModel}`;
}

function normalizePresetSnapshot(grinderModel, snap) {
  if (snap?.customGrindValue == null) return null;
  const spec = getPresetGrinderSpec(grinderModel);
  if (!spec) return snap;
  const parsed = parsePresetGrindValue(snap.customGrindValue, spec);
  if (parsed === null) return null;
  return { customGrindValue: parsed };
}

/**
 * Last applied / manual dial for this bean + grinder (not shared across beans).
 * @returns {object|null} partial UI state (setteMacro, setteMicro, nicheZeroSetting, customGrindValue, sunbeamSetting)
 */
export function getGrindUiForBeanGrinder(settings, beanId, grinderModel) {
  const key = beanGrinderStorageKey(beanId, grinderModel);
  if (!key) return null;
  const raw = settings?.grindUiByBeanGrinder?.[key];
  if (!raw || typeof raw !== 'object') return null;
  if (isPresetGrinderId(grinderModel)) {
    return normalizePresetSnapshot(grinderModel, raw);
  }
  return { ...raw };
}

export function patchGrindUiForBeanGrinder(settings, beanId, grinderModel, uiSnapshot) {
  const key = beanGrinderStorageKey(beanId, grinderModel);
  if (!key || !uiSnapshot) return {};
  const cleaned = Object.fromEntries(
    Object.entries(uiSnapshot).filter(([, v]) => v !== null && v !== undefined && v !== '')
  );
  if (Object.keys(cleaned).length === 0) return {};
  return {
    grindUiByBeanGrinder: {
      ...(settings?.grindUiByBeanGrinder || {}),
      [key]: cleaned,
    },
  };
}

export function grindUiSnapshotFromControls({
  setteMacro,
  setteMicro,
  sunbeamSetting,
  nicheZeroSetting,
  customGrindValue,
}) {
  const snap = {};
  if (setteMacro != null && setteMacro !== '') snap.setteMacro = setteMacro;
  if (setteMicro != null && setteMicro !== '') snap.setteMicro = setteMicro;
  if (sunbeamSetting != null && sunbeamSetting !== '') snap.sunbeamSetting = sunbeamSetting;
  if (nicheZeroSetting != null && nicheZeroSetting !== '') snap.nicheZeroSetting = nicheZeroSetting;
  if (customGrindValue != null && customGrindValue !== '') snap.customGrindValue = customGrindValue;
  return snap;
}
