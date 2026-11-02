import { createPressureCurveFilter, PRESSURE_CURVE_GAP_MS } from './pressureCurveFilter.js';

/** Legacy window constant (callers may still import it); causal filter below (display only — raw samples stay unsmoothed). */
export const PRESSURE_DISPLAY_WINDOW_S = 1.0;

/**
 * Plot-time lead for saved/history pressure vs scale flow (seconds earlier on the time axis).
 * Historical alignment offset vs scale flow; independent of the causal filter.
 * Residual 0.35 s covers shot-lab frame cadence (125 ms) plus gated publish vs scale timestamps.
 */
export const LAB_PRESSURE_CURVE_LEAD_S = 0.35;

/**
 * @typedef {{ tS: number, bar: number | null, confident?: boolean, reset?: boolean }} LabPressureRawSample
 */

/**
 * @param {LabPressureRawSample[]} samples
 * @param {number} nowS
 */
export function rollingDisplayBar(samples, nowS) {
  if (!samples?.length || !Number.isFinite(nowS)) return null;
  const filter = createPressureCurveFilter();
  let bar = null, lastTS = null;
  for (const sample of samples) {
    if (sample.tS > nowS) break;
    bar = filter.step(sample.bar, sample.tS * 1000, sample.reset === true);
    lastTS = sample.tS;
  }
  return lastTS != null && (nowS - lastTS) * 1000 <= PRESSURE_CURVE_GAP_MS ? bar : null;
}

/**
 * Legacy centered-mean helper; current charts use the causal filter below.
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
 * Display-only causal pressure curve, shared by live readout and History.
 * @param {LabPressureRawSample[]} samples
 */
export function pressureChartPointsForDisplay(samples) {
  const filter = createPressureCurveFilter();
  const points = [];
  let previousTS = null, gap = true;
  for (const sample of samples ?? []) {
    const bar = filter.step(sample.bar, sample.tS * 1000, sample.reset === true);
    if (bar == null) { gap = true; continue; }
    const breakBefore = gap || (previousTS != null
      && (sample.tS - previousTS) * 1000 > PRESSURE_CURVE_GAP_MS);
    points.push({ tS: sample.tS, bar, dim: sample.confident === false, breakBefore });
    previousTS = sample.tS;
    gap = false;
  }
  return points;
}

/**
 * Saved labPressureCurve: same causal filter + existing plot-time alignment (raw DB unchanged).
 * @param {LabPressureRawSample[]} samples
 */
export function pressureChartPointsForSavedCurve(samples) {
  return pressureChartPointsForDisplay(samples).map(point => ({
    ...point, tS: labPressureCurvePlotTimeS(point.tS),
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
