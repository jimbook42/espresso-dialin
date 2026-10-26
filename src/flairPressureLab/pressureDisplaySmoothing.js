/** Rolling window for live bar readout (display only — raw samples stay unsmoothed). */
export const PRESSURE_DISPLAY_WINDOW_S = 1.0;

/**
 * Plot-time lead for saved/history pressure vs scale flow (seconds earlier on the time axis).
 * History used a 1 s trailing mean (~0.5 s lag on rises); zero-phase smoothing removes most of that.
 * Residual 0.35 s covers shot-lab frame cadence (125 ms) plus gated publish vs scale timestamps.
 */
export const LAB_PRESSURE_CURVE_LEAD_S = 0.35;

/**
 * @typedef {{ tS: number, bar: number, confident?: boolean }} LabPressureRawSample
 */

/**
 * @param {LabPressureRawSample[]} samples
 * @param {number} nowS
 * @param {number} [windowS]
 */
export function rollingDisplayBar(samples, nowS, windowS = PRESSURE_DISPLAY_WINDOW_S) {
  if (!samples?.length || nowS == null) return null;
  const cutoff = nowS - windowS;
  const inWindow = samples.filter(
    (s) => s.bar != null && Number.isFinite(s.bar) && s.tS >= cutoff && s.tS <= nowS
  );
  if (!inWindow.length) return null;
  const sum = inWindow.reduce((acc, s) => acc + s.bar, 0);
  return sum / inWindow.length;
}

/**
 * Centered rolling mean (zero-phase) for history/saved curves only.
 * @param {LabPressureRawSample[]} samples
 * @param {number} centerTS
 * @param {number} [windowS]
 */
export function rollingCenteredBar(samples, centerTS, windowS = PRESSURE_DISPLAY_WINDOW_S) {
  if (!samples?.length || centerTS == null) return null;
  const half = windowS / 2;
  const low = centerTS - half;
  const high = centerTS + half;
  const inWindow = samples.filter(
    (s) => s.bar != null && Number.isFinite(s.bar) && s.tS >= low && s.tS <= high
  );
  if (!inWindow.length) return null;
  const sum = inWindow.reduce((acc, s) => acc + s.bar, 0);
  return sum / inWindow.length;
}

/** @param {number} tS */
export function labPressureCurvePlotTimeS(tS) {
  if (tS == null || !Number.isFinite(tS)) return tS;
  return Math.max(0, tS - LAB_PRESSURE_CURVE_LEAD_S);
}

/**
 * Peak from raw confident samples only.
 * @param {LabPressureRawSample[]} samples
 */
export function peakBarFromRaw(samples) {
  if (!samples?.length) return null;
  let peak = null;
  for (const s of samples) {
    if (s.bar == null || !Number.isFinite(s.bar)) continue;
    if (s.confident === false) continue;
    peak = peak == null ? s.bar : Math.max(peak, s.bar);
  }
  return peak;
}

/**
 * Chart points from raw samples; null bar breaks the line (gap).
 * @param {LabPressureRawSample[]} samples
 */
export function pressureChartPointsFromRaw(samples) {
  if (!samples?.length) return [];
  return samples
    .filter((s) => s.bar != null && Number.isFinite(s.bar))
    .map((s) => ({ tS: s.tS, bar: s.bar, dim: s.confident === false }));
}

/**
 * Display-only smoothed pressure curve (same window as live bar readout).
 * @param {LabPressureRawSample[]} samples
 * @param {number} [windowS]
 */
export function pressureChartPointsForDisplay(samples, windowS = PRESSURE_DISPLAY_WINDOW_S) {
  if (!samples?.length) return [];
  return samples
    .filter((s) => s.bar != null && Number.isFinite(s.bar))
    .map((s) => ({
      tS: s.tS,
      bar: rollingDisplayBar(samples, s.tS, windowS) ?? s.bar,
      dim: s.confident === false,
    }));
}

/**
 * Saved labPressureCurve on History charts: zero-phase smoothing + plot-time lead (raw DB unchanged).
 * @param {LabPressureRawSample[]} samples
 * @param {number} [windowS]
 */
export function pressureChartPointsForSavedCurve(samples, windowS = PRESSURE_DISPLAY_WINDOW_S) {
  if (!samples?.length) return [];
  return samples
    .filter((s) => s.bar != null && Number.isFinite(s.bar))
    .map((s) => ({
      tS: labPressureCurvePlotTimeS(s.tS),
      bar: rollingCenteredBar(samples, s.tS, windowS) ?? s.bar,
      dim: s.confident === false,
    }));
}

/**
 * @param {number | null} displayBar
 * @param {{ held: boolean, gap: boolean }} hold
 */
export function labPressureReadoutState(displayBar, hold) {
  if (hold.gap && displayBar == null) {
    return { text: '—', dim: true, gap: true };
  }
  if (displayBar == null) {
    return { text: '—', dim: true, gap: true };
  }
  return {
    text: displayBar.toFixed(1),
    dim: hold.held === true,
    gap: false,
  };
}
