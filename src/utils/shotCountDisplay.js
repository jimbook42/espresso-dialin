/** User-facing count with correct shot/shots pluralisation. */
export function formatShotCount(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0) return '0 shots';
  if (n === 1) return '1 shot';
  return `${n} shots`;
}

/** "Based on N recent shot(s) with this recipe" */
export function formatRecentRecipeShotEvidence(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n === 1) return 'Based on 1 recent shot with this recipe';
  return `Based on ${n} recent shots with this recipe`;
}
