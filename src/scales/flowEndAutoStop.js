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
 * @typedef {{
 *   armed: boolean,
 *   peakSmoothedGs: number,
 *   recordedEndExtractionS: number | null,
 *   belowThresholdSinceS: number | null,
 *   backdateRecordedEndExtractionS: number | null,
 *   stopConfirmed: boolean,
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
 * }} input
 * @returns {FlowEndAutoStopState}
 */
export function stepFlowEndAutoStop(state, input) {
  if (!input.enabled || !input.extractionActive || input.preinfusionActive) {
    return createFlowEndAutoStopState();
  }
  const flow = input.smoothedFlowGs;
  if (flow == null || !Number.isFinite(flow)) {
    return { ...state };
  }
  if (state.stopConfirmed) {
    return { ...state };
  }

  const legacyMode = input.legacyMode === true;
  const backdateFlow = input.backdateFlowGs ?? flow;
  const t = input.tExtractionS;

  let next = { ...state };

  if (!next.armed) {
    if (flow >= FLOW_AUTO_STOP_ARM_MIN_GS) {
      next.armed = true;
      next.peakSmoothedGs = flow;
    }
    return next;
  }

  next.peakSmoothedGs = Math.max(next.peakSmoothedGs, flow);
  const endThreshold = flowEndThresholdForPeak(next.peakSmoothedGs, legacyMode);

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

/** @param {FlowEndAutoStopState} state */
export function flowEndAutoStopShouldStop(state) {
  return state.stopConfirmed && state.recordedEndExtractionS != null;
}

/** @param {FlowEndAutoStopState} state */
export function flowEndAutoStopRecordedEndExtractionS(state) {
  return state.recordedEndExtractionS;
}

/** Timer display should freeze at the first threshold crossing while confirming. */
export function flowEndAutoStopShouldFreezeTimer(state) {
  return state.recordedEndExtractionS != null && !state.stopConfirmed;
}
