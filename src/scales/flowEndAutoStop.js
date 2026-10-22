/** Minimum smoothed flow (g/s) before auto-stop can arm after pre-infusion. */
export const FLOW_AUTO_STOP_ARM_MIN_GS = 1;

/** End shot when smoothed flow falls below this fraction of peak smoothed flow. */
export const FLOW_AUTO_STOP_PEAK_END_FRACTION = 0.2;

/** Cap on end threshold (g/s); end uses min(peak × fraction, this value). */
export const FLOW_AUTO_STOP_END_ABS_MAX_GS = 0.3;

/** Smoothed flow must stay below the end threshold for this long (s). */
export const FLOW_AUTO_STOP_CONFIRM_S = 1.5;

/**
 * @typedef {{
 *   armed: boolean,
 *   peakSmoothedGs: number,
 *   recordedEndExtractionS: number | null,
 *   belowThresholdSinceS: number | null,
 *   stopConfirmed: boolean,
 * }} FlowEndAutoStopState
 */

export function createFlowEndAutoStopState() {
  return {
    armed: false,
    peakSmoothedGs: 0,
    recordedEndExtractionS: null,
    belowThresholdSinceS: null,
    stopConfirmed: false,
  };
}

/**
 * Pure state machine step for flow-end auto-stop (one tick per smoothed flow sample).
 *
 * @param {FlowEndAutoStopState} state
 * @param {{
 *   enabled: boolean,
 *   preinfusionActive: boolean,
 *   extractionActive: boolean,
 *   tExtractionS: number,
 *   smoothedFlowGs: number | null,
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

  let next = { ...state };

  if (!next.armed) {
    if (flow >= FLOW_AUTO_STOP_ARM_MIN_GS) {
      next.armed = true;
      next.peakSmoothedGs = flow;
    }
    return next;
  }

  next.peakSmoothedGs = Math.max(next.peakSmoothedGs, flow);
  const endThreshold = Math.min(
    next.peakSmoothedGs * FLOW_AUTO_STOP_PEAK_END_FRACTION,
    FLOW_AUTO_STOP_END_ABS_MAX_GS,
  );

  if (flow >= endThreshold) {
    next.recordedEndExtractionS = null;
    next.belowThresholdSinceS = null;
    return next;
  }

  const t = input.tExtractionS;
  if (next.recordedEndExtractionS == null) {
    next.recordedEndExtractionS = t;
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
