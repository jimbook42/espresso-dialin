/** Build-time gate for the in-progress Flair pressure lab (defaults off). */
export function isPressureLabEnabledFromEnv(raw) {
  return raw === 'true';
}

export function isPressureLabEnabled() {
  return isPressureLabEnabledFromEnv(import.meta.env.VITE_ENABLE_PRESSURE_LAB);
}
