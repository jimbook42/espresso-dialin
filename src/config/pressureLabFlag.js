/** Build-time gate for the in-progress Flair pressure lab (defaults off). */
export function isPressureLabEnabledFromEnv(raw) {
  return raw === 'true';
}

/** Preview-only branch (qa/6-35-pressure-preview): lab always on; do not merge to main. */
export function isPressureLabEnabled() {
  return true;
}
