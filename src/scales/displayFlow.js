import { SCALE_FLOW_MAX_SAMPLE_GAP_S } from './flowMetrics.js';

export const DISPLAY_FLOW_WINDOW_S = 0.75;
const MIN_SPAN_S = 0.4;
const SCALE_STEP_G = 0.1;
const EPSILON = 1e-9;

// Saved charts use net mass over elapsed time, with at least 200 ms of support.
// At 0.1 g resolution, one count over 200 ms is 0.5 g/s instead of 100 g/s over 1 ms.
const PLOT_MIN_SPAN_S = 0.2;
const PLOT_WINDOW_S = 0.5;

export function plottedFlowFromWeights(weights, startS = -Infinity, endS = Infinity) {
  const observations = [];
  let broken = true;
  for (const point of weights) {
    if (!Number.isFinite(point?.tS) || point.tS < 0 || !Number.isFinite(point.weightG) || point.confident === false) {
      broken = true;
      continue;
    }
    const last = observations.at(-1);
    if (last && point.tS < last.tS) {
      broken = true;
      continue;
    }
    if (last && point.tS === last.tS) {
      // Use the last received weight for this clock instant in the display only.
      observations[observations.length - 1] = { ...point, breakBefore: last.breakBefore || broken || point.breakBefore || point.reset };
    } else {
      observations.push({ ...point, breakBefore: broken || point.breakBefore || point.reset });
    }
    broken = false;
  }

  const flow = [];
  let window = [];
  let breakBefore = true;
  for (const point of observations) {
    if (point.tS < startS - EPSILON || point.tS > endS + EPSILON) continue;
    const last = window.at(-1);
    if (point.breakBefore || (last && point.tS - last.tS > SCALE_FLOW_MAX_SAMPLE_GAP_S + EPSILON)) {
      window = [];
      breakBefore = true;
    } else if (last && last.weightG - point.weightG > SCALE_STEP_G + EPSILON) {
      // Discard the falling observation from the plot window so its rebound
      // cannot be counted as newly added mass.
      window = [];
      breakBefore = true;
      continue;
    }
    window.push(point);
    while (point.tS - window[0].tS > PLOT_WINDOW_S + EPSILON) window.shift();
    const span = point.tS - window[0].tS;
    if (span < PLOT_MIN_SPAN_S - EPSILON) continue;
    const flowGs = (point.weightG - window[0].weightG) / span;
    if (!Number.isFinite(flowGs)) continue;
    flow.push({ tS: point.tS, flowGs, breakBefore });
    breakBefore = false;
  }
  return flow;
}

/** Estimate live flow from received weights without changing their timestamps. */
export function createDisplayFlowEstimator(windowS = DISPLAY_FLOW_WINDOW_S) {
  let samples = [];
  let breakBefore = false;

  function interrupt() {
    samples = [];
    breakBefore = true;
  }

  function add(sample) {
    const { tS, weightG } = sample;
    if (!Number.isFinite(tS) || !Number.isFinite(weightG)) {
      interrupt();
      return null;
    }
    const last = samples.at(-1);
    if (last && (tS < last.tS || tS - last.tS > SCALE_FLOW_MAX_SAMPLE_GAP_S + EPSILON)) {
      interrupt();
    } else if (last && last.weightG - weightG > SCALE_STEP_G + EPSILON) {
      // A drop larger than one scale count can be a cup disturbance or tare.
      // Start again with the next observation so the depressed value and its rebound
      // cannot look like a rapid pour.
      interrupt();
      return null;
    }

    // All weights in a burst contribute, including those with identical timestamps.
    samples.push(sample);
    samples = samples.filter((point) => tS - point.tS <= windowS + EPSILON);
    const first = samples[0];
    if (samples.length < 3 || tS - first.tS < MIN_SPAN_S - EPSILON) {
      breakBefore = true;
      return null;
    }

    const n = samples.length;
    let sumT = 0;
    let sumW = 0;
    let sumTT = 0;
    let sumTW = 0;
    for (const point of samples) {
      const t = point.tS - first.tS;
      const w = point.weightG - first.weightG;
      sumT += t;
      sumW += w;
      sumTT += t * t;
      sumTW += t * w;
    }
    const slope = (sumTW - sumT * sumW / n) / (sumTT - sumT * sumT / n);
    // Zero is an observed plateau. A falling or inconsistent fit is unavailable.
    const plateau = samples.every((point) => point.weightG === first.weightG);
    if (!Number.isFinite(slope) || (slope <= EPSILON && !plateau)) {
      breakBefore = true;
      return null;
    }
    const result = { tS, flowGs: slope > EPSILON ? slope : 0, ...(breakBefore ? { breakBefore } : {}) };
    breakBefore = false;
    return result;
  }

  return { add, interrupt };
}
