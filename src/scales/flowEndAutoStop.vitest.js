import { describe, expect, it } from 'vitest';
import {
  createFlowEndAutoStopState,
  FLOW_AUTO_STOP_ARM_MIN_GS,
  FLOW_AUTO_STOP_CONFIRM_S,
  FLOW_AUTO_STOP_END_ABS_MAX_GS,
  FLOW_AUTO_STOP_PEAK_END_FRACTION,
  flowEndAutoStopRecordedEndExtractionS,
  flowEndAutoStopShouldFreezeTimer,
  flowEndAutoStopShouldStop,
  stepFlowEndAutoStop,
} from './flowEndAutoStop.js';

const baseInput = {
  enabled: true,
  preinfusionActive: false,
  extractionActive: true,
  tExtractionS: 0,
  smoothedFlowGs: 0,
};

function flowEndThreshold(peakSmoothedGs) {
  return Math.min(
    peakSmoothedGs * FLOW_AUTO_STOP_PEAK_END_FRACTION,
    FLOW_AUTO_STOP_END_ABS_MAX_GS,
  );
}

function runSeries(steps) {
  let state = createFlowEndAutoStopState();
  for (const step of steps) {
    state = stepFlowEndAutoStop(state, { ...baseInput, ...step });
  }
  return state;
}

describe('flowEndAutoStop', () => {
  it('does not stop during pre-infusion', () => {
    const state = runSeries([
      { preinfusionActive: true, extractionActive: false, tExtractionS: 5, smoothedFlowGs: 3 },
      { preinfusionActive: true, extractionActive: false, tExtractionS: 10, smoothedFlowGs: 0.1 },
    ]);
    expect(flowEndAutoStopShouldStop(state)).toBe(false);
  });

  it('stops at flow end with end time at first threshold cross', () => {
    const peak = 4;
    const dropT = 30;
    const state = runSeries([
      { tExtractionS: 5, smoothedFlowGs: FLOW_AUTO_STOP_ARM_MIN_GS },
      { tExtractionS: 15, smoothedFlowGs: peak },
      { tExtractionS: dropT, smoothedFlowGs: flowEndThreshold(peak) - 0.01 },
      {
        tExtractionS: dropT + FLOW_AUTO_STOP_CONFIRM_S,
        smoothedFlowGs: flowEndThreshold(peak) - 0.01,
      },
    ]);
    expect(flowEndAutoStopShouldStop(state)).toBe(true);
    expect(flowEndAutoStopRecordedEndExtractionS(state)).toBe(dropT);
  });

  it('does not extend shot time for late drips after stop armed', () => {
    const peak = 3;
    const dropT = 20;
    const state = runSeries([
      { tExtractionS: 2, smoothedFlowGs: FLOW_AUTO_STOP_ARM_MIN_GS },
      { tExtractionS: 10, smoothedFlowGs: peak },
      { tExtractionS: dropT, smoothedFlowGs: 0.2 },
      { tExtractionS: dropT + FLOW_AUTO_STOP_CONFIRM_S, smoothedFlowGs: 0.2 },
      { tExtractionS: dropT + FLOW_AUTO_STOP_CONFIRM_S + 5, smoothedFlowGs: 0.05 },
    ]);
    expect(flowEndAutoStopShouldStop(state)).toBe(true);
    expect(flowEndAutoStopRecordedEndExtractionS(state)).toBe(dropT);
  });

  it('does not stop on slow start below arm threshold', () => {
    const state = runSeries([
      { tExtractionS: 5, smoothedFlowGs: FLOW_AUTO_STOP_ARM_MIN_GS - 0.2 },
      { tExtractionS: 40, smoothedFlowGs: FLOW_AUTO_STOP_ARM_MIN_GS - 0.1 },
      { tExtractionS: 50, smoothedFlowGs: 0.05 },
    ]);
    expect(flowEndAutoStopShouldStop(state)).toBe(false);
  });

  it('recovers from a mid-shot flow dip without stopping', () => {
    const peak = 4;
    const dipT = 20;
    const state = runSeries([
      { tExtractionS: 5, smoothedFlowGs: FLOW_AUTO_STOP_ARM_MIN_GS },
      { tExtractionS: 15, smoothedFlowGs: peak },
      { tExtractionS: dipT, smoothedFlowGs: flowEndThreshold(peak) - 0.01 },
      {
        tExtractionS: dipT + 0.5,
        smoothedFlowGs: flowEndThreshold(peak) - 0.01,
      },
      { tExtractionS: dipT + 1, smoothedFlowGs: peak },
      { tExtractionS: 40, smoothedFlowGs: peak },
    ]);
    expect(flowEndAutoStopShouldStop(state)).toBe(false);
    expect(flowEndAutoStopRecordedEndExtractionS(state)).toBe(null);
    expect(flowEndAutoStopShouldFreezeTimer(state)).toBe(false);
  });

  it('does not stop on high peak while flow is between abs cap and peak fraction', () => {
    const peak = 5;
    const betweenCapAndFraction = 0.5;
    expect(betweenCapAndFraction).toBeGreaterThan(FLOW_AUTO_STOP_END_ABS_MAX_GS);
    expect(betweenCapAndFraction).toBeLessThan(peak * FLOW_AUTO_STOP_PEAK_END_FRACTION);
    const state = runSeries([
      { tExtractionS: 5, smoothedFlowGs: FLOW_AUTO_STOP_ARM_MIN_GS },
      { tExtractionS: 15, smoothedFlowGs: peak },
      { tExtractionS: 40, smoothedFlowGs: betweenCapAndFraction },
      { tExtractionS: 60, smoothedFlowGs: betweenCapAndFraction },
    ]);
    expect(flowEndAutoStopShouldStop(state)).toBe(false);
    expect(flowEndAutoStopRecordedEndExtractionS(state)).toBe(null);
  });

  it('does not stop when disabled', () => {
    const peak = 3;
    const state = runSeries([
      { enabled: false, tExtractionS: 2, smoothedFlowGs: peak },
      { enabled: false, tExtractionS: 20, smoothedFlowGs: 0.1 },
      { enabled: false, tExtractionS: 22, smoothedFlowGs: 0.1 },
    ]);
    expect(flowEndAutoStopShouldStop(state)).toBe(false);
  });
});
