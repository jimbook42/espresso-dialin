import { instantaneousFlowGs, SCALE_FLOW_MAX_SAMPLE_GAP_S, summarizeScaleFlow } from './flowMetrics.js';
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

  const resetRecording = () => {
    extractionSamples = [];
    extractionEpochMs = null;
    lastSample = null;
    flowGap = false;
    recording = false;
  };

  const beginExtractionTiming = () => {
    extractionEpochMs = Date.now();
    extractionSamples = [];
    lastSample = null;
    flowGap = false;
    recording = true;
  };

  const offWeight = transport.onWeight((evt) => {
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
    stopRecording() {
      recording = false;
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
