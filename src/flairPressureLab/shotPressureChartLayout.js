/**
 * Y-axis ceiling for the live shot pressure chart (recipe peak, not auto-normalised to live bar).
 *
 * @param {{
 *   chartMaxBar?: number | null,
 *   sampleBars: number[],
 *   goalBars: number[],
 * }} input
 */
export function shotPressureChartYMax({ chartMaxBar, sampleBars, goalBars }) {
  const fromRecipe =
    chartMaxBar != null && Number.isFinite(chartMaxBar) && chartMaxBar > 0
      ? chartMaxBar
      : null;
  const liveMax = sampleBars.length ? Math.max(...sampleBars) : 0;
  const goalMax = goalBars.length ? Math.max(...goalBars) : 0;
  if (fromRecipe != null) {
    return Math.max(fromRecipe, liveMax, goalMax, 1);
  }
  return Math.max(liveMax, goalMax, 1);
}

/**
 * @param {number} bar
 * @param {number} yMax
 * @param {number} padT
 * @param {number} chartH
 */
export function shotPressureChartY(bar, yMax, padT, chartH) {
  const clamped = Math.max(0, Math.min(bar, yMax));
  return padT + chartH - (clamped / yMax) * chartH;
}
