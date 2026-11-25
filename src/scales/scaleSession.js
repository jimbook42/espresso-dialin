import { instantaneousFlowGs, SCALE_FLOW_MAX_SAMPLE_GAP_S, summarizeScaleFlow } from './flowMetrics.js';
import { createLiveFlowDisplay } from './displayFlow.js';
import { normalizeBatteryPercent } from './scaleBattery.js';

/**
 * Glue transport events into shot logging metrics (weight stream, timer, flow curve).
 *
 * @param {import('./transport/scaleTransport.js').ScaleTransport} transport
 * @param {{
 *   onLiveWeight?: (g: number) => void,
 *   onLiveTimerS?: (s: number) => void,
 *   onInstantFlowGs?: (g: number | null) => void,
 *   onFlowSample?: (sample: { tS: number, flowGs: number }) => void,
 *   onDisplayFlowSample?: (sample: { tS: number, flowGs: number, breakBefore?: boolean } | null) => void,
 *   onDetailFlowSample?: (sample: { tS: number, flowGs: number, breakBefore?: boolean } | null) => void,
 *   onBatteryPercent?: (percent: number) => void,
 * }} handlers
 */
export function createScaleSession(transport, handlers = {}) {
  /** @type {import('./flowMetrics.js').ScaleFlowSample[]} */
  let extractionSamples = [];
  let extractionEpochMs = null;
  let lastSample = null;
  let flowGap = false;
  let recording = false;
  let displayRecording = false;
  let displayForeground = true;
  let pendingDisplayTares = 0;
  const displayFlow = createLiveFlowDisplay();
  let displayExpiry;

  function resetDisplayFlow() {
    clearTimeout(displayExpiry);
    displayFlow.interrupt();
    handlers.onDisplayFlowSample?.(null);
    handlers.onDetailFlowSample?.(null);
  }

  function endDisplayFlow() {
    displayRecording = false;
    resetDisplayFlow();
  }

  const resetRecording = () => {
    extractionSamples = [];
    extractionEpochMs = null;
    lastSample = null;
    flowGap = false;
    recording = false;
    endDisplayFlow();
  };

  const beginExtractionTiming = () => {
    extractionEpochMs = Date.now();
    extractionSamples = [];
    lastSample = null;
    flowGap = false;
    recording = true;
    displayRecording = true;
    resetDisplayFlow();
    handlers.onExtractionStart?.(extractionEpochMs);
  };

  const offWeight = transport.onWeight((evt) => {
    handlers.onWeightObservation?.(evt);
    handlers.onLiveWeight?.(evt.weightG);
    if (!recording || extractionEpochMs == null) return;
    const tS = (evt.timestampMs - extractionEpochMs) / 1000;
    const sample = { tS, weightG: evt.weightG };
    const flow = instantaneousFlowGs(lastSample, sample);
    if (flow != null) {
      const gap = tS - lastSample.tS > SCALE_FLOW_MAX_SAMPLE_GAP_S;
      handlers.onInstantFlowGs?.(gap ? null : flow);
      handlers.onFlowSample?.({ tS, flowGs: flow, weightG: sample.weightG,
        ...(gap ? { gap } : flowGap ? { breakBefore: true } : {}) });
      flowGap = gap;
    }
    lastSample = sample;
    extractionSamples.push(sample);

    if (displayRecording && displayForeground && pendingDisplayTares === 0
      && (handlers.onDisplayFlowSample || handlers.onDetailFlowSample)) {
      clearTimeout(displayExpiry);
      const remainingMs = evt.timestampMs + SCALE_FLOW_MAX_SAMPLE_GAP_S * 1000 - Date.now();
      if (!Number.isFinite(remainingMs) || remainingMs < 0) {
        resetDisplayFlow();
      } else {
        const { smooth, detail } = displayFlow.add(sample);
        handlers.onDisplayFlowSample?.(smooth);
        handlers.onDetailFlowSample?.(detail);
        displayExpiry = setTimeout(resetDisplayFlow, remainingMs + 1);
      }
    }
  });

  const offTimer = transport.onTimer((evt) => {
    handlers.onLiveTimerS?.(evt.timerS);
  });

  const offBattery = transport.onBattery?.((evt) => {
    const pct = normalizeBatteryPercent(evt.batteryPercent);
    if (pct != null) handlers.onBatteryPercent?.(pct);
  });

  return {
    beginExtractionTiming,
    resetRecording,
    resetDisplayFlow,
    setDisplayTaring(taring) {
      pendingDisplayTares += taring ? 1 : -1;
      resetDisplayFlow();
    },
    setDisplayForeground(visible) {
      if (displayForeground === visible) return;
      displayForeground = visible;
      resetDisplayFlow();
    },
    endDisplayFlow,
    stopRecording() {
      recording = false;
      endDisplayFlow();
    },
    getShotMetrics() {
      const { flowCurve, averageFlowRateGs } = summarizeScaleFlow(extractionSamples);
      return {
        scaleFlowCurve: flowCurve,
        scaleFlowRateGs: averageFlowRateGs,
      };
    },
    dispose() {
      offWeight();
      offTimer();
      offBattery?.();
      resetRecording();
    },
  };
}
