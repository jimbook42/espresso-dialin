import { describe, expect, it } from 'vitest';
import {
  createFlowEndAutoStopState,
  FLOW_AUTO_STOP_ARM_MIN_GS,
  FLOW_AUTO_STOP_BACKDATE_SMOOTH_WINDOW_S,
  FLOW_AUTO_STOP_CONFIRM_S,
  FLOW_AUTO_STOP_END_ABS_MAX_GS,
  FLOW_AUTO_STOP_PEAK_END_FRACTION,
  FLOW_AUTO_STOP_PEAK_END_FRACTION_LEGACY,
  flowEndAutoStopRecordedEndExtractionS,
  flowEndAutoStopShouldFreezeTimer,
  flowEndAutoStopShouldStop,
  flowEndThresholdForPeak,
  stepFlowEndAutoStop,
} from './flowEndAutoStop.js';
import { FLOW_PLOT_SMOOTH_WINDOW_S, smoothFlowSeriesForPlot } from './flowMetrics.js';

const baseInput = {
  enabled: true,
  legacyMode: false,
  preinfusionActive: false,
  extractionActive: true,
  tExtractionS: 0,
  smoothedFlowGs: 0,
};

function flowEndThreshold(peakSmoothedGs, legacyMode = false) {
  return flowEndThresholdForPeak(peakSmoothedGs, legacyMode);
}

function runSeries(steps, legacyMode = false) {
  let state = createFlowEndAutoStopState();
  for (const step of steps) {
    state = stepFlowEndAutoStop(state, {
      ...baseInput,
      legacyMode,
      ...step,
      backdateFlowGs: step.backdateFlowGs ?? step.smoothedFlowGs,
    });
  }
  return state;
}

/** @param {{ tS: number, flowGs: number }[]} rawFlow */
function replaySmoothedFlowSeries(rawFlow, { legacyMode = false } = {}) {
  const detectSmoothed = smoothFlowSeriesForPlot(rawFlow, FLOW_PLOT_SMOOTH_WINDOW_S);
  const backdateSmoothed = legacyMode
    ? detectSmoothed
    : smoothFlowSeriesForPlot(rawFlow, FLOW_AUTO_STOP_BACKDATE_SMOOTH_WINDOW_S);
  let state = createFlowEndAutoStopState();
  for (let i = 0; i < detectSmoothed.length; i += 1) {
    const detect = detectSmoothed[i];
    const backdate = backdateSmoothed[i];
    state = stepFlowEndAutoStop(state, {
      ...baseInput,
      legacyMode,
      tExtractionS: detect.tS,
      smoothedFlowGs: detect.flowGs,
      backdateFlowGs: backdate.flowGs,
    });
  }
  return state;
}

/**
 * Synthetic lever-lift profile: steady peak, sharp drop, slow drip tail.
 * @returns {{ tS: number, flowGs: number }[]}
 */
function syntheticLeverLiftFlowSeries() {
  const raw = [];
  const pushSegment = (fromT, toT, stepS, flowGs) => {
    for (let t = fromT; t <= toT + 1e-9; t += stepS) {
      raw.push({ tS: t, flowGs });
    }
  };
  pushSegment(0, 4, 0.25, 0);
  pushSegment(4.25, 22, 0.25, 3);
  pushSegment(22.25, 24, 0.25, 0.35);
  pushSegment(24.25, 34, 0.25, 0.08);
  return raw;
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
      { tExtractionS: dropT, smoothedFlowGs: flowEndThreshold(peak) - 0.01 },
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

  it('legacy mode keeps abs cap for high peaks', () => {
    const peak = 5;
    const betweenCapAndFraction = 0.5;
    expect(betweenCapAndFraction).toBeGreaterThan(FLOW_AUTO_STOP_END_ABS_MAX_GS);
    expect(betweenCapAndFraction).toBeLessThan(peak * FLOW_AUTO_STOP_PEAK_END_FRACTION_LEGACY);
    const state = runSeries([
      { tExtractionS: 5, smoothedFlowGs: FLOW_AUTO_STOP_ARM_MIN_GS },
      { tExtractionS: 15, smoothedFlowGs: peak },
      { tExtractionS: 40, smoothedFlowGs: betweenCapAndFraction },
      { tExtractionS: 60, smoothedFlowGs: betweenCapAndFraction },
    ], true);
    expect(flowEndAutoStopShouldStop(state)).toBe(false);
    expect(flowEndAutoStopRecordedEndExtractionS(state)).toBe(null);
  });

  it('current mode ends on high peak when flow drops below peak fraction', () => {
    const peak = 5;
    const betweenCapAndFraction = 0.5;
    const dropT = 40;
    const state = runSeries([
      { tExtractionS: 5, smoothedFlowGs: FLOW_AUTO_STOP_ARM_MIN_GS },
      { tExtractionS: 15, smoothedFlowGs: peak },
      { tExtractionS: dropT, smoothedFlowGs: betweenCapAndFraction },
      {
        tExtractionS: dropT + FLOW_AUTO_STOP_CONFIRM_S,
        smoothedFlowGs: betweenCapAndFraction,
      },
    ]);
    expect(betweenCapAndFraction).toBeLessThan(peak * FLOW_AUTO_STOP_PEAK_END_FRACTION);
    expect(flowEndAutoStopShouldStop(state)).toBe(true);
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

  it('does not mutate state after stop is confirmed', () => {
    const peak = 3;
    const dropT = 20;
    let state = runSeries([
      { tExtractionS: 2, smoothedFlowGs: FLOW_AUTO_STOP_ARM_MIN_GS },
      { tExtractionS: 10, smoothedFlowGs: peak },
      { tExtractionS: dropT, smoothedFlowGs: flowEndThreshold(peak) - 0.01 },
      { tExtractionS: dropT + FLOW_AUTO_STOP_CONFIRM_S, smoothedFlowGs: 0.05 },
    ]);
    expect(flowEndAutoStopShouldStop(state)).toBe(true);
    const endS = flowEndAutoStopRecordedEndExtractionS(state);
    state = stepFlowEndAutoStop(state, {
      ...baseInput,
      tExtractionS: dropT + FLOW_AUTO_STOP_CONFIRM_S + 5,
      smoothedFlowGs: peak,
      backdateFlowGs: peak,
    });
    expect(flowEndAutoStopShouldStop(state)).toBe(true);
    expect(flowEndAutoStopRecordedEndExtractionS(state)).toBe(endS);
  });

  it('ends earlier on synthetic lever lift than legacy tail-off', () => {
    const series = syntheticLeverLiftFlowSeries();
    const legacy = replaySmoothedFlowSeries(series, { legacyMode: true });
    const current = replaySmoothedFlowSeries(series, { legacyMode: false });
    expect(flowEndAutoStopShouldStop(legacy)).toBe(true);
    expect(flowEndAutoStopShouldStop(current)).toBe(true);
    const legacyEnd = flowEndAutoStopRecordedEndExtractionS(legacy);
    const currentEnd = flowEndAutoStopRecordedEndExtractionS(current);
    expect(legacyEnd).not.toBeNull();
    expect(currentEnd).not.toBeNull();
    expect(currentEnd).toBeLessThan(legacyEnd);
    expect(legacyEnd - currentEnd).toBeGreaterThan(1);
  });
});
