/**
 * Derive flow rate samples from weight time series (not used for grind learning).
 */

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
 * Instantaneous flow series from stored weight-vs-time curve, with light EMA smoothing (~windowS).
 *
 * @param {{ tS: number, weightG: number }[]} weightCurve
 * @param {number} [windowS]
 * @returns {{ tS: number, flowGs: number }[]}
 */
export function flowRateSeriesFromWeightCurve(weightCurve, windowS = 0.75) {
  if (!weightCurve?.length) return [];
  const raw = [];
  for (let i = 1; i < weightCurve.length; i += 1) {
    const prev = weightCurve[i - 1];
    const next = weightCurve[i];
    const flow = instantaneousFlowGs(prev, next);
    if (flow == null || !Number.isFinite(flow)) continue;
    raw.push({ tS: next.tS, flowGs: Math.max(0, flow) });
  }
  if (!raw.length) return [];

  const alpha = windowS > 0 ? Math.min(1, 0.35 / windowS) : 1;
  let ema = raw[0].flowGs;
  return raw.map((point, index) => {
    if (index === 0) return { tS: point.tS, flowGs: ema };
    ema = alpha * point.flowGs + (1 - alpha) * ema;
    return { tS: point.tS, flowGs: ema };
  });
}
