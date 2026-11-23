import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildComparisonProfile, buildShotProfile, formatSavedDose, hasPhysicalShotChart, observationAtTime, savedShotMeasurements } from './shotProfile.js';
import { createShotDeviceDiagnostics, shotDeviceDiagnosticsForShot } from '../scales/shotDeviceDiagnostics.js';
import pressureRecording from '../../scripts/pressure-label/fixtures/batch-2026-11-03/source/lab-replay-a1efe497-pressure.json';

const weights = (...samples) => samples.map(([tS, weightG]) => ({ tS, weightG }));
const pressure = (...samples) => samples.map(([tS, bar]) => ({ tS, bar }));
const timed = { version: 1, pressureOriginMs: 0, scaleOriginMs: 0, extractionStartMs: 0, clockDriftMs: 0 };

afterEach(() => vi.useRealTimers());

it('compacts only physical tracks and preserves aligned gaps on standalone recordings', () => {
  const shot = {
    recordType: 'standalone-pressure',
    labPressureCurve: pressure([0, 0], [0.04, 1], [1.4, 6]),
    scaleFlowCurve: weights([0, 0], [0.2, 1]),
    shotProfileTiming: { ...timed, pressureSource: 'camera', scaleSource: 'simulated', extractionStartMs: 200 },
  };
  expect(hasPhysicalShotChart(shot)).toBe(true);
  expect(buildShotProfile(shot, { physicalOnly: true })).toMatchObject({
    pressure: [
      { tS: 0, bar: 0, breakBefore: false }, { tS: 0.04, bar: 1, breakBefore: false },
      { tS: 1.4, bar: 6, breakBefore: true },
    ],
    aligned: true, extractionStartS: 0.2, pressureInterrupted: true, weight: [], flow: [],
  });
  expect(buildShotProfile(shot).weight).toHaveLength(2);
  expect(hasPhysicalShotChart({ ...shot, shotProfileTiming: null })).toBe(false);
  expect(hasPhysicalShotChart({ ...shot, labPressureCurve: [] })).toBe(false);
});

it('renders a recorded dose with its full precision', () => {
  expect(formatSavedDose(18)).toBe('18.0 g');
  expect(formatSavedDose(18.5)).toBe('18.5 g');
  expect(formatSavedDose(18.73)).toBe('18.73 g');
  expect(formatSavedDose(null)).toBe('Not recorded');
});

describe('comparison profiles', () => {
  it('aligns each stream to extraction start and preserves recorded pressure and its gaps', () => {
    const profile = buildComparisonProfile({
      ...pressureRecording,
      scaleFlowCurve: weights([0.125, 1], [0.375, 2]),
      shotProfileTiming: { ...timed, pressureOriginMs: 500, scaleOriginMs: 2250, extractionStartMs: 2000 },
    });
    expect(profile.pressure.map(({ bar }) => bar)).toEqual(pressureRecording.labPressureCurve.map(({ bar }) => bar));
    expect(profile.pressure[0].tS).toBeCloseTo(pressureRecording.labPressureCurve[0].tS - 1.5);
    expect(profile.pressure[1].breakBefore).toBe(true);
    expect(profile.pressure[2].breakBefore).toBe(false);
    expect(profile.weight.map(({ tS }) => tS)).toEqual([0.375, 0.625]);
    expect(profile.flow).toEqual([{ fromTS: 0.375, tS: 0.625, flowGs: 4, breakBefore: true }]);
  });

  it('preserves missing samples and recorded zeroes, splitting both weight and derived flow', () => {
    const profile = buildComparisonProfile({
      scaleFlowCurve: weights([0, 0], [0.25, 1], [0.375, null], [0.5, 3], [0.75, 2.5], [2, 8], [2.25, 9]),
    });
    expect(profile.weight.map(({ tS, weightG, breakBefore }) => [tS, weightG, breakBefore])).toEqual([
      [0, 0, false], [0.25, 1, false], [0.5, 3, true], [0.75, 2.5, false], [2, 8, true], [2.25, 9, false],
    ]);
    expect(profile.flow.map(({ tS, flowGs, breakBefore }) => [tS, flowGs, breakBefore])).toEqual([
      [0.25, 4, true], [0.75, -2, true], [2.25, 4, true],
    ]);
  });

  it('keeps settling weight while deriving flow only inside the documented extraction interval', () => {
    const profile = buildComparisonProfile({
      shotProfileTiming: { ...timed, extractionStartMs: 250, extractionEndMs: 750 },
      scaleFlowCurve: weights([0, 0], [0.25, 1], [0.5, 2], [0.75, 3], [1, 4]),
    });
    expect(profile.weight.map(({ tS }) => tS)).toEqual([-0.25, 0, 0.25, 0.5, 0.75]);
    expect(profile.flow.map(({ tS }) => tS)).toEqual([0.25, 0.5]);
  });

  it('retains separate recording clocks when extraction alignment is uncertain', () => {
    const shot = { ...pressureRecording, scaleFlowCurve: weights([0.5, 4]), notes: 'Pre-infusion: 4.2s.' };
    for (const [shotProfileTiming, scaleTimingApproximate] of [
      [undefined, true], [{ ...timed, clockDriftMs: 500 }, true], [{ ...timed, pressureOriginMs: null }, false],
    ]) {
      const profile = buildComparisonProfile({ ...shot, shotProfileTiming });
      expect(profile).toMatchObject({
        pressure: [], pressureTimingUnavailable: true,
        scaleTimingApproximate,
        weight: [{ tS: 0.5, weightG: 4 }], flow: [],
      });
      expect(profile.recordingPressure[0].tS).toBe(pressureRecording.labPressureCurve[0].tS);
    }
  });

  it('retains manual shot metrics with empty comparison curves', () => {
    expect(buildComparisonProfile({ actualTimeS: 28, actualDoseG: 18, actualYieldG: 36 })).toMatchObject({
      durationS: 28, doseG: 18, yieldG: 36, pressure: [], weight: [], flow: [], pressureTimingUnavailable: false,
    });
  });
});

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

  it('retains legacy recording times and keeps the historical pre-infusion note approximate', () => {
    const shot = { notes: 'Pre-infusion: 4.2s. Puck prep',
      scaleFlowCurve: weights([0.1, 2]), labPressureCurve: pressure([0.2, 3], [0.5, 4]) };
    const p = buildShotProfile(shot);
    expect(p).toMatchObject({ aligned: false, approximate: true, extractionStartS: null, legacyPreS: 4.2 });
    expect(p.weight[0].tS).toBe(0.1);
    expect(p.pressure[0].tS).toBe(0.2);
    expect(p.pressure[1].tS).toBe(0.5);
    expect(buildShotProfile({ ...shot, notes: 'Maybe Pre-infusion: 4.2s. Puck prep' }).weight[0].tS).toBe(0.1);
    expect(buildShotProfile({ ...shot, recordType: 'standalone-pressure' }).pressure[0].tS).toBe(0.2);
  });

  it('keeps observed scale intervals in an interrupted shot and leaves the end unobserved', () => {
    const shot = {
      shotProfileTiming: { ...timed, scaleInterrupted: true, extractionEndMs: 1500 },
      scaleFlowCurve: weights([0, 0], [0.2, 2], [0.4, 4]),
    };
    for (const build of [buildShotProfile, buildComparisonProfile]) {
      const profile = build(shot);
      expect(profile.weight.map(({ breakBefore }) => breakBefore)).toEqual([false, false, false]);
      expect(profile.flow.map(({ tS }) => tS)).toEqual([0.2, 0.4]);
      expect(observationAtTime(profile.weight, 1)).toBeNull();
    }
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
