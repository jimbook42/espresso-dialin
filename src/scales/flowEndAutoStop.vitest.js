import { describe, expect, it } from 'vitest';
import {
  createFlowEndAutoStopState,
  createFlowEndDetector,
  FLOW_AUTO_STOP_ARM_MIN_GS,
  FLOW_AUTO_STOP_BACKDATE_SMOOTH_WINDOW_S,
  FLOW_AUTO_STOP_CONFIRM_S,
  FLOW_AUTO_STOP_END_ABS_MAX_GS,
  FLOW_AUTO_STOP_MAX_SAMPLE_GAP_S,
  FLOW_AUTO_STOP_PEAK_END_FRACTION,
  FLOW_AUTO_STOP_PEAK_END_FRACTION_LEGACY,
  FLOW_AUTO_STOP_PLATEAU_HOLD_S,
  flowEndAutoStopRecordedEndExtractionS,
  flowEndAutoStopShouldFreezeTimer,
  flowEndAutoStopShouldStop,
  flowEndDisplayedAndSavedTimes,
  flowEndThresholdForPeak,
  stepFlowEndAutoStop,
  stepFlowEndDetector,
} from './flowEndAutoStop.js';
import { FLOW_PLOT_SMOOTH_WINDOW_S, smoothFlowSeriesForPlot } from './flowMetrics.js';
import { SHOT_YIELD_SETTLE_MS } from './scaleShotStopSettle.js';
import { resolveSettledYieldG } from './scaleYieldSettleResolve.js';

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

  it('keeps the fast-EMA crossing while the slow EMA is still above the end threshold', () => {
    const peak = 4;
    const threshold = flowEndThreshold(peak);
    let state = createFlowEndAutoStopState();
    const step = (tExtractionS, smoothedFlowGs, backdateFlowGs) => {
      state = stepFlowEndAutoStop(state, {
        ...baseInput,
        tExtractionS,
        smoothedFlowGs,
        backdateFlowGs,
      });
    };
    step(5, FLOW_AUTO_STOP_ARM_MIN_GS, FLOW_AUTO_STOP_ARM_MIN_GS);
    step(10, peak, peak);
    step(20, peak, threshold - 0.01);
    expect(state.backdateRecordedEndExtractionS).toBe(20);
    step(21, peak, threshold - 0.05);
    expect(state.backdateRecordedEndExtractionS).toBe(20);
    expect(flowEndAutoStopRecordedEndExtractionS(state)).toBeNull();
    step(22, threshold - 0.01, threshold - 0.05);
    expect(flowEndAutoStopRecordedEndExtractionS(state)).toBe(20);
    expect(flowEndAutoStopShouldFreezeTimer(state)).toBe(true);
  });
});

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * @param {{
 *   stopS: number,
 *   untilS: number,
 *   rateGs?: number,
 *   dtS?: number,
 *   gapFromS?: number | null,
 *   gapToS?: number | null,
 *   gapHoldsWeight?: boolean,
 *   dripEveryS?: number,
 *   dripG?: number,
 * }} spec
 */
function buildWeightShot(spec) {
  const rateGs = spec.rateGs ?? 2.5;
  const dtS = spec.dtS ?? 0.1;
  const samples = [{ tS: 0, weightG: 0 }];
  let t = 0;
  let w = 0;
  const push = (tS, weightG) => {
    t = round3(tS);
    w = round3(weightG);
    samples.push({ tS: t, weightG: w });
  };
  const stepTo = (targetT, rate) => {
    while (t < targetT - 1e-9) {
      const nextT = Math.min(targetT, round3(t + dtS));
      const step = nextT - t;
      push(nextT, w + rate * step);
    }
  };
  if (spec.gapFromS != null && spec.gapToS != null) {
    stepTo(spec.gapFromS, rateGs);
    const held = w;
    const jumped = w + rateGs * (spec.gapToS - spec.gapFromS);
    push(spec.gapToS, spec.gapHoldsWeight ? held : jumped);
  }
  stepTo(spec.stopS, rateGs);
  const plateauStartS = spec.stopS;
  const plateauWeightG = w;
  let nextDrip = spec.dripEveryS > 0 ? round3(spec.stopS + spec.dripEveryS) : Infinity;
  while (t < spec.untilS - 1e-9) {
    const nextT = Math.min(spec.untilS, round3(t + dtS));
    let nextW = w;
    if (nextT + 1e-9 >= nextDrip) {
      nextW += spec.dripG;
      nextDrip = round3(nextDrip + spec.dripEveryS);
    }
    push(nextT, nextW);
  }
  return { samples, plateauStartS, plateauWeightG };
}

function replayWeightShot(samples) {
  let det = createFlowEndDetector();
  let confirmed = null;
  /** @type {number | null} */
  let frozenEndS = null;
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const next = samples[i];
    const dt = next.tS - prev.tS;
    const flowGs = dt > 0 ? (next.weightG - prev.weightG) / dt : 0;
    det = stepFlowEndDetector(det, {
      tS: next.tS,
      flowGs,
      weightG: next.weightG,
    });
    const endS = flowEndAutoStopRecordedEndExtractionS(det.auto);
    if (frozenEndS == null && flowEndAutoStopShouldFreezeTimer(det.auto) && endS != null) {
      frozenEndS = endS;
    }
    if (!confirmed && flowEndAutoStopShouldStop(det.auto) && endS != null) {
      confirmed = { endS, atS: next.tS, weightG: next.weightG, frozenEndS };
    }
  }
  return {
    det,
    confirmed,
    frozenEndS,
    finalWeightG: samples[samples.length - 1].weightG,
  };
}

describe('flow end backdates to when weight stopped rising', () => {
  it('a clean stop: saved and displayed end are within 0.3 s of the plateau', () => {
    const stopS = 20;
    const { samples, plateauStartS } = buildWeightShot({ stopS, untilS: 26 });
    const { confirmed, frozenEndS } = replayWeightShot(samples);
    expect(confirmed).not.toBeNull();
    expect(Math.abs(confirmed.endS - plateauStartS)).toBeLessThanOrEqual(0.3);
    expect(frozenEndS).not.toBeNull();
    expect(Math.abs(frozenEndS - plateauStartS)).toBeLessThanOrEqual(0.3);
    const times = flowEndDisplayedAndSavedTimes(confirmed.endS);
    expect(Math.abs(times.displayedTicks / 10 - plateauStartS)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(times.savedExtractionS - plateauStartS)).toBeLessThanOrEqual(0.3);
    expect(times.savedExtractionS).toBe(Math.round(confirmed.endS));
  });

  it('a stop followed by drips keeps the plateau and the final weight includes them', () => {
    const stopS = 20;
    const built = buildWeightShot({
      stopS,
      untilS: 27,
      dripEveryS: 0.5,
      dripG: 0.3,
    });
    const { confirmed, finalWeightG } = replayWeightShot(built.samples);
    expect(confirmed).not.toBeNull();
    expect(Math.abs(confirmed.endS - built.plateauStartS)).toBeLessThanOrEqual(0.3);
    expect(finalWeightG).toBeGreaterThan(built.plateauWeightG + 1);
    expect(confirmed.weightG).toBeGreaterThan(built.plateauWeightG);
    expect(SHOT_YIELD_SETTLE_MS).toBe(1000);
    const settled = resolveSettledYieldG(confirmed.weightG, finalWeightG, finalWeightG);
    expect(settled).toBeGreaterThan(built.plateauWeightG);
    expect(settled).toBeGreaterThanOrEqual(Math.round(finalWeightG * 10) / 10 - 0.05);
  });

  it('a brief flow dip that resumes does not end the shot early', () => {
    const dipS = 10;
    const resumeS = round3(dipS + FLOW_AUTO_STOP_PLATEAU_HOLD_S + 0.3);
    const stopS = 20;
    const rateGs = 2.5;
    const dtS = 0.1;
    const samples = [{ tS: 0, weightG: 0 }];
    let t = 0;
    let w = 0;
    const pushTo = (target, rate) => {
      while (t < target - 1e-9) {
        const nextT = Math.min(target, round3(t + dtS));
        w = round3(w + rate * (nextT - t));
        t = nextT;
        samples.push({ tS: t, weightG: w });
      }
    };
    pushTo(dipS, rateGs);
    pushTo(resumeS, 0);
    pushTo(stopS, rateGs);
    pushTo(26, 0);
    const { confirmed } = replayWeightShot(samples);
    expect(confirmed).not.toBeNull();
    expect(Math.abs(confirmed.endS - stopS)).toBeLessThanOrEqual(0.3);
    expect(confirmed.endS).toBeGreaterThan(dipS + 2);
  });

  it('a missing-notification gap mid-shot does not end the shot', () => {
    const gapFromS = 8;
    const gapToS = round3(gapFromS + FLOW_AUTO_STOP_MAX_SAMPLE_GAP_S + 2);
    const stopS = 18;
    const { samples, plateauStartS } = buildWeightShot({
      stopS,
      untilS: 24,
      gapFromS,
      gapToS,
      gapHoldsWeight: true,
    });
    const { confirmed } = replayWeightShot(samples);
    expect(confirmed).not.toBeNull();
    expect(Math.abs(confirmed.endS - plateauStartS)).toBeLessThanOrEqual(0.3);
    expect(confirmed.endS).toBeGreaterThan(gapToS);
    expect(Math.abs(confirmed.endS - gapFromS)).toBeGreaterThan(2);
  });

  it('preinfusion on: displayed total includes it and saved time stays extraction-only', () => {
    const preInfusionSeconds = 12;
    const stopS = 28;
    const { samples, plateauStartS } = buildWeightShot({ stopS, untilS: 34 });
    let det = createFlowEndDetector();
    det = stepFlowEndDetector(det, { tS: 1, flowGs: 2, weightG: 2 }, { preinfusionActive: true });
    det = stepFlowEndDetector(det, { tS: 2, flowGs: 0.05, weightG: 2.1 }, { preinfusionActive: true });
    expect(flowEndAutoStopShouldStop(det.auto)).toBe(false);
    const { confirmed } = replayWeightShot(samples);
    expect(confirmed).not.toBeNull();
    expect(Math.abs(confirmed.endS - plateauStartS)).toBeLessThanOrEqual(0.3);
    const withPre = flowEndDisplayedAndSavedTimes(confirmed.endS, {
      includePreInfusion: true,
      preInfusionSeconds,
    });
    const noPre = flowEndDisplayedAndSavedTimes(confirmed.endS, {
      includePreInfusion: false,
      preInfusionSeconds,
    });
    expect(withPre.savedExtractionS).toBe(Math.round(confirmed.endS));
    expect(noPre.savedExtractionS).toBe(withPre.savedExtractionS);
    expect(withPre.displayedTicks).toBe(Math.round((preInfusionSeconds + confirmed.endS) * 10));
    expect(noPre.displayedTicks).toBe(Math.round(confirmed.endS * 10));
    const displayedS = withPre.displayedTicks / 10;
    expect(displayedS - withPre.savedExtractionS).toBeGreaterThan(preInfusionSeconds - 0.5);
    expect(displayedS - withPre.savedExtractionS).toBeLessThan(preInfusionSeconds + 0.5);
    expect(displayedS).toBeGreaterThan(withPre.savedExtractionS + preInfusionSeconds - 0.5);
  });
});
