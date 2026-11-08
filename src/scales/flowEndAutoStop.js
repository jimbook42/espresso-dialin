import {
  createFlowEmaState,
  FLOW_PLOT_SMOOTH_WINDOW_S,
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
export const FLOW_AUTO_STOP_MAX_SAMPLE_GAP_S = 0.5;

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
 * Rising notifies in a row, each above one scale count, that cancel a plateau.
 * A post-stop drip is one blob and then flat, so it never reaches this.
 */
export const FLOW_AUTO_STOP_RESUME_SAMPLES = 3;

/**
 * Grams those rising notifies must add before the pour counts as resumed.
 * 0.5 g is about 0.3 s of a 2 g/s pour, and more than a single drip blob.
 */
export const FLOW_AUTO_STOP_RESUME_GAIN_G = 0.5;

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
 *   pendingRise: number,
 *   pendingGainG: number,
 *   fastAboveSinceS: number | null,
 *   fastWasBelow: boolean,
 *   lastFlowT: number | null,
 *   slowFillGainG: number,
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
    pendingRise: 0,
    pendingGainG: 0,
    fastAboveSinceS: null,
    fastWasBelow: false,
    lastFlowT: null,
    slowFillGainG: 0,
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
  state.slowFillGainG = 0;
  state.backdateRecordedEndExtractionS = null;
  state.recordedEndExtractionS = null;
  state.belowThresholdSinceS = null;
  state.pendingRise = 0;
  state.pendingGainG = 0;
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
  if (prevT == null || prevW == null) return false;

  const dt = tS - prevT;
  if (!(dt > 0)) return false;
  const dw = weightG - prevW;

  if (dt > FLOW_AUTO_STOP_MAX_SAMPLE_GAP_S) {
    state.flatInvalid = true;
    state.pendingRise = 0;
    state.pendingGainG = 0;
    return false;
  }

  // Scale-count steps (0.1 g) never pass the blob test below. A slow pour of
  // those steps is still filling: accumulate them even when a flat notify
  // sits in between, and retire the plateau once they add up to a real pour.
  if (dw > 1e-6 && dw <= FLOW_AUTO_STOP_PLATEAU_NOISE_G + 1e-6) {
    state.lastRiseT = tS;
    state.flatInvalid = false;
    state.pendingRise = 0;
    state.pendingGainG = 0;
    if (state.plateauHeld) {
      state.slowFillGainG += dw;
      if (state.slowFillGainG >= FLOW_AUTO_STOP_RESUME_GAIN_G - 1e-6) {
        clearAllEndCandidates(state);
        state.lastRiseT = tS;
        return true;
      }
    }
    return false;
  }

  if (dw > FLOW_AUTO_STOP_PLATEAU_NOISE_G) {
    state.pendingRise += 1;
    state.pendingGainG += dw;
    const resumed = state.pendingRise >= FLOW_AUTO_STOP_RESUME_SAMPLES
      && state.pendingGainG >= FLOW_AUTO_STOP_RESUME_GAIN_G;
    if (!resumed) return false;
    state.lastRiseT = tS;
    state.flatInvalid = false;
    const hadEndCandidate = state.plateauHeld
      || state.plateauStartS != null
      || state.backdateRecordedEndExtractionS != null
      || state.recordedEndExtractionS != null
      || state.belowThresholdSinceS != null;
    if (hadEndCandidate) clearAllEndCandidates(state);
    state.lastRiseT = tS;
    return true;
  }

  state.pendingRise = 0;
  state.pendingGainG = 0;
  if (state.flatInvalid || state.lastRiseT == null || state.plateauHeld) return false;
  if (tS - state.lastRiseT >= FLOW_AUTO_STOP_PLATEAU_HOLD_S - 1e-6) {
    state.plateauHeld = true;
    state.plateauStartS = state.lastRiseT;
    state.slowFillGainG = 0;
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
  const next = { ...state };

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
