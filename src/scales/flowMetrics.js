/**
 * Derive flow rate samples from weight time series (not used for grind learning).
 */

/** ~1–1.5 s time constant for plotted flow curves (live + history). */
export const FLOW_PLOT_SMOOTH_WINDOW_S = 1.75;
export const SCALE_FLOW_MAX_SAMPLE_GAP_S = 0.5;

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
  if (windowS <= 0) return series.map((p) => ({ ...p }));

  const out = [];
  let ema = series[0].flowGs;
  out.push({ tS: series[0].tS, flowGs: ema });
  for (let i = 1; i < series.length; i += 1) {
    const { tS, flowGs, breakBefore } = series[i];
    if (breakBefore) {
      ema = flowGs;
      out.push({ tS, flowGs, breakBefore });
      continue;
    }
    const dt = Math.max(0, tS - series[i - 1].tS);
    const alpha = 1 - Math.exp(-dt / windowS);
    ema = alpha * flowGs + (1 - alpha) * ema;
    out.push({ tS, flowGs: ema });
  }
  return out;
}

/**
 * Running EMA state for one new flow sample at a time.
 * Same recurrence as smoothFlowSeriesForPlot when maxDtS is not capping.
 *
 * @typedef {{ ema: number | null, lastTS: number | null }} FlowEmaState
 */

export function createFlowEmaState() {
  return { ema: null, lastTS: null };
}

/**
 * @param {FlowEmaState} state
 * @param {{ tS: number, flowGs: number }} sample
 * @param {number} windowS
 * @param {number} [maxDtS] cap the integrated gap so a missed notify is not a long observed flow
 * @returns {FlowEmaState}
 */
export function stepFlowEma(state, sample, windowS, maxDtS = Infinity) {
  if (state?.ema == null || state.lastTS == null) {
    return { ema: sample.flowGs, lastTS: sample.tS };
  }
  let dt = Math.max(0, sample.tS - state.lastTS);
  if (Number.isFinite(maxDtS) && maxDtS > 0 && dt > maxDtS) dt = maxDtS;
  if (!(windowS > 0)) {
    return { ema: sample.flowGs, lastTS: sample.tS };
  }
  const alpha = 1 - Math.exp(-dt / windowS);
  return {
    ema: alpha * sample.flowGs + (1 - alpha) * state.ema,
    lastTS: sample.tS,
  };
}

/**
 * Flow rate series from stored weight-vs-time curve, smoothed for display.
 *
 * @param {{ tS: number, weightG: number }[]} weightCurve
 * @param {number} [windowS]
 * @param {number} [maxGapS]
 * @returns {{ tS: number, flowGs: number }[]}
 */
export function flowRateSeriesFromWeightCurve(weightCurve, windowS = FLOW_PLOT_SMOOTH_WINDOW_S, maxGapS = Infinity) {
  if (!weightCurve?.length) return [];
  const raw = [];
  let breakBefore = false;
  for (let i = 1; i < weightCurve.length; i += 1) {
    const prev = weightCurve[i - 1];
    const next = weightCurve[i];
    if (next.tS - prev.tS > maxGapS) {
      breakBefore = raw.length > 0;
      continue;
    }
    const flow = instantaneousFlowGs(prev, next);
    if (flow == null || !Number.isFinite(flow)) continue;
    raw.push({ tS: next.tS, flowGs: Math.max(0, flow), ...(breakBefore ? { breakBefore } : {}) });
    breakBefore = false;
  }
  return smoothFlowSeriesForPlot(raw, windowS);
}
