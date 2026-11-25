import { describe, expect, it } from 'vitest';
import { buildPressureFlowAnalytics } from './pressureFlowAnalytics.js';

const timings = {
  version: 1, clockDriftMs: 0, pressureSource: 'camera', scaleSource: 'web-bluetooth', scaleInterrupted: false,
  pressureOriginMs: 2100, scaleOriginMs: 2220, extractionStartMs: 2000, extractionEndMs: 3000,
};
const pressure = (...samples) => samples.map(([tS, bar, breakBefore]) => ({ tS, bar, breakBefore }));
const weight = (...samples) => samples.map(([tS, weightG, breakBefore]) => ({ tS, weightG, breakBefore }));

describe('advanced pressure and flow', () => {
  it('uses separate origins, keeps a delayed start, excludes settlement and leaves saved curves intact', () => {
    const shot = {
      shotProfileTiming: timings,
      labPressureCurve: pressure([0, 0], [0.1, 7], [0.25, 7], [0.4, 7], [0.575, 7], [0.7, 7], [0.875, 7]),
      scaleFlowCurve: weight([0.03, 0], [0.18, 0], [0.38, 0.4], [0.53, 1], [0.84, 99]),
    };
    const original = structuredClone(shot);
    const result = buildPressureFlowAnalytics(shot);
    expect(result.pressure[0]).toMatchObject({ tS: 0.1, bar: 0 });
    expect(result.flow[0]).toMatchObject({ fromTS: 0.25, tS: 0.4, flowGs: 0 });
    expect(result.flow).toHaveLength(3);
    expect(result).toMatchObject({ durationS: 1, timeToPeakS: 0.2, observedPeakBar: 7, preinfusionS: 2 });
    expect(result.averageBar).toBeCloseTo(6.6);
    expect(result.bands).toHaveLength(1);
    expect(result.bands[0]).toMatchObject({ minBar: 6, maxBar: 8, count: 3 });
    expect(result.bands[0].averageFlowGs).toBeCloseTo(2);
    expect(shot).toEqual(original);
  });

  it('leaves pauses and notification gaps empty and uses only locally continuous pairs', () => {
    const result = buildPressureFlowAnalytics({
      shotProfileTiming: { ...timings, pressureOriginMs: 2000, scaleOriginMs: 2000, extractionEndMs: 4300 },
      labPressureCurve: pressure([0, 0], [0.15, 0], [0.3, null], [1.5, 7], [1.625, 7, true], [1.75, 7],
        [1.875, 7], [2, 7], [2.125, 8], [2.25, 8]),
      scaleFlowCurve: weight([0, 0], [0.15, 0], [1.5, 4], [1.625, 4, true], [1.75, 4], [2, 5], [2.25, 7]),
    });
    expect(result.pressure.map(({ breakBefore }) => breakBefore)).toEqual([false, false, true, true, false, false, false, false, false]);
    expect(result.flow.map(({ fromTS, tS }) => [fromTS, tS])).toEqual([[0, 0.15], [1.625, 1.75], [1.75, 2], [2, 2.25]]);
    expect(result).toMatchObject({ observedPeakBar: 8, averageBar: null, timeToPeakS: 2.125,
      pressureCoverage: { interruptions: 2, peakMayBeMissed: true, averageUnavailableReason: 'Less than half of extraction observed' } });
    expect(result.bands).toEqual([{ minBar: 6, maxBar: 8, count: 2, seconds: 0.375, averageFlowGs: 1 / 0.375 }]);
  });

  it('withholds unverified sources, disconnected scale intervals and uncertain extraction timing', () => {
    const shot = {
      labPressureCurve: pressure([0, 3], [0.1, 4]),
      scaleFlowCurve: weight([0, 0], [0.1, 1]),
    };
    for (const shotProfileTiming of [undefined, { ...timings, clockDriftMs: 400 }, { ...timings, extractionEndMs: null }]) {
      expect(buildPressureFlowAnalytics({ ...shot, shotProfileTiming })).toMatchObject({
        pressure: [], flow: [], durationS: null, preinfusionS: null, bands: [],
      });
    }
    expect(buildPressureFlowAnalytics({ ...shot, shotProfileTiming: {
      ...timings, pressureSource: 'simulated', scaleInterrupted: true,
    } })).toMatchObject({
      pressure: [], flow: [], pressureStatus: 'Camera pressure source unverified',
      flowStatus: 'Scale disconnected during recording',
    });
    expect(buildPressureFlowAnalytics({ ...shot, shotProfileTiming: { ...timings, scaleSource: undefined } }))
      .toMatchObject({ flow: [], flowStatus: 'Continuous Bluetooth scale source unverified' });
  });

  it('reports distinct pressure ranges without assigning intervals across a band transition', () => {
    const result = buildPressureFlowAnalytics({
      shotProfileTiming: { ...timings, pressureOriginMs: 2000, scaleOriginMs: 2000 },
      labPressureCurve: pressure([0, 3], [0.125, 3], [0.25, 3], [0.375, 5], [0.5, 5], [0.625, 5]),
      scaleFlowCurve: weight([0, 0], [0.125, 0], [0.25, 0], [0.375, 2], [0.5, 2.25], [0.625, 2.5]),
    });
    expect(result.bands).toEqual([
      { minBar: 2, maxBar: 4, count: 2, seconds: 0.25, averageFlowGs: 0 },
      { minBar: 4, maxBar: 6, count: 2, seconds: 0.25, averageFlowGs: 2 },
    ]);
  });

  it('keeps a measured zero peak distinct from missing pressure and flow', () => {
    const result = buildPressureFlowAnalytics({
      shotProfileTiming: { ...timings, pressureOriginMs: 2000, extractionEndMs: 2300 },
      labPressureCurve: pressure([0, 0], [0.125, 0], [0.25, 0], [0.3, 0]),
      scaleFlowCurve: weight([0, 0], [0.04, null]),
    });
    expect(result).toMatchObject({
      observedPeakBar: 0, averageBar: 0, timeToPeakS: 0, flow: [], flowStatus: 'No usable flow intervals inside extraction',
    });
  });
});

const alignedShot = (samples, overrides = {}) => ({
  shotProfileTiming: { ...timings, pressureOriginMs: 2000, ...overrides },
  labPressureCurve: pressure(...samples),
});

describe('pressure observation coverage', () => {
  const samples = Array.from({ length: 9 }, (_, i) => [i / 8, i]);

  it('retains the time-weighted extraction average and earliest peak for a complete recording', () => {
    const result = buildPressureFlowAnalytics(alignedShot(samples));
    expect(result).toMatchObject({ averageBar: 4, fullExtractionAverageBar: 4, observedPeakBar: 8, timeToPeakS: 1,
      pressureCoverage: { observedS: 1, observedFraction: 1, intervals: 8, interruptions: 0, peakMayBeMissed: false } });
  });

  it('requires both near-complete duration and observed endpoints for the extraction-average label', () => {
    const curve = Array.from({ length: 9 }, (_, i) => [0.05 + i * 0.1125, 6]);
    const nearComplete = buildPressureFlowAnalytics(alignedShot(curve));
    expect(nearComplete.fullExtractionAverageBar).toBeCloseTo(6);
    expect(nearComplete.pressureCoverage.peakMayBeMissed).toBe(true);
    const delayed = curve.map(([tS, bar]) => [tS + 0.01, bar]).slice(1);
    expect(buildPressureFlowAnalytics(alignedShot(delayed))).toMatchObject({
      fullExtractionAverageBar: null, pressureCoverage: { peakMayBeMissed: true },
    });
    const lateStart = Array.from({ length: 23 }, (_, i) => [0.25 + i * 0.125, 6]);
    expect(buildPressureFlowAnalytics(alignedShot(lateStart, { extractionEndMs: 5000 }))).toMatchObject({
      fullExtractionAverageBar: null, pressureCoverage: { observedFraction: 11 / 12, startMissingS: 0.25 },
    });
  });

  it.each([
    ['before peak', 3, 8, 1, 13 / 3],
    ['after peak', 6, 12, 0.25, 5],
  ])('excludes a brief internal gap %s from the integral and retains observed peak time', (where, missing, peak, peakTime, expected) => {
    const curve = samples.filter((_, i) => i !== missing).map(([time, bar], i) =>
      [time, where === 'after peak' && i === 2 ? 12 : bar]);
    const result = buildPressureFlowAnalytics(alignedShot(curve));
    expect(result).toMatchObject({ fullExtractionAverageBar: null, observedPeakBar: peak, timeToPeakS: peakTime,
      pressureCoverage: { observedS: 0.75, observedFraction: 0.75, interruptions: 1, peakMayBeMissed: true } });
    expect(result.averageBar).toBeCloseTo(expected);
  });

  it.each([
    ['start', samples.slice(2), 5, 0.25, 0, 1],
    ['end', samples.slice(0, -2), 3, 0, 0.25, 0.75],
  ])('reports a partial average with a missing extraction %s', (_edge, curve, average, startMissingS, endMissingS, timeToPeakS) => {
    expect(buildPressureFlowAnalytics(alignedShot(curve))).toMatchObject({
      averageBar: average, fullExtractionAverageBar: null, timeToPeakS,
      pressureCoverage: { observedFraction: 0.75, interruptions: 0, startMissingS, endMissingS, peakMayBeMissed: true },
    });
  });

  it('reports a partial average at exactly half coverage across two gaps', () => {
    const result = buildPressureFlowAnalytics(alignedShot(samples.filter((_, i) => ![2, 6].includes(i))));
    expect(result).toMatchObject({ averageBar: 4, fullExtractionAverageBar: null, timeToPeakS: 1,
      pressureCoverage: { observedFraction: 0.5, intervals: 4, interruptions: 2, gaps: [
        { fromTS: 0.125, toTS: 0.375 }, { fromTS: 0.625, toTS: 0.875 },
      ] } });
  });

  it('withholds averages for one valid interval and retains the known observed peak', () => {
    expect(buildPressureFlowAnalytics(alignedShot([[0, 3], [0.125, 5], [0.5, 4]]))).toMatchObject({
      averageBar: null, timeToPeakS: 0.125, observedPeakBar: 5,
      pressureCoverage: { observedFraction: 0.125, averageUnavailableReason: 'Fewer than two continuous pressure intervals' },
    });
  });

  it('distinguishes no samples from uncertainty and keeps pre-infusion independent', () => {
    expect(buildPressureFlowAnalytics(alignedShot([]))).toMatchObject({
      averageBar: null, timeToPeakS: null, pressureCoverage: null, pressureStatus: 'No pressure recording', preinfusionS: 2,
    });
    expect(buildPressureFlowAnalytics(alignedShot(samples, { pressureOriginMs: null }))).toMatchObject({
      averageBar: null, timeToPeakS: null, pressureCoverage: null, pressureStatus: 'Pressure extraction timing is uncertain',
      preinfusionS: 2,
    });
    const beforeExtraction = [[0, 12], [0.125, 12], ...samples.map(([time, bar]) => [time + 0.25, bar])];
    expect(buildPressureFlowAnalytics(alignedShot(beforeExtraction, { pressureOriginMs: 1750, scaleInterrupted: true })))
      .toMatchObject({ preinfusionS: 2, averageBar: 4, observedPeakBar: 8, timeToPeakS: 1, flow: [] });
  });

  it('keeps raw interval flow for bands and uses the History estimator for the curve', () => {
    const shot = { ...alignedShot(samples, { scaleOriginMs: 2000 }), scaleFlowCurve: weight(
      [0, 0], [0.1, 0.1], [0.101, 0.2], [0.25, 0.3], [0.5, 0.6], [0.75, 0.9], [1, 1.2],
    ) };
    const result = buildPressureFlowAnalytics(shot);
    expect(result.flow[1].flowGs).toBeCloseTo(100);
    expect(result.displayFlow.map(({ tS }) => tS)).toEqual([0.25, 0.5, 0.75, 1]);
    for (const { flowGs } of result.displayFlow) expect(flowGs).toBeCloseTo(1.2);
  });
});
