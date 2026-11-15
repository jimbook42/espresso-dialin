import { SCALE_FLOW_MAX_SAMPLE_GAP_S } from './flowMetrics.js';

export const DISPLAY_FLOW_WINDOW_S = 0.75;
const MIN_SPAN_S = 0.4;
const SCALE_STEP_G = 0.1;
const EPSILON = 1e-9;

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
