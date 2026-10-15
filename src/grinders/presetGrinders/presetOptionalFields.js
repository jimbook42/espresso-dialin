import {
  BARISTA_EXPRESS_GRINDER_ID,
  BARISTA_PRO_GRINDER_ID,
  BARISTA_TOUCH_GRINDER_ID,
  DF54_GRINDER_ID,
  DF64_GEN2_GRINDER_ID,
} from './catalog.js';

/** Global settings keys (free-form on settings row; no Dexie schema bump). */
const UPPER_BURR_SETTINGS_KEY = {
  [BARISTA_EXPRESS_GRINDER_ID]: 'bes870UpperBurr',
  [BARISTA_PRO_GRINDER_ID]: 'bes878UpperBurr',
  [BARISTA_TOUCH_GRINDER_ID]: 'bes880UpperBurr',
};

const ZERO_OFFSET_SETTINGS_KEY = {
  [DF64_GEN2_GRINDER_ID]: 'df64Gen2ZeroOffset',
  [DF54_GRINDER_ID]: 'df54ZeroOffset',
};

export const BARISTA_EXPRESS_UPPER_BURR_DEFAULT = 6;
export const BARISTA_EXPRESS_UPPER_BURR_MIN = 1;
export const BARISTA_EXPRESS_UPPER_BURR_MAX = 10;

export const BARISTA_EXPRESS_UPPER_BURR_SHIFT_NOTE =
  'Outer numbers shift with the upper burr; one burr step ≈ the whole outer range, so outer settings aren\'t comparable across burr settings. Older BES870UK units have no adjustable burr.';

export const BARISTA_PRO_TOUCH_UPPER_BURR_SHIFT_NOTE =
  'Outer numbers shift with the upper burr; adjust one burr number at a time.';

function finiteNumber(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function presetOptionalDialField(spec) {
  if (!spec) return null;
  if (spec.optionalDialField) return spec.optionalDialField;
  if (UPPER_BURR_SETTINGS_KEY[spec.id]) return 'upperBurr';
  if (ZERO_OFFSET_SETTINGS_KEY[spec.id]) return 'zeroOffset';
  return null;
}

export function getPresetUpperBurr(settings, grinderId = BARISTA_EXPRESS_GRINDER_ID) {
  const key = UPPER_BURR_SETTINGS_KEY[grinderId];
  if (!key) return null;
  const n = finiteNumber(settings?.[key]);
  if (n === null) return BARISTA_EXPRESS_UPPER_BURR_DEFAULT;
  return n;
}

export function getPresetZeroOffset(settings, spec) {
  const key = ZERO_OFFSET_SETTINGS_KEY[spec?.id];
  if (!key) return null;
  return finiteNumber(settings?.[key]);
}

export function validatePresetUpperBurrInput(raw) {
  if (raw === '' || raw === null || raw === undefined) {
    return {
      ok: true,
      value: undefined,
      warning: null,
    };
  }
  const n = finiteNumber(raw);
  if (n === null || n < BARISTA_EXPRESS_UPPER_BURR_MIN || n > BARISTA_EXPRESS_UPPER_BURR_MAX) {
    return {
      ok: false,
      value: null,
      warning: null,
      error: `Upper burr must be between ${BARISTA_EXPRESS_UPPER_BURR_MIN} and ${BARISTA_EXPRESS_UPPER_BURR_MAX}.`,
    };
  }
  const warning =
    n !== BARISTA_EXPRESS_UPPER_BURR_DEFAULT
      ? `Factory default is ${BARISTA_EXPRESS_UPPER_BURR_DEFAULT}; outer dial numbers are not comparable across burr positions.`
      : null;
  return { ok: true, value: n, warning, error: null };
}

export function validatePresetZeroOffsetInput(raw, spec) {
  if (raw === '' || raw === null || raw === undefined) {
    return { ok: true, value: undefined };
  }
  const n = finiteNumber(raw);
  if (n === null) {
    return { ok: false, value: null, error: 'Zero offset must be a number.' };
  }
  if (n < spec.min || n > spec.max) {
    return {
      ok: false,
      value: null,
      error: `Zero offset must be within the dial range (${spec.min}–${spec.max}).`,
    };
  }
  return { ok: true, value: n };
}

export function presetZeroPlusOffset(absoluteDial, spec, settings = null) {
  const parsed = finiteNumber(absoluteDial);
  if (parsed === null) return null;
  const zero = getPresetZeroOffset(settings, spec);
  const relative = zero !== null ? parsed - zero : parsed;
  return relative;
}

function formatAbsoluteDialNumber(parsed, spec) {
  if (spec.step >= 1) return String(Math.round(parsed));
  const stepped = Math.round(parsed / spec.step) * spec.step;
  return String(Number(stepped.toFixed(2)));
}

export function formatPresetZeroPlusDisplay(absoluteDial, spec, settings = null) {
  const parsed = finiteNumber(absoluteDial);
  if (parsed === null) return '';
  const relative = presetZeroPlusOffset(parsed, spec, settings);
  if (relative === null) return '';
  const rounded =
    spec.step >= 1
      ? Math.round(relative)
      : Math.round(relative / spec.step) * spec.step;
  const relativeDisplay =
    spec.step >= 1 && Number.isInteger(rounded)
      ? String(rounded)
      : String(Number(rounded.toFixed(2)));
  const zero = getPresetZeroOffset(settings, spec);
  const relativePart = `zero + ${relativeDisplay}`;
  if (zero !== null) {
    return `${relativePart} (dial ${formatAbsoluteDialNumber(parsed, spec)})`;
  }
  return relativePart;
}

export function absoluteDialFromZeroPlus(relativeN, spec, settings = null) {
  const n = finiteNumber(relativeN);
  if (n === null) return null;
  const zero = getPresetZeroOffset(settings, spec);
  return (zero ?? 0) + n;
}

export function presetUpperBurrSettingsKey(grinderId) {
  return UPPER_BURR_SETTINGS_KEY[grinderId] ?? null;
}

export function presetZeroOffsetSettingsKey(grinderId) {
  return ZERO_OFFSET_SETTINGS_KEY[grinderId] ?? null;
}
