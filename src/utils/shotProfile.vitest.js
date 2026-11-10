import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildShotProfile, observationAtTime, savedShotMeasurements } from './shotProfile.js';
import { createShotDeviceDiagnostics, shotDeviceDiagnosticsForShot } from '../scales/shotDeviceDiagnostics.js';

const weights = (...samples) => samples.map(([tS, weightG]) => ({ tS, weightG }));
const pressure = (...samples) => samples.map(([tS, bar]) => ({ tS, bar }));
const timed = { version: 1, pressureOriginMs: 0, scaleOriginMs: 0, extractionStartMs: 0, clockDriftMs: 0 };

afterEach(() => vi.useRealTimers());

describe('saved shot measurements', () => {
  it('uses saved observations and derives the ratio from yield and dose', () => {
    expect(savedShotMeasurements({
      actualTimeS: 28, actualDoseG: 18, actualYieldG: 36, brewRatio: '1:7', targetYieldG: 30,
    })).toEqual({ durationS: 28, doseG: 18, yieldG: 36, ratio: 2 });
  });

  it.each([undefined, 0, -1, NaN])('makes ratio unavailable for invalid dose %s', (dose) => {
    expect(savedShotMeasurements({ actualDoseG: dose, actualYieldG: 36 }).ratio).toBeNull();
  });

  it('distinguishes measured zero from missing yield and duration', () => {
    expect(savedShotMeasurements({ actualDoseG: 18, actualYieldG: 0, actualTimeS: 0 }))
      .toEqual({ durationS: 0, doseG: 18, yieldG: 0, ratio: 0 });
    expect(savedShotMeasurements({ actualDoseG: 18, targetYieldG: 30 }))
      .toEqual({ durationS: null, doseG: 18, yieldG: null, ratio: null });
  });

  it('keeps entered yield and final observed scale weight separate', () => {
    const p = buildShotProfile({ actualYieldG: 40, shotProfileTiming: { ...timed, yieldSource: 'manual' },
      scaleFlowCurve: weights([0.2, 34], [0.4, 35]) });
    expect(p).toMatchObject({ yieldG: 40, yieldSource: 'manual', finalWeightG: 35 });
  });

  it('does not display a scale fallback zero without an observation', () => {
    const p = buildShotProfile({ actualDoseG: 18, actualYieldG: 0,
      shotProfileTiming: { ...timed, yieldSource: 'unobserved-scale' } });
    expect(p).toMatchObject({ yieldG: null, ratio: null, finalWeightG: null });
  });
});

describe('recorded series', () => {
  it('takes pressure peak from valid raw observations and leaves dropouts empty', () => {
    const p = buildShotProfile({ recordType: 'standalone-pressure',
      labPressureCurve: [...pressure([0, 0], [0.125, 7], [0.25, 99], [0.375, null], [2, 8], [1, 10]), { tS: 3, bar: 10, confident: false }],
      labPressurePeakBar: 10, flairProfile: { peakPressure: 9 } });
    expect(p.peakPressureBar).toBe(8);
    expect(p.pressure.map(({ tS }) => tS)).toEqual([0, 0.125, 2]);
    expect(p.pressureInterrupted).toBe(true);
    expect(p.displayPressure.at(-1).breakBefore).toBe(true);
    expect(observationAtTime(p.pressure, 1)).toBeNull();
    expect(observationAtTime(p.pressure, 0.125)?.bar).toBe(7);
    expect(buildShotProfile({ labPressurePeakBar: 10 }).peakPressureBar).toBeNull();
  });

  it('smooths flow at observation times and excludes Bluetooth gaps from the average', () => {
    const shot = { scaleFlowRateGs: 100, scaleFlowCurve: weights([0, 0], [0.25, 1], [0.5, 3], [3, 40], [3.25, 41]) };
    const p = buildShotProfile(shot);
    expect(p.flow.map(({ tS }) => tS)).toEqual([0.25, 0.5, 3.25]);
    expect(p.peakFlowGs).toBeGreaterThan(4);
    expect(p.peakFlowGs).toBeLessThan(8);
    expect(p.flow.at(-1)).toEqual({ tS: 3.25, flowGs: 4, breakBefore: true });
    expect(p.averageFlowGs).toBeCloseTo(4 / 0.75);
    expect(p.scaleInterrupted).toBe(true);
    expect(observationAtTime(p.weight, 2)).toBeNull();
    expect(observationAtTime(p.flow, 3)).toBeNull();
    expect(shot.scaleFlowCurve[3]).toEqual({ tS: 3, weightG: 40 });
  });

  it('keeps a single zero-weight observation with no flow', () => {
    const p = buildShotProfile({ scaleFlowCurve: weights([1, 0]) });
    expect(p).toMatchObject({ finalWeightG: 0, averageFlowGs: null, peakFlowGs: null, flow: [] });
    expect(observationAtTime(p.weight, 0.9)).toBeNull();
    expect(observationAtTime(p.weight, 1.1)).toBeNull();
  });

  it('breaks at invalid and out-of-order scale samples', () => {
    const p = buildShotProfile({ scaleFlowCurve: weights([0, 1], [0.1, NaN], [0.2, 4], [0.1, 50], [0.3, 6], [0.5, 7]) });
    expect(p.weight.map(({ breakBefore }) => breakBefore)).toEqual([false, true, true, false]);
    expect(p.flow.map(({ tS }) => tS)).toEqual([0.5]);
    expect(p.averageFlowGs).toBeCloseTo(5);
  });
});

describe('shot clock', () => {
  it.each(['pressure', 'scale', 'both'])('uses saved app time for %s recordings with shared origins', (sensor) => {
    const p = buildShotProfile({
      ...(sensor !== 'scale' ? { labPressureCurve: pressure([0.2, 3]) } : {}),
      ...(sensor !== 'pressure' ? { scaleFlowCurve: weights([0.2, 2]) } : {}),
      shotProfileTiming: { ...timed, extractionEndMs: 1000, stopMs: 1000 },
    });
    expect(p).toMatchObject({ aligned: true, approximate: false, extractionStartS: 0, extractionEndS: 1 });
    if (p.pressure.length) expect(p.pressure[0].tS).toBe(0.2);
    if (p.weight.length) expect(p.weight[0].tS).toBe(0.2);
  });

  it('keeps unequal origins and weight settlement separate from the backdated extraction end', () => {
    const p = buildShotProfile({
      shotProfileTiming: { ...timed, pressureOriginMs: 100, scaleOriginMs: 2050, extractionStartMs: 2000,
        extractionEndMs: 2400, stopMs: 2800, settlementEndMs: 4500 },
      labPressureCurve: pressure([0.15, 1], [2.6, 8]),
      scaleFlowCurve: weights([0.05, 1], [0.25, 2], [0.45, 8], [2.4, 9]),
    });
    expect(p).toMatchObject({ aligned: true, extractionStartS: 2, extractionEndS: 2.4, stopS: 2.8,
      settlementEndS: 4.5, finalWeightG: 9, maxTimeS: 4.5 });
    expect(p.pressure[0].tS).toBe(0.25);
    expect(p.weight[0].tS).toBeCloseTo(2.1);
    expect(p.flow).toHaveLength(1);
    expect(p.averageFlowGs).toBeCloseTo(5);
  });

  it('preserves negative relative scale offsets when the scale starts first', () => {
    const p = buildShotProfile({ shotProfileTiming: { ...timed, scaleOriginMs: -100 },
      scaleFlowCurve: weights([0, 0], [0.2, 1], [0.4, 2]) });
    expect(p.minTimeS).toBe(-0.1);
    expect(p.flow.map(({ tS }) => tS)).toEqual([0.30000000000000004]);
  });

  it('keeps the old lead and formatted pre-infusion prefix approximate', () => {
    const shot = { notes: 'Pre-infusion: 4.2s. Puck prep',
      scaleFlowCurve: weights([0.1, 2]), labPressureCurve: pressure([0.2, 3], [0.5, 4]) };
    const p = buildShotProfile(shot);
    expect(p).toMatchObject({ aligned: false, approximate: true, extractionStartS: null, legacyPreS: 4.2 });
    expect(p.weight[0].tS).toBeCloseTo(4.3);
    expect(p.pressure[0].tS).toBe(0);
    expect(p.pressure[1].tS).toBeCloseTo(0.15);
    expect(buildShotProfile({ ...shot, notes: 'Maybe Pre-infusion: 4.2s. Puck prep' }).weight[0].tS).toBe(0.1);
    expect(buildShotProfile({ ...shot, recordType: 'standalone-pressure' }).pressure[0].tS).toBe(0.2);
  });

  it('blocks cross-sensor comparison when timing metadata is missing or the app clock drifted', () => {
    const shot = { labPressureCurve: pressure([0, 3]), scaleFlowCurve: weights([0, 1]) };
    for (const patch of [{ version: 9 }, { scaleOriginMs: null }, { clockDriftMs: 500 }]) {
      expect(buildShotProfile({ ...shot, shotProfileTiming: { ...timed, ...patch } }))
        .toMatchObject({ aligned: false, approximate: true, extractionEndS: null });
    }
  });

  it.each(['manual', 'automatic'])('persists a %s stop without depending on reloaded diagnostics', (mode) => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const trace = createShotDeviceDiagnostics({});
    trace.start(Date.now(), 0);
    trace.extractionPhaseStart();
    trace.pressureStart(10_050);
    trace.extractionStart(10_100);
    vi.setSystemTime(12_000);
    trace.stop({ mode, monotonicMs: 2000, ...(mode === 'automatic' ? { endExtractionS: 1.4 } : {}) });
    trace.event('yield-settlement-started');
    trace.connect({ model: 'Timemore', transport: 'web-bluetooth' });
    trace.weight({ timestampMs: Date.now(), weightG: 32 });
    vi.setSystemTime(13_500);
    trace.event('yield-settlement-completed');
    trace.freeze({ settled: true, yieldG: 32 });
    const shot = { id: 'no-session', labPressureCurve: pressure([0.2, 3]), scaleFlowCurve: weights([0.1, 1]) };
    const timing = trace.savedProfileTiming(shot, 'scale');
    expect(timing).toMatchObject({ pressureOriginMs: 50, scaleOriginMs: 100, extractionStartMs: 0,
      extractionEndMs: mode === 'manual' ? 2000 : 1500, stopMs: 2000, settlementEndMs: 3500, yieldSource: 'scale' });
    expect(shotDeviceDiagnosticsForShot(shot.id)).toBeNull();
    expect(buildShotProfile(JSON.parse(JSON.stringify({ ...shot, shotProfileTiming: timing }))).aligned).toBe(true);
  });
});
