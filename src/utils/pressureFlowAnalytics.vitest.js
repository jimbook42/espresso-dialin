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
    expect(result).toMatchObject({ observedPeakBar: 8, averageBar: null, timeToPeakS: null });
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
