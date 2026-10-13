/**
 * Timemore BLE scale integration ships enabled in production builds.
 * Set VITE_ENABLE_SCALE=false at build time to omit scale UI (rare).
 */
export function isScaleEnabledFromEnv(raw) {
  if (raw === 'false') return false;
  return true;
}

export function isScaleEnabled() {
  return isScaleEnabledFromEnv(import.meta.env.VITE_ENABLE_SCALE);
}

/**
 * Simulated scale transport is dev/QA only — never in default production builds.
 * Preview: npm run build:scale && npm run preview:scale (sets VITE_SCALE_ALLOW_SIM).
 */
export function isScaleSimPickerEnabled() {
  if (!isScaleEnabled()) return false;
  if (import.meta.env.DEV) return true;
  return import.meta.env.VITE_SCALE_ALLOW_SIM === 'true';
}
