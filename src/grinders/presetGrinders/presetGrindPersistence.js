import { getPresetGrinderSpec, isPresetGrinderId } from './catalog.js';
import { parsePresetGrindValue } from './dial.js';

/**
 * Per-grinder last applied / dialed values for ticket 6.15 presets (survives reload and grinder switches).
 * @param {object|null} settings
 * @param {string} grinderModel
 * @returns {number|null}
 */
export function getPersistedPresetGrindValue(settings, grinderModel) {
  if (!isPresetGrinderId(grinderModel)) return null;
  const spec = getPresetGrinderSpec(grinderModel);
  if (!spec) return null;

  const fromMap = settings?.presetGrindByModel?.[grinderModel];
  if (fromMap != null && fromMap !== '') {
    const parsed = parsePresetGrindValue(fromMap, spec);
    if (parsed !== null) return parsed;
  }

  return null;
}

/**
 * @param {string} grinderModel
 * @param {number|string} value
 * @param {object} [existingSettings]
 */
export function persistedPresetGrindSettingsPatch(grinderModel, value, existingSettings = {}) {
  if (!isPresetGrinderId(grinderModel)) return {};
  const spec = getPresetGrinderSpec(grinderModel);
  if (!spec) return {};
  const parsed = parsePresetGrindValue(value, spec);
  if (parsed === null) return {};

  const presetGrindByModel = {
    ...(existingSettings.presetGrindByModel || {}),
    [grinderModel]: parsed,
  };

  return {
    presetGrindByModel,
    lastPresetGrindValue: null,
    lastCustomGrindValue: null,
  };
}
