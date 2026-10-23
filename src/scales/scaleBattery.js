/**
 * @param {unknown} value
 * @returns {number | null} 0–100 when valid, otherwise null
 */
export function normalizeBatteryPercent(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

/**
 * @param {unknown} batteryPercent
 * @returns {string}
 */
export function formatScaleConnectionLabel(batteryPercent) {
  const n = normalizeBatteryPercent(batteryPercent);
  if (n == null) return 'Scale on';
  return `Scale ${Math.round(n)}%`;
}
