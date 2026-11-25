import { SCALE_FLOW_MAX_SAMPLE_GAP_S } from './flowMetrics.js';

export const DISPLAY_FLOW_WINDOW_S = 0.75;
export const LIVE_SMOOTH_FLOW_WINDOW_S = 1;
export const SAVED_SMOOTH_FLOW_WINDOW_S = 1.5;
const MIN_SPAN_S = 0.4;
const SCALE_STEP_G = 0.1;
const EPSILON = 1e-9;

// Saved charts use net mass over elapsed time, with at least 200 ms of support.
// At 0.1 g resolution, one count over 200 ms is 0.5 g/s instead of 100 g/s over 1 ms.
const PLOT_MIN_SPAN_S = 0.2;
const PLOT_WINDOW_S = 0.5;

function startsRun(previous, point) {
  return point.breakBefore || point.reset || (previous
    && point.tS - previous.tS > SCALE_FLOW_MAX_SAMPLE_GAP_S + EPSILON);
}

function validObservation(point) {
  return Number.isFinite(point?.tS) && point.tS >= 0 && Number.isFinite(point.weightG)
    && !point.gap && point.confident !== false;
}

function disturbed(previous, point) {
  return previous && previous.weightG - point.weightG > SCALE_STEP_G + EPSILON;
}

function* weightRuns(weights, startS, endS) {
  const observations = [];
  let broken = true;
  for (const point of weights) {
    if (!validObservation(point)) {
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

  let run = [];
  for (const point of observations) {
    if (point.tS < startS - EPSILON || point.tS > endS + EPSILON) continue;
    const last = run.at(-1);
    const boundary = startsRun(last, point);
    const drop = !boundary && disturbed(last, point);
    if (boundary || drop) {
      if (run.length) yield run;
      run = [];
    }
    // The rebound after a cup disturbance becomes the next anchor.
    if (!drop) run.push(point);
  }
  if (run.length) yield run;
}

function detailSlope(first, last) {
  const span = last.tS - first.tS;
  return span >= PLOT_MIN_SPAN_S - EPSILON ? (last.weightG - first.weightG) / span : null;
}

// Integrate the regression moments over observed intervals, with weight changing
// linearly inside each interval. Bursts occupy little time and have less influence.
// The fit creates no additional plotted observations and is applied within a run.
function timeWeightedSlope(points, start, end) {
  if (end - start < 2 || points[end].tS - points[start].tS < MIN_SPAN_S - EPSILON) return null;
  const first = points[start];
  let duration = 0;
  let sumT = 0;
  let sumW = 0;
  let sumTT = 0;
  let sumTW = 0;
  for (let index = start + 1; index <= end; index += 1) {
    const point = points[index];
    const previous = points[index - 1];
    const seconds = point.tS - previous.tS;
    const t = (point.tS + previous.tS) / 2 - first.tS;
    const w = (point.weightG + previous.weightG) / 2 - first.weightG;
    duration += seconds;
    sumT += seconds * t;
    sumW += seconds * w;
    sumTT += seconds * (t * t + seconds ** 2 / 12);
    sumTW += seconds * (t * w + seconds * (point.weightG - previous.weightG) / 12);
  }
  const slope = (sumTW - sumT * sumW / duration) / (sumTT - sumT * sumT / duration);
  return !Number.isFinite(slope) || slope < -EPSILON ? null : Math.max(0, slope);
}

function plotRun(run, centredWindowS) {
  const flow = [];
  let start = 0;
  let end = 0;
  let breakBefore = true;
  const halfWindow = centredWindowS / 2;
  for (let i = 0; i < run.length; i += 1) {
    const { tS } = run[i];
    while (tS - run[start].tS > (halfWindow || PLOT_WINDOW_S) + EPSILON) start += 1;
    while (centredWindowS && end + 1 < run.length && run[end + 1].tS - tS <= halfWindow + EPSILON) end += 1;
    const slope = centredWindowS ? timeWeightedSlope(run, start, end) : detailSlope(run[start], run[i]);
    if (Number.isFinite(slope)) flow.push({ tS, flowGs: slope, breakBefore });
    breakBefore = !Number.isFinite(slope);
  }
  return flow;
}

export function plottedFlowFromWeights(weights, startS = -Infinity, endS = Infinity, centredWindowS = 0) {
  const flow = [];
  for (const run of weightRuns(weights, startS, endS)) {
    const points = plotRun(run, centredWindowS);
    // A short recording can support a detailed change without enough points for a fit.
    for (const point of centredWindowS && !points.length ? plotRun(run, 0) : points) flow.push(point);
  }
  return flow;
}

/** Run both display modes without touching the recording or the raw flow stream. */
export function createLiveFlowDisplay(windowS = LIVE_SMOOTH_FLOW_WINDOW_S) {
  let samples = [];
  let latestTime = -Infinity;
  let smoothBreak = true;
  let detailBreak = true;
  const breakRun = () => {
    samples = [];
    smoothBreak = true;
    detailBreak = true;
  };
  const interrupt = () => {
    latestTime = -Infinity;
    breakRun();
  };
  function add(point) {
    const tS = point?.tS;
    const previous = samples.at(-1);
    if (!validObservation(point) || tS < latestTime) {
      breakRun();
      return { smooth: null, detail: null };
    }
    latestTime = tS;
    const boundary = startsRun(previous, point);
    const drop = !boundary && disturbed(previous, point);
    if (boundary || drop) breakRun();
    if (drop) return { smooth: null, detail: null };
    if (samples.at(-1)?.tS === tS) samples[samples.length - 1] = point;
    else samples.push(point);
    while (tS - samples[0].tS > windowS + EPSILON) samples.shift();
    const first = samples.find((sample) => tS - sample.tS <= PLOT_WINDOW_S + EPSILON);
    const detail = detailSlope(first, point);
    const smooth = timeWeightedSlope(samples, 0, samples.length - 1);
    const result = {
      smooth: smooth == null ? null : { tS, flowGs: smooth, ...(smoothBreak ? { breakBefore: true } : {}) },
      detail: !Number.isFinite(detail) ? null : { tS, flowGs: detail, ...(detailBreak ? { breakBefore: true } : {}) },
    };
    smoothBreak = result.smooth == null;
    detailBreak = result.detail == null;
    return result;
  }
  return { add, interrupt };
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
