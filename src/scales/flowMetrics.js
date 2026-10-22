/**
 * Derive flow rate samples from weight time series (not used for grind learning).
 */

/** ~1–1.5 s time constant for plotted flow curves (live + history). */
export const FLOW_PLOT_SMOOTH_WINDOW_S = 1.25;

/**
 * @typedef {{ tS: number, weightG: number }} ScaleFlowSample
 */

/**
 * @param {ScaleFlowSample[]} samples
 * @returns {{ flowCurve: ScaleFlowSample[], averageFlowRateGs: number | null }}
 */
export function summarizeScaleFlow(samples) {
  if (!samples?.length) {
    return { flowCurve: [], averageFlowRateGs: null };
  }
  const flowCurve = samples.map((s) => ({ tS: s.tS, weightG: s.weightG }));
  if (samples.length < 2) {
    return { flowCurve, averageFlowRateGs: null };
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = last.tS - first.tS;
  if (dt <= 0) return { flowCurve, averageFlowRateGs: null };
  const dw = last.weightG - first.weightG;
  const averageFlowRateGs = dw / dt;
  return { flowCurve, averageFlowRateGs: Number.isFinite(averageFlowRateGs) ? averageFlowRateGs : null };
}

/**
 * Instantaneous flow from the last two samples (g/s).
 * @param {ScaleFlowSample | null} prev
 * @param {ScaleFlowSample} next
 */
export function instantaneousFlowGs(prev, next) {
  if (!prev) return null;
  const dt = next.tS - prev.tS;
  if (dt <= 0) return null;
  return (next.weightG - prev.weightG) / dt;
}

/**
 * Time-weighted EMA smoothing for plotted flow (g/s).
 *
 * @param {{ tS: number, flowGs: number }[]} series
 * @param {number} [windowS]
 * @returns {{ tS: number, flowGs: number }[]}
 */
export function smoothFlowSeriesForPlot(series, windowS = FLOW_PLOT_SMOOTH_WINDOW_S) {
  if (!series?.length) return [];
  if (windowS <= 0) return series.map((p) => ({ tS: p.tS, flowGs: p.flowGs }));

  const out = [];
  let ema = series[0].flowGs;
  out.push({ tS: series[0].tS, flowGs: ema });
  for (let i = 1; i < series.length; i += 1) {
    const dt = Math.max(0, series[i].tS - series[i - 1].tS);
    const alpha = 1 - Math.exp(-dt / windowS);
    ema = alpha * series[i].flowGs + (1 - alpha) * ema;
    out.push({ tS: series[i].tS, flowGs: ema });
  }
  return out;
}

/**
 * Flow rate series from stored weight-vs-time curve, smoothed for display.
 *
 * @param {{ tS: number, weightG: number }[]} weightCurve
 * @param {number} [windowS]
 * @returns {{ tS: number, flowGs: number }[]}
 */
export function flowRateSeriesFromWeightCurve(weightCurve, windowS = FLOW_PLOT_SMOOTH_WINDOW_S) {
  if (!weightCurve?.length) return [];
  const raw = [];
  for (let i = 1; i < weightCurve.length; i += 1) {
    const prev = weightCurve[i - 1];
    const next = weightCurve[i];
    const flow = instantaneousFlowGs(prev, next);
    if (flow == null || !Number.isFinite(flow)) continue;
    raw.push({ tS: next.tS, flowGs: Math.max(0, flow) });
  }
  return smoothFlowSeriesForPlot(raw, windowS);
}
