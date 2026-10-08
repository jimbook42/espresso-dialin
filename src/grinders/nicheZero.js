/**
 * Niche Zero dial reference (stepless between markings).
 * Product dial is commonly marked ~0 (finest) through ~50 (coarsest); numbers are reference positions, not calibrated steps.
 * No defensible seconds-per-mark sensitivity exists in this app — quantitative recommendations are disabled.
 */

export const NICHE_ZERO_GRINDER_ID = 'Niche Zero';

export const NICHE_ZERO_DIAL_MIN = 0;
export const NICHE_ZERO_DIAL_MAX = 50;
export const NICHE_ZERO_DEFAULT_SETTING = 15;

export function parseNicheZeroSetting(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).trim());
  if (!Number.isFinite(n)) return null;
  if (n < NICHE_ZERO_DIAL_MIN || n > NICHE_ZERO_DIAL_MAX) return null;
  return Math.round(n * 10) / 10;
}

export function formatNicheZeroSetting(value) {
  const parsed = parseNicheZeroSetting(value);
  if (parsed === null) return '';
  return parsed % 1 === 0 ? String(parsed) : String(parsed);
}
