import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDisplayFlowEstimator, plottedFlowFromWeights } from './displayFlow.js';
import {
  createFlowEndDetector, flowEndAutoStopDisplayEndS, flowEndAutoStopShouldFreezeTimer,
  flowEndAutoStopShouldStop, flowEndDisplayedAndSavedTimes, stepFlowEndDetector,
} from './flowEndAutoStop.js';
import { instantaneousFlowGs } from './flowMetrics.js';
import { createScaleSession } from './scaleSession.js';
import { buildShotProfile } from '../utils/shotProfile.js';

const delaysMs = [0, 0, 197, 100, 10, 0, 91, 0, 0, 0];
const quantise = (g) => Math.round(g * 10 + 1e-9) / 10;
const sampled = (length, weight, delays = delaysMs) => Array.from({ length }, (_, i) => ({
  offsetMs: i * 100 + delays[i % delays.length],
  weightG: quantise(weight(i / 10)),
}));
const steady = sampled(120, (t) => 0.9 * t);
const asSamples = (events) => events.map(({ offsetMs, weightG }) => ({ tS: offsetMs / 1000, weightG }));
const positivePart = (n) => Math.max(0, n);
const clean = [0];

describe('saved flow plot', () => {
  const weights = (...points) => points.map(([tS, weightG]) => ({ tS, weightG }));

  it('holds a quantised 1.2 g/s pour across irregular, duplicate and 1 ms deliveries', () => {
    const samples = weights([0, 0], [0.1, 0.1], [0.1, 0.1], [0.101, 0.2], [0.25, 0.3],
      [0.4, 0.5], [0.5, 0.6], [0.72, 0.9], [0.9, 1.1], [1, 1.2]);
    const original = structuredClone(samples);
    expect(instantaneousFlowGs(samples[2], samples[3])).toBeCloseTo(100);
    const output = plottedFlowFromWeights(samples);
    expect(output[0].tS).toBe(0.25);
    expect(output.at(-1).tS).toBe(1);
    for (const { flowGs } of output) expect(Math.abs(flowGs - 1.2)).toBeLessThan(0.15);
    expect(samples).toEqual(original);
  });

  it('shows the plateau, splits at a weight disturbance and at missing notifications', () => {
    const flow = plottedFlowFromWeights(weights([0, 2], [0.2, 2], [0.4, 1], [0.41, 2],
      [0.65, 2.24], [1.3, 9], [1.6, 9.3]));
    expect(flow.map(({ tS, breakBefore }) => [tS, breakBefore])).toEqual([[0.2, true], [0.65, true], [1.6, true]]);
    expect(flow[0].flowGs).toBe(0);
    expect(flow[1].flowGs).toBeCloseTo(1);
    expect(flow[2].flowGs).toBeCloseTo(1);
  });

  it('retains a rapid supported change and uses the last weight at the same timestamp', () => {
    const flow = plottedFlowFromWeights(weights([0, 0], [0.25, 0.25], [0.25, 0.3], [0.5, 0.6],
      [0.75, 1.85], [1, 3.1], [1.25, 3.1], [1.5, 3.1]));
    expect(flow.map(({ flowGs }) => Number(flowGs.toFixed(2)))).toEqual([1.2, 1.2, 3.1, 5, 2.5, 0]);
  });
});

function startSession(handlers) {
  vi.useFakeTimers({ now: 10000 });
  const epoch = Date.now();
  let receive;
  const session = createScaleSession({
    onWeight: (handler) => { receive = handler; return () => { receive = null; }; },
    onTimer: () => () => {},
  }, handlers);
  session.beginExtractionTiming();
  return {
    session,
    send({ offsetMs, weightG }) {
      vi.advanceTimersByTime(epoch + offsetMs - Date.now());
      receive?.({ timestampMs: epoch + offsetMs, weightG });
    },
  };
}

afterEach(() => vi.useRealTimers());

function steadyStats(values) {
  expect(values.every(Number.isFinite)).toBe(true);
  return {
    mae: values.reduce((sum, flow) => sum + Math.abs(flow - 0.9), 0) / values.length,
    min: Math.min(...values),
    peak: Math.max(...values),
    falseZeros: values.filter((flow) => flow === 0).length,
  };
}

it('fixes the steady 0.9 g/s reproduction through the scale session', () => {
  const values = [];
  const { session, send } = startSession({ onDisplayFlowSample: (sample) => values.push(sample?.flowGs ?? null) });
  steady.forEach(send);
  const stats = steadyStats(values.slice(12));
  expect(stats.falseZeros).toBe(0);
  expect(stats.mae).toBeLessThan(0.07);
  expect(stats.peak).toBeLessThan(1);
  session.dispose();
});

describe.each([0.75, 1])('%s second display window', (seconds) => {
  it('quantifies steady-pour error against the two-point baseline', () => {
    const estimator = createDisplayFlowEstimator(seconds);
    const observed = asSamples(steady);
    const raw = steadyStats(observed.map((p, i) => instantaneousFlowGs(observed[i - 1], p)).slice(11));
    const display = steadyStats(observed.map((p) => estimator.add(p)?.flowGs).slice(11));
    console.info({ seconds, raw, display });
    expect(raw.peak).toBeCloseTo(33.3333, 3);
    expect(raw.falseZeros).toBe(11);
    expect(display.falseZeros).toBe(0);
    expect(display.mae).toBeLessThan(seconds === 0.75 ? 0.07 : 0.04);
  });

  it('uses weight evidence even when timestamps are identical', () => {
    const estimator = createDisplayFlowEstimator(seconds);
    expect(estimator.add({ tS: 0, weightG: 0 })).toBeNull();
    expect(estimator.add({ tS: 0, weightG: 0.1 })).toBeNull();
    expect(estimator.add({ tS: 0.3, weightG: 0.3 })).toBeNull();
    const first = estimator.add({ tS: 0.4, weightG: 0.4 });
    const batched = estimator.add({ tS: 0.4, weightG: 0.5 });
    expect(first.flowGs).toBeGreaterThan(0);
    expect(batched.flowGs).toBeGreaterThan(first.flowGs);
    expect(batched.flowGs).toBeLessThan(1.2);
  });

  it('marks gaps and disturbed weights unavailable, and re-primes on continuous evidence', () => {
    const estimator = createDisplayFlowEstimator(seconds);
    const add = (tS, weightG) => estimator.add({ tS, weightG });
    expect(add(0, 0)).toBeNull();
    expect(add(0.4, 0)).toBeNull();
    expect(add(0.5, 0)?.flowGs).toBe(0);
    expect(add(1.01, 0.6)).toBeNull();
    expect(add(1.21, 0.8)).toBeNull();
    expect(add(1.41, 1)).toMatchObject({ breakBefore: true, flowGs: expect.closeTo(1) });
    expect(add(1.51, 0.4)).toBeNull(); // Cup bump
    expect(add(1.61, 1.2)).toBeNull(); // Rebound is the first new anchor
    expect(add(1.81, 1.4)).toBeNull();
    expect(add(2.01, 1.6)).toMatchObject({ breakBefore: true, flowGs: expect.closeTo(1) });
    expect(add(2.1, NaN)).toBeNull();
  });

  it('follows a taper and shows intermittent drips between observed zeroes', () => {
    const estimator = createDisplayFlowEstimator(seconds);
    const events = asSamples(sampled(101, (t) => {
      const taper = Math.min(3, Math.max(0, t - 2));
      return 2 * Math.min(t, 2) + 2 * taper - taper ** 2 / 3 + (t >= 6.5 ? 0.3 : 0) + (t >= 8 ? 0.2 : 0);
    }, clean));
    const values = events.map((sample) => estimator.add(sample)?.flowGs);
    expect(values[20]).toBeCloseTo(2, 1);
    expect(values[35]).toBeGreaterThan(values[45]);
    expect(values[45]).toBeGreaterThan(values[55]);
    expect(values[64]).toBe(0);
    expect(values[67]).toBeGreaterThan(0);
    expect(values[78]).toBe(0);
    expect(values[83]).toBeGreaterThan(0);
    expect(values.at(-1)).toBe(0);
  });

  it('measures step response across ten arrival phases and keeps genuine fast flow', () => {
    const lags = { start: [], increase: [], taper: [], stop: [] };
    const rawLags = { start: [], increase: [], taper: [], stop: [] };
    for (let phase = 0; phase < 10; phase += 1) {
      const start = (20 + phase) / 10;
      const fast = start + 3;
      const slow = fast + 3;
      const stop = slow + 3;
      const events = asSamples(sampled(160, (t) =>
        0.9 * positivePart(t - start) + 11.1 * positivePart(t - fast)
        - 11.6 * positivePart(t - slow) - 0.4 * positivePart(t - stop)));
      const estimator = createDisplayFlowEstimator(seconds);
      const observed = events.map((sample) => estimator.add(sample)?.flowGs);
      const raw = events.map((sample, i) => instantaneousFlowGs(events[i - 1], sample));
      for (const [key, time, reached] of [
        ['start', start, (flow) => flow >= 0.72], ['increase', fast, (flow) => flow >= 9.78],
        ['taper', slow, (flow) => flow <= 2.72], ['stop', stop, (flow) => flow === 0],
      ]) {
        const lagMs = (values) => {
          const i = events.findIndex(({ tS }, index) =>
            tS >= time - 1e-9 && Number.isFinite(values[index]) && reached(values[index]));
          return Math.round((events[i].tS - time) * 1000);
        };
        lags[key].push(lagMs(observed));
        rawLags[key].push(lagMs(raw));
      }
      const fastSteady = observed.filter((_, i) => events[i].tS >= fast + 1.2 && events[i].tS < slow);
      expect(fastSteady.every((flow) => Math.abs(flow - 12) < 2.4)).toBe(true);
      expect(fastSteady.reduce((sum, flow) => sum + flow, 0) / fastSteady.length).toBeGreaterThan(11);
    }
    const summarise = (values) => Object.fromEntries(Object.entries(values).map(([key, times]) => {
      const ordered = times.toSorted((a, b) => a - b);
      return [key, { medianMs: (ordered[4] + ordered[5]) / 2, worstMs: ordered.at(-1) }];
    }));
    console.info({ seconds, raw: summarise(rawLags), display: summarise(lags) });
    expect(Math.max(...Object.values(lags).flat())).toBeLessThan(seconds === 0.75 ? 1010 : 1110);
  });
});

it('expires the readout without a new notification and re-primes after tare or disconnect', () => {
  const show = vi.fn();
  const { session, send } = startSession({ onDisplayFlowSample: show });
  const observation = (offsetMs, weightG) => send({ offsetMs, weightG });
  [0, 200, 400].forEach((ms) => observation(ms, ms / 1000));
  expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ flowGs: expect.closeTo(1) }));
  vi.advanceTimersByTime(500);
  expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ flowGs: expect.closeTo(1) }));
  vi.advanceTimersByTime(1);
  expect(show).toHaveBeenLastCalledWith(null);
  observation(901, 0.9);
  observation(1101, 1.1);
  expect(show).toHaveBeenLastCalledWith(null);
  observation(1301, 1.3);
  expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ breakBefore: true }));

  session.resetDisplayFlow();
  [1401, 1601].forEach((ms) => observation(ms, 0));
  expect(show).toHaveBeenLastCalledWith(null);
  observation(1801, 0);
  expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ flowGs: 0, breakBefore: true }));
  session.dispose();
  expect(show).toHaveBeenLastCalledWith(null);
  const reconnected = startSession({ onDisplayFlowSample: show });
  reconnected.send({ offsetMs: 0, weightG: 0 });
  expect(show).toHaveBeenLastCalledWith(null);
  reconnected.session.dispose();
});

it('suspends both presentation tracks on background, tare and settlement while retaining every recorded weight', () => {
  const smooth = vi.fn();
  const detail = vi.fn();
  const { session, send } = startSession({ onDisplayFlowSample: smooth, onDetailFlowSample: detail });
  const events = [];
  const observe = (...times) => {
    for (const offsetMs of times) {
      const point = { offsetMs, weightG: offsetMs / 1000 };
      events.push(point);
      send(point);
    }
  };
  observe(0, 200, 400);
  for (const show of [smooth, detail]) expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ flowGs: expect.closeTo(1) }));
  session.setDisplayForeground(false);
  observe(500, 600);
  for (const show of [smooth, detail]) expect(show).toHaveBeenLastCalledWith(null);
  session.setDisplayForeground(true);
  observe(700, 900);
  expect(detail).toHaveBeenLastCalledWith(expect.objectContaining({ breakBefore: true }));
  expect(smooth).toHaveBeenLastCalledWith(null);
  observe(1100);
  expect(smooth).toHaveBeenLastCalledWith(expect.objectContaining({ breakBefore: true }));
  session.setDisplayTaring(true);
  observe(1300, 1500, 1700);
  for (const show of [smooth, detail]) expect(show).toHaveBeenLastCalledWith(null);
  session.setDisplayTaring(false);
  observe(1800, 2000, 2200);
  expect(smooth).toHaveBeenLastCalledWith(expect.objectContaining({ breakBefore: true }));
  session.endDisplayFlow();
  observe(2400, 2600, 2800);
  for (const show of [smooth, detail]) expect(show).toHaveBeenLastCalledWith(null);
  expect(session.getShotMetrics().scaleFlowCurve).toEqual(asSamples(events));
  session.dispose();
});

it('breaks the plot when sparse samples leave too little evidence inside the window', () => {
  const estimator = createDisplayFlowEstimator();
  const add = (tS) => estimator.add({ tS, weightG: tS });
  [0, 0.1].forEach(add);
  expect(add(0.4)?.flowGs).toBeCloseTo(1);
  expect(add(0.9)).toBeNull();
  expect(add(1)).toMatchObject({ breakBefore: true, flowGs: expect.closeTo(1) });
});

// Raw session logic at 182f314, before adding the display pipeline.
function baselineRaw(samples) {
  let afterGap = false;
  return samples.flatMap((sample, i) => {
    const previous = samples[i - 1];
    const flowGs = instantaneousFlowGs(previous, sample);
    if (flowGs == null) return [];
    const gap = sample.tS - previous.tS > 0.5;
    const point = { ...sample, flowGs, ...(gap ? { gap } : afterGap ? { breakBefore: true } : {}) };
    afterGap = gap;
    return [point];
  });
}

function stopTrace(series, legacyMode) {
  let detector = createFlowEndDetector();
  return series.map((sample) => {
    detector = stepFlowEndDetector(detector, sample, { legacyMode });
    const { auto } = detector;
    const end = auto.recordedEndExtractionS;
    return {
      freeze: flowEndAutoStopShouldFreezeTimer(auto),
      candidate: flowEndAutoStopDisplayEndS(auto),
      confirmed: flowEndAutoStopShouldStop(auto),
      rule: auto.recordedEndRule,
      end,
      times: end == null ? null : flowEndDisplayedAndSavedTimes(end, { includePreInfusion: true, preInfusionSeconds: 5 }),
    };
  });
}

it.each([false, true])('preserves detector inputs, decisions and history (legacy=%s)', (legacyMode) => {
  const recordings = [
    sampled(160, (t) => 4 * Math.min(t, 6)),
    sampled(180, (t) => 4 * (Math.min(t, 6) + Math.min(3, positivePart(t - 7.4)))),
  ];
  for (const events of recordings) {
    const before = asSamples(events);
    const expectedRaw = baselineRaw(before);
    const raw = [];
    const display = vi.fn();
    const { session, send } = startSession({ onFlowSample: (sample) => raw.push(sample), onDisplayFlowSample: display });
    events.forEach(send);
    session.stopRecording();
    expect(display).toHaveBeenCalledWith(expect.objectContaining({ flowGs: expect.any(Number) }));
    expect(raw).toEqual(expectedRaw);
    const expected = stopTrace(expectedRaw, legacyMode);
    const actual = stopTrace(raw, legacyMode);
    expect(actual).toEqual(expected);
    expect(actual.some(({ freeze }) => freeze)).toBe(true);
    expect(actual.at(-1).confirmed).toBe(true);
    console.info({ legacyMode, samples: raw.length, final: actual.at(-1) });
    const saved = session.getShotMetrics();
    const baseline = {
      scaleFlowCurve: before,
      scaleFlowRateGs: (before.at(-1).weightG - before[0].weightG) / (before.at(-1).tS - before[0].tS),
    };
    expect(saved).toEqual(baseline);
    const shot = { actualTimeS: actual.at(-1).times.savedExtractionS, actualDoseG: 18, actualYieldG: before.at(-1).weightG };
    expect(buildShotProfile({ ...shot, ...saved })).toEqual(buildShotProfile({ ...shot, ...baseline }));
    session.dispose();
  }
});
