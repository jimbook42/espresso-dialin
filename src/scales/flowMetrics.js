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
