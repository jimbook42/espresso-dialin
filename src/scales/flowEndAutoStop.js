import {
  createFlowEmaState,
  FLOW_PLOT_SMOOTH_WINDOW_S,
  SCALE_FLOW_MAX_SAMPLE_GAP_S,
  stepFlowEma,
} from './flowMetrics.js';

/** Minimum smoothed flow (g/s) before auto-stop can arm after pre-infusion. */
export const FLOW_AUTO_STOP_ARM_MIN_GS = 1;

/** End shot when smoothed flow falls below this fraction of peak smoothed flow (current algorithm). */
export const FLOW_AUTO_STOP_PEAK_END_FRACTION = 0.375;

/** Legacy end fraction (tail-off detection). */
export const FLOW_AUTO_STOP_PEAK_END_FRACTION_LEGACY = 0.2;

/** Legacy cap on end threshold (g/s); end uses min(peak × fraction, this value). */
export const FLOW_AUTO_STOP_END_ABS_MAX_GS = 0.3;

/** Smoothed flow must stay below the end threshold for this long (s). */
export const FLOW_AUTO_STOP_CONFIRM_S = 1.5;

/** Less-smoothed flow window (s) for backdating the recorded end to the start of the drop. */
export const FLOW_AUTO_STOP_BACKDATE_SMOOTH_WINDOW_S = 0.45;

/**
 * Notify gap (s) that is a missed BLE packet, not an observed plateau or a
 * long stretch of zero flow. Live and sim scales notify near 10 Hz; 0.5 s is
 * several dropped packets, while normal jitter stays under it.
 */
export const FLOW_AUTO_STOP_MAX_SAMPLE_GAP_S = SCALE_FLOW_MAX_SAMPLE_GAP_S;

/**
 * Weight gain (g) at or below one scale count. Timemore, Bookoo, and Acaia
 * quantize to 0.1 g, so a 0.1 g step is noise, not the cup still filling.
 */
export const FLOW_AUTO_STOP_PLATEAU_NOISE_G = 0.1;

/**
 * How long (s) weight must stay within noise before that flat region can
 * backdate the shot. The recorded time is the start of the flat region.
 * 0.3 s is about three 10 Hz notifies: long enough to ignore one repeated
 * reading, short enough to stay inside a 0.3 s accuracy budget.
 */
export const FLOW_AUTO_STOP_PLATEAU_HOLD_S = 0.3;

/**
 * Fast EMA must stay back above the end threshold this long (s) before the
 * early crossing is discarded. A drip spikes that EMA for a sample or two;
 * a resumed pour holds it up.
 */
export const FLOW_AUTO_STOP_FAST_RESUME_S = 0.3;

/**
 * Grams the cup must gain before a held plateau is a resumed pour.
 * 0.5 g is more than one drip blob (0.3 g) and about half a second at 1 g/s.
 */
export const FLOW_AUTO_STOP_RESUME_GAIN_G = 0.5;

/**
 * How far back (s) the resume check looks, using observed samples only.
 *
 * A 1 g/s stepped pour puts this 0.5 g inside the window. Drips of 0.3 g
 * every 0.5 s do not: the window holds one blob. A 1.5–2 s window cannot
 * make that split — those drips add about 0.9–1.2 g in that time, the same
 * test a slow pour passes — and clearing them would move the saved end off
 * the real stop. 0.5 s is the shortest window that still sees 0.5 g at 1 g/s.
 */
export const FLOW_AUTO_STOP_RESUME_WINDOW_S = 0.5;

/**
 * @typedef {{
 *   armed: boolean,
 *   peakSmoothedGs: number,
 *   recordedEndExtractionS: number | null,
 *   belowThresholdSinceS: number | null,
 *   backdateRecordedEndExtractionS: number | null,
 *   stopConfirmed: boolean,
 *   plateauStartS: number | null,
 *   plateauHeld: boolean,
 *   lastWeightT: number | null,
 *   lastWeightG: number | null,
 *   lastRiseT: number | null,
 *   flatInvalid: boolean,
 *   recentWeights: { tS: number, weightG: number }[],
 *   fastAboveSinceS: number | null,
 *   fastWasBelow: boolean,
 *   lastFlowT: number | null,
 * }} FlowEndAutoStopState
 */

export function createFlowEndAutoStopState() {
  return {
    armed: false,
    peakSmoothedGs: 0,
    recordedEndExtractionS: null,
    belowThresholdSinceS: null,
    backdateRecordedEndExtractionS: null,
    stopConfirmed: false,
    plateauStartS: null,
    plateauHeld: false,
    lastWeightT: null,
    lastWeightG: null,
    lastRiseT: null,
    flatInvalid: false,
    recentWeights: [],
    fastAboveSinceS: null,
    fastWasBelow: false,
    lastFlowT: null,
  };
}

/**
 * @param {number} peakSmoothedGs
 * @param {boolean} legacyMode
 */
export function flowEndThresholdForPeak(peakSmoothedGs, legacyMode) {
  if (legacyMode) {
    return Math.min(
      peakSmoothedGs * FLOW_AUTO_STOP_PEAK_END_FRACTION_LEGACY,
      FLOW_AUTO_STOP_END_ABS_MAX_GS,
    );
  }
  return peakSmoothedGs * FLOW_AUTO_STOP_PEAK_END_FRACTION;
}

/**
 * Saved shot time is extraction only, rounded to a whole second.
 * The on-screen timer is that extraction end, plus pre-infusion when it is on,
 * at 0.1 s resolution.
 *
 * @param {number} endExtractionS
 * @param {{ includePreInfusion?: boolean, preInfusionSeconds?: number }} [opts]
 */
export function flowEndDisplayedAndSavedTimes(endExtractionS, opts = {}) {
  const includePreInfusion = opts.includePreInfusion === true;
  const preInfusionSeconds = Number(opts.preInfusionSeconds) || 0;
  const shownS = includePreInfusion ? preInfusionSeconds + endExtractionS : endExtractionS;
  return {
    savedExtractionS: Math.round(endExtractionS),
    displayedTicks: Math.round(shownS * 10),
  };
}

/** Drop every end candidate. A resumed pour must not keep an earlier stamp. */
function clearAllEndCandidates(state) {
  state.plateauHeld = false;
  state.plateauStartS = null;
  state.backdateRecordedEndExtractionS = null;
  state.recordedEndExtractionS = null;
  state.belowThresholdSinceS = null;
}

/** Keep just enough observed weights to see the resume window. */
function rememberWeight(state, tS, weightG) {
  const cutoff = tS - FLOW_AUTO_STOP_RESUME_WINDOW_S - 0.15;
  const kept = [];
  const prev = state.recentWeights;
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i].tS >= cutoff) kept.push(prev[i]);
  }
  kept.push({ tS, weightG });
  state.recentWeights = kept;
}

/**
 * Weight at the start of the resume window. The sample on the edge counts,
 * so a drip that landed half a second ago is the baseline, not new gain.
 * Samples older than the window, including across a notify gap, are ignored.
 *
 * @param {{ tS: number, weightG: number }[]} samples
 * @param {number} tS
 */
function weightAtResumeWindowStart(samples, tS) {
  const edge = tS - FLOW_AUTO_STOP_RESUME_WINDOW_S;
  let baseline = null;
  for (let i = 0; i < samples.length; i += 1) {
    if (samples[i].tS <= edge + 1e-9) baseline = samples[i].weightG;
  }
  if (baseline != null) return baseline;
  if (samples.length > 1) return samples[0].weightG;
  return null;
}

/**
 * @param {FlowEndAutoStopState} state
 * @param {number} tS
 * @param {number} weightG
 * @returns {boolean} true when this sample is an ongoing pour, not a drip
 */
function stepWeightPlateau(state, tS, weightG) {
  const prevT = state.lastWeightT;
  const prevW = state.lastWeightG;
  state.lastWeightT = tS;
  state.lastWeightG = weightG;
  if (prevT == null || prevW == null) {
    rememberWeight(state, tS, weightG);
    return false;
  }

  const dt = tS - prevT;
  if (!(dt > 0)) return false;
  const dw = weightG - prevW;

  if (dt > FLOW_AUTO_STOP_MAX_SAMPLE_GAP_S) {
    // A gap cannot confirm a plateau. A pour-sized net gain also rules out
    // reusing the old candidate, even though its exact end was not observed.
    if (dw >= FLOW_AUTO_STOP_RESUME_GAIN_G && dw / dt >= FLOW_AUTO_STOP_ARM_MIN_GS) {
      clearAllEndCandidates(state);
      state.lastRiseT = tS;
      state.flatInvalid = false;
      rememberWeight(state, tS, weightG);
      return true;
    }
    state.flatInvalid = true;
    rememberWeight(state, tS, weightG);
    return false;
  }

  rememberWeight(state, tS, weightG);

  // Net gain over the window, not since the plateau forever. A flat sample
  // does not count: the tail of a real pour is still inside the window for
  // a few notifies after the cup stops, and that must not erase the stop.
  const baseline = weightAtResumeWindowStart(state.recentWeights, tS);
  const net = baseline == null ? 0 : weightG - baseline;
  if (dw > 1e-6 && net >= FLOW_AUTO_STOP_RESUME_GAIN_G - 1e-6) {
    clearAllEndCandidates(state);
    state.lastRiseT = tS;
    state.flatInvalid = false;
    return true;
  }

  if (dw > 1e-6) {
    if (!state.plateauHeld) {
      state.lastRiseT = tS;
      state.flatInvalid = false;
    }
    return false;
  }

  if (state.flatInvalid || state.lastRiseT == null || state.plateauHeld) return false;
  if (tS - state.lastRiseT >= FLOW_AUTO_STOP_PLATEAU_HOLD_S - 1e-6) {
    state.plateauHeld = true;
    state.plateauStartS = state.lastRiseT;
  }
  return false;
}

/** Plateau or fast-EMA crossing, whichever is earlier. Null when neither is valid. */
function candidateEndS(state) {
  let best = null;
  if (state.backdateRecordedEndExtractionS != null) best = state.backdateRecordedEndExtractionS;
  if (state.plateauHeld && state.plateauStartS != null) {
    best = best == null ? state.plateauStartS : Math.min(best, state.plateauStartS);
  }
  return best;
}

function earliestEndS(state, fallbackT) {
  const candidate = candidateEndS(state);
  if (candidate == null) return fallbackT;
  return Math.min(candidate, fallbackT);
}

/**
 * Pure state machine step for flow-end auto-stop (one tick per smoothed flow sample).
 *
 * @param {FlowEndAutoStopState} state
 * @param {{
 *   enabled: boolean,
 *   legacyMode?: boolean,
 *   preinfusionActive: boolean,
 *   extractionActive: boolean,
 *   tExtractionS: number,
 *   smoothedFlowGs: number | null,
 *   backdateFlowGs?: number | null,
 *   weightG?: number | null,
 * }} input
 * @returns {FlowEndAutoStopState}
 */
export function stepFlowEndAutoStop(state, input) {
  if (!input.enabled || !input.extractionActive || input.preinfusionActive) {
    return createFlowEndAutoStopState();
  }
  if (state.stopConfirmed) {
    return { ...state };
  }

  if (input.legacyMode === true) {
    return stepFlowEndAutoStopLegacy(state, input);
  }
  return stepFlowEndAutoStopCurrent(state, input);
}

/**
 * @param {FlowEndAutoStopState} state
 * @param {{
 *   tExtractionS: number,
 *   smoothedFlowGs: number | null,
 *   backdateFlowGs?: number | null,
 * }} input
 */
function stepFlowEndAutoStopLegacy(state, input) {
  const flow = input.smoothedFlowGs;
  if (flow == null || !Number.isFinite(flow)) {
    return { ...state };
  }

  const backdateFlow = input.backdateFlowGs ?? flow;
  const t = input.tExtractionS;
  const sampleGap = state.lastFlowT != null && t - state.lastFlowT > FLOW_AUTO_STOP_MAX_SAMPLE_GAP_S;
  const next = { ...state, lastFlowT: t };

  if (!next.armed) {
    if (flow >= FLOW_AUTO_STOP_ARM_MIN_GS) {
      next.armed = true;
      next.peakSmoothedGs = flow;
    }
    return next;
  }

  next.peakSmoothedGs = Math.max(next.peakSmoothedGs, flow);
  const endThreshold = flowEndThresholdForPeak(next.peakSmoothedGs, true);

  if (
    Number.isFinite(backdateFlow)
    && backdateFlow < endThreshold
    && next.backdateRecordedEndExtractionS == null
  ) {
    next.backdateRecordedEndExtractionS = t;
  }

  if (flow >= endThreshold) {
    next.recordedEndExtractionS = null;
    next.belowThresholdSinceS = null;
    next.backdateRecordedEndExtractionS = null;
    return next;
  }

  if (next.recordedEndExtractionS == null) {
    next.recordedEndExtractionS = next.backdateRecordedEndExtractionS ?? t;
    next.belowThresholdSinceS = t;
    return next;
  }

  if (sampleGap) {
    next.belowThresholdSinceS = t;
    return next;
  }

  if (t - next.belowThresholdSinceS >= FLOW_AUTO_STOP_CONFIRM_S) {
    next.stopConfirmed = true;
  }
  return next;
}

/**
 * @param {FlowEndAutoStopState} state
 * @param {{
 *   tExtractionS: number,
 *   smoothedFlowGs: number | null,
 *   backdateFlowGs?: number | null,
 *   weightG?: number | null,
 * }} input
 */
function stepFlowEndAutoStopCurrent(state, input) {
  const next = { ...state };
  const t = input.tExtractionS;
  const prevFlowT = next.lastFlowT;
  next.lastFlowT = Number.isFinite(t) ? t : next.lastFlowT;
  const sampleGap = prevFlowT != null
    && Number.isFinite(t)
    && (t - prevFlowT) > FLOW_AUTO_STOP_MAX_SAMPLE_GAP_S;
  const weightG = input.weightG;
  let pourRising = false;
  if (Number.isFinite(weightG)) {
    pourRising = stepWeightPlateau(next, t, weightG);
  }

  const flow = input.smoothedFlowGs;
  if (flow == null || !Number.isFinite(flow)) {
    return next;
  }

  if (!next.armed) {
    if (flow >= FLOW_AUTO_STOP_ARM_MIN_GS) {
      next.armed = true;
      next.peakSmoothedGs = flow;
    }
    return next;
  }

  next.peakSmoothedGs = Math.max(next.peakSmoothedGs, flow);
  const endThreshold = flowEndThresholdForPeak(next.peakSmoothedGs, false);
  const backdateFlow = input.backdateFlowGs ?? flow;

  if (Number.isFinite(backdateFlow) && backdateFlow >= endThreshold) {
    if (next.fastAboveSinceS == null) next.fastAboveSinceS = t;
    if (
      next.fastWasBelow
      && t - next.fastAboveSinceS >= FLOW_AUTO_STOP_FAST_RESUME_S - 1e-6
    ) {
      clearAllEndCandidates(next);
      next.fastWasBelow = false;
      next.fastAboveSinceS = t;
    }
  } else if (Number.isFinite(backdateFlow) && backdateFlow < endThreshold) {
    next.fastAboveSinceS = null;
    next.fastWasBelow = true;
    if (!pourRising && next.backdateRecordedEndExtractionS == null) {
      next.backdateRecordedEndExtractionS = t;
    }
  }

  if (pourRising) {
    next.recordedEndExtractionS = null;
    next.belowThresholdSinceS = null;
    return next;
  }

  if (flow >= endThreshold) {
    next.recordedEndExtractionS = null;
    next.belowThresholdSinceS = null;
    return next;
  }

  const endS = earliestEndS(next, t);
  if (next.belowThresholdSinceS == null) {
    next.belowThresholdSinceS = t;
    next.recordedEndExtractionS = endS;
    return next;
  }

  if (sampleGap) {
    next.belowThresholdSinceS = t;
    if (next.recordedEndExtractionS == null || endS < next.recordedEndExtractionS) {
      next.recordedEndExtractionS = endS;
    }
    return next;
  }

  if (next.recordedEndExtractionS == null || endS < next.recordedEndExtractionS) {
    next.recordedEndExtractionS = endS;
  }
  if (t - next.belowThresholdSinceS >= FLOW_AUTO_STOP_CONFIRM_S) {
    next.stopConfirmed = true;
  }
  return next;
}

/**
 * @typedef {{
 *   auto: FlowEndAutoStopState,
 *   detectEma: import('./flowMetrics.js').FlowEmaState,
 *   backdateEma: import('./flowMetrics.js').FlowEmaState,
 * }} FlowEndDetectorState
 */

export function createFlowEndDetector() {
  return {
    auto: createFlowEndAutoStopState(),
    detectEma: createFlowEmaState(),
    backdateEma: createFlowEmaState(),
  };
}

/**
 * One new scale sample. EMAs move one step; they are not rebuilt from the series.
 *
 * @param {FlowEndDetectorState} detector
 * @param {{ tS: number, flowGs: number, weightG?: number | null }} sample
 * @param {{
 *   enabled?: boolean,
 *   legacyMode?: boolean,
 *   preinfusionActive?: boolean,
 *   extractionActive?: boolean,
 * }} [input]
 * @returns {FlowEndDetectorState}
 */
export function stepFlowEndDetector(detector, sample, input = {}) {
  const legacyMode = input.legacyMode === true;
  const flowSample = { tS: sample.tS, flowGs: sample.flowGs };
  const emaMaxDtS = legacyMode ? Infinity : FLOW_AUTO_STOP_MAX_SAMPLE_GAP_S;
  const detectEma = stepFlowEma(
    detector.detectEma,
    flowSample,
    FLOW_PLOT_SMOOTH_WINDOW_S,
    emaMaxDtS,
  );
  const backdateEma = legacyMode
    ? detectEma
    : stepFlowEma(
      detector.backdateEma,
      flowSample,
      FLOW_AUTO_STOP_BACKDATE_SMOOTH_WINDOW_S,
      emaMaxDtS,
    );
  const auto = stepFlowEndAutoStop(detector.auto, {
    enabled: input.enabled !== false,
    legacyMode,
    preinfusionActive: input.preinfusionActive === true,
    extractionActive: input.extractionActive !== false,
    tExtractionS: sample.tS,
    smoothedFlowGs: detectEma.ema,
    backdateFlowGs: backdateEma.ema,
    weightG: sample.weightG,
  });
  return {
    auto,
    detectEma,
    backdateEma: legacyMode ? detector.backdateEma : backdateEma,
  };
}

/** @param {FlowEndAutoStopState} state */
export function flowEndAutoStopShouldStop(state) {
  return state.stopConfirmed && state.recordedEndExtractionS != null;
}

/** @param {FlowEndAutoStopState} state */
export function flowEndAutoStopRecordedEndExtractionS(state) {
  return state.recordedEndExtractionS;
}

/**
 * Time to show while the timer is frozen: the plateau or fast-EMA candidate,
 * otherwise the slow-EMA end once that crossing has been recorded.
 *
 * @param {FlowEndAutoStopState} state
 * @returns {number | null}
 */
export function flowEndAutoStopDisplayEndS(state) {
  const candidate = candidateEndS(state);
  if (candidate != null) return candidate;
  return state.recordedEndExtractionS;
}

/** Freeze as soon as a plateau or fast-EMA candidate exists, and while confirming. */
export function flowEndAutoStopShouldFreezeTimer(state) {
  if (state.stopConfirmed) return false;
  return candidateEndS(state) != null || state.recordedEndExtractionS != null;
}
