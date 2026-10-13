/** Build-time gate for Timemore BLE scale integration (defaults off). */
export function isScaleEnabledFromEnv(raw) {
  return raw === 'true';
}

export function isScaleEnabled() {
  return isScaleEnabledFromEnv(import.meta.env.VITE_ENABLE_SCALE);
}

/** Simulated scale transport is available in local dev or when preview sets VITE_SCALE_ALLOW_SIM. */
export function isScaleSimPickerEnabled() {
  if (!isScaleEnabled()) return false;
  if (import.meta.env.DEV) return true;
  return import.meta.env.VITE_SCALE_ALLOW_SIM === 'true';
}
