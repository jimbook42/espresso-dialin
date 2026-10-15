import { getPresetGrinderSpec } from './catalog.js';
import {
  formatPresetZeroPlusDisplay,
  getPresetZeroOffset,
} from './presetOptionalFields.js';
import {
  adjustCustomGrind,
  customValueToNumeric,
  defaultCustomGrindValue,
  formatCustomGrindDisplay,
  parseCustomGrindValue,
  roundToCustomStep,
} from '../customGrinder.js';

export function presetProfileFromSpec(spec) {
  const dialType = spec.dialKind === 'stepped' || spec.dialKind === 'fellowOpus1' ? 'stepped' : 'stepless';
  return {
    name: spec.id,
    dialType,
    min: spec.min,
    max: spec.max,
    step: spec.step,
    lowerIsFiner: spec.lowerIsFiner,
  };
}

export function parsePresetGrindValue(raw, spec) {
  const profile = presetProfileFromSpec(spec);
  return parseCustomGrindValue(raw, profile);
}

export function formatPresetGrindDisplay(value, spec, settings = null) {
  const profile = presetProfileFromSpec(spec);
  const parsed = parseCustomGrindValue(value, profile);
  if (parsed === null) return '';
  if (spec.zeroStartOffset != null) {
    return formatPresetZeroPlusDisplay(parsed, spec, settings);
  }
  const formatted = formatCustomGrindDisplay(parsed, profile);
  if (!formatted) return '';
  if (spec.id === 'Zerno Z1') return `${formatted} µm`;
  return formatted;
}

export function clampPresetGrind(value, spec) {
  const profile = presetProfileFromSpec(spec);
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) {
    const parsed = parseCustomGrindValue(value, profile);
    return parsed ?? defaultCustomGrindValue(profile);
  }
  return parseCustomGrindValue(n, profile) ?? defaultCustomGrindValue(profile);
}

export function adjustPresetGrind(currentValue, dialShift, spec) {
  const profile = presetProfileFromSpec(spec);
  return adjustCustomGrind(currentValue, dialShift, profile);
}

export function presetValueToNumeric(value, spec) {
  const profile = presetProfileFromSpec(spec);
  return customValueToNumeric(value, profile);
}

export function parsePresetGrindForModel(raw, grinderModel) {
  const spec = getPresetGrinderSpec(grinderModel);
  if (!spec) return null;
  return parsePresetGrindValue(raw, spec);
}

export function defaultPresetGrindValue(spec, settings = null) {
  const profile = presetProfileFromSpec(spec);
  if (spec.zeroStartOffset != null) {
    const zero = getPresetZeroOffset(settings, spec);
    const absolute = (zero ?? 0) + spec.zeroStartOffset;
    return clampPresetGrind(absolute, spec);
  }
  return roundToCustomStep(spec.defaultSetting, profile);
}
