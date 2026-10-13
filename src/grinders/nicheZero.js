/**
 * Niche Zero dial reference (stepless between markings).
 * Product dial is commonly marked ~0 (finest) through ~50 (coarsest); numbers are reference positions, not calibrated steps.
 * Application default dial reference when no history exists (not a manufacturer setting).
 * Numeric recommendations use per-user empirical learning when comparable shot evidence is reliable.
 */

export const NICHE_ZERO_GRINDER_ID = 'Niche Zero';

export const NICHE_ZERO_DIAL_MIN = 0;
export const NICHE_ZERO_DIAL_MAX = 50;
/** Typical espresso dial range per Niche guidance; not enforced — calibration varies by coffee. */
export const NICHE_ZERO_ESPRESSO_TYPICAL_MIN = 10;
export const NICHE_ZERO_ESPRESSO_TYPICAL_MAX = 20;
/** App default espresso starting reference when no eligible history exists (not a manufacturer optimum). */
export const NICHE_ZERO_DEFAULT_SETTING = 15;
/** CSV import / restore: accept recorded dial values outside the default product range. */
export const NICHE_ZERO_IMPORT_ABS_MIN = -99;
export const NICHE_ZERO_IMPORT_ABS_MAX = 150;

function finiteOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Optional dial calibration from global settings (legacy records without these fields behave as 0–50).
 * @param {object|null|undefined} settings
 * @returns {{ min: number, max: number, hasCalibration: boolean }}
 */
export function getNicheZeroDialLimits(settings = null) {
  const minOverride = finiteOptionalNumber(settings?.nicheZeroDialMin);
  const maxOverride = finiteOptionalNumber(settings?.nicheZeroDialMax);
  const zeroOffset = finiteOptionalNumber(settings?.nicheZeroDialZeroOffset);

  const hasCalibration =
    minOverride !== null || maxOverride !== null || zeroOffset !== null;

  if (!hasCalibration) {
    return { min: NICHE_ZERO_DIAL_MIN, max: NICHE_ZERO_DIAL_MAX, hasCalibration: false };
  }

  let min = minOverride ?? NICHE_ZERO_DIAL_MIN;
  let max = maxOverride ?? NICHE_ZERO_DIAL_MAX;

  if (zeroOffset !== null) {
    if (zeroOffset < 0) {
      min = Math.min(min, zeroOffset);
      max = Math.max(max, NICHE_ZERO_DIAL_MAX - zeroOffset);
    } else if (zeroOffset > 0) {
      max = Math.max(max, NICHE_ZERO_DIAL_MAX + zeroOffset);
    }
  }

  if (max <= min) {
    return { min: NICHE_ZERO_DIAL_MIN, max: NICHE_ZERO_DIAL_MAX, hasCalibration: false };
  }

  return { min, max, hasCalibration: true };
}

export function parseNicheZeroSettingForImport(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).trim());
  if (!Number.isFinite(n)) return null;
  if (n < NICHE_ZERO_IMPORT_ABS_MIN || n > NICHE_ZERO_IMPORT_ABS_MAX) return null;
  return Math.round(n * 10) / 10;
}

export function settingsHasNicheDialCalibration(settings = null) {
  return (
    finiteOptionalNumber(settings?.nicheZeroDialZeroOffset) !== null
    || finiteOptionalNumber(settings?.nicheZeroDialMin) !== null
    || finiteOptionalNumber(settings?.nicheZeroDialMax) !== null
  );
}

/**
 * Infer zero offset from imported shot dial values (e.g. -5..55 → offset -5).
 * @param {number[]} values
 * @returns {number|null}
 */
export function inferNicheZeroDialZeroOffsetFromValues(values) {
  const nums = (values || []).map((v) => Number(v)).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const below = min < NICHE_ZERO_DIAL_MIN;
  const above = max > NICHE_ZERO_DIAL_MAX;
  if (!below && !above) return null;
  if (below && above) {
    const negExtent = NICHE_ZERO_DIAL_MIN - min;
    const posExtent = max - NICHE_ZERO_DIAL_MAX;
    if (Math.abs(negExtent - posExtent) <= 0.15) {
      return Math.round(min * 10) / 10;
    }
    return min < 0 ? Math.round(min * 10) / 10 : Math.round((max - NICHE_ZERO_DIAL_MAX) * 10) / 10;
  }
  if (below) return Math.round(min * 10) / 10;
  return Math.round((max - NICHE_ZERO_DIAL_MAX) * 10) / 10;
}

export function parseNicheZeroSetting(value, settings = null) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).trim());
  if (!Number.isFinite(n)) return null;
  const { min, max } = getNicheZeroDialLimits(settings);
  if (n < min || n > max) return null;
  return Math.round(n * 10) / 10;
}

export function formatNicheZeroSetting(value, settings = null) {
  const parsed = parseNicheZeroSetting(value, settings);
  if (parsed === null) return '';
  return parsed % 1 === 0 ? String(parsed) : String(parsed);
}

/** Step the dial reference by one UI tick (0.1), clamped to the calibrated range. */
export function adjustNicheZero(currentSetting, stepShift, settings = null) {
  const { min, max } = getNicheZeroDialLimits(settings);
  const base = parseNicheZeroSetting(currentSetting, settings) ?? NICHE_ZERO_DEFAULT_SETTING;
  const next = Math.round((base + stepShift * 0.1) * 10) / 10;
  return Math.min(max, Math.max(min, next));
}

export function formatNicheZeroDialRangeLabel(settings = null) {
  const { min, max, hasCalibration } = getNicheZeroDialLimits(settings);
  if (!hasCalibration) {
    return 'Dial reference (0–50, stepless)';
  }
  const minLabel = min % 1 === 0 ? String(min) : String(min);
  const maxLabel = max % 1 === 0 ? String(max) : String(max);
  return `Dial reference (${minLabel}–${maxLabel}, stepless)`;
}

export function clampNicheZeroDial(value, settings = null) {
  const { min, max } = getNicheZeroDialLimits(settings);
  const n = typeof value === 'number' ? value : parseFloat(String(value).trim());
  if (!Number.isFinite(n)) {
    const parsed = parseNicheZeroSetting(value, settings);
    return parsed ?? NICHE_ZERO_DEFAULT_SETTING;
  }
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
}
