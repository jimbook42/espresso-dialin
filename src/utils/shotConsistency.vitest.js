import { describe, expect, it } from 'vitest';
import { createShotDeviceDiagnostics } from '../scales/shotDeviceDiagnostics.js';
import { summarizeShotConsistency } from './shotConsistency.js';

const measure = (shots, key) => summarizeShotConsistency(shots).metrics.find((metric) => metric.key === key);

describe('bean shot consistency', () => {
  it('calculates the median, range and median absolute deviation of saved measurements', () => {
    const shots = [
      { actualTimeS: 30, actualDoseG: 18, actualYieldG: 54, brewRatio: '1:1.0' },
      { actualTimeS: 25, actualDoseG: 16, actualYieldG: 32 },
      { actualTimeS: 40, actualDoseG: 20, actualYieldG: 20 },
      { actualTimeS: 36, actualDoseG: 18, actualYieldG: 72 },
    ];
    expect(measure(shots, 'durationS').stats).toEqual({ median: 33, min: 25, max: 40, variation: 5 });
    expect(measure(shots, 'doseG').stats).toEqual({ median: 18, min: 16, max: 20, variation: 1 });
    expect(measure(shots, 'yieldG').stats).toEqual({ median: 43, min: 20, max: 72, variation: 17 });
    expect(measure(shots, 'ratio').stats).toEqual({ median: 2.5, min: 1, max: 4, variation: 1 });
  });

  it('counts usable measurements per metric and withholds stats below three', () => {
    const shots = [
      { actualTimeS: 29, actualDoseG: 18, actualYieldG: 36 },
      { actualTimeS: 30, actualDoseG: 18, actualYieldG: 36, shotProfileTiming: { version: 1, yieldSource: 'unobserved-scale' } },
      { actualTimeS: 0, actualDoseG: 18, actualYieldG: 0 },
      { actualTimeS: '28', targetYieldG: 36, brewRatio: '1:2.0' },
    ];
    expect(measure(shots, 'durationS')).toMatchObject({ count: 2, missing: 2, stats: null });
    expect(measure(shots, 'doseG')).toMatchObject({ count: 3, missing: 1, stats: { median: 18, variation: 0 } });
    for (const key of ['yieldG', 'ratio']) {
      expect(measure(shots, key)).toMatchObject({ count: 1, missing: 3, stats: null });
    }
  });

  it('counts whole-star ratings and orders recent dated ratings by shot date', () => {
    const result = summarizeShotConsistency([
      { shotRating: 5, timestamp: '2026-02-02' }, { shotRating: 2, timestamp: '2026-02-01' },
      { shotRating: 2, timestamp: 'bad' }, { shotRating: 0 }, {},
    ]);
    expect(result).toMatchObject({ total: 5, ratedCount: 3, distribution: [0, 2, 0, 0, 1] });
    expect(result.recent.map(({ rating }) => rating)).toEqual([2, 5]);
  });

  it('compares measured values descriptively at five rated pairs with different star values', () => {
    const shots = [1, 2, 2, 5, 5].map((shotRating, index) => ({ shotRating, actualTimeS: 26 + index, actualDoseG: index ? 18 : null }));
    expect(measure(shots.slice(1), 'durationS').groups).toEqual([]);
    expect(measure(shots, 'doseG').groups).toEqual([]);
    expect(measure(shots.map((shot) => ({ ...shot, shotRating: 4 })), 'durationS').groups).toEqual([]);
    expect(measure(shots, 'durationS').groups).toEqual([
      { stars: 1, count: 1, median: 26 }, { stars: 2, count: 2, median: 27.5 }, { stars: 5, count: 2, median: 29.5 },
    ]);
  });

  it('includes continuous measured scale flow inside extraction and separates missing and unsupported records', () => {
    const weight = [
      { tS: 0, weightG: 0 }, { tS: 0.25, weightG: 0.5 }, { tS: 0.5, weightG: 1 },
      { tS: 0.75, weightG: 1.5 }, { tS: 1, weightG: 2 }, { tS: 1.25, weightG: 20 },
    ];
    const timing = { version: 1, clockDriftMs: 0, scaleOriginMs: 500, extractionStartMs: 500,
      extractionEndMs: 1500, scaleSource: 'web-bluetooth', scaleInterrupted: false };
    const shot = { scaleFlowCurve: weight, shotProfileTiming: timing };
    const unsupported = [
      { ...shot, shotProfileTiming: { ...timing, scaleSource: undefined } },
      { ...shot, shotProfileTiming: { ...timing, scaleInterrupted: true } },
      { ...shot, scaleFlowCurve: [weight[0], weight[3], weight[4]] },
      { ...shot, shotProfileTiming: { ...timing, extractionEndMs: null } },
    ];
    expect(measure([shot, shot, shot, ...unsupported, {}], 'flow')).toMatchObject({
      count: 3, missing: 1, unsupported: 4, stats: { median: 2, variation: 0 },
    });
    expect(measure([shot, shot], 'flow').stats).toBeNull();
    expect(measure([shot], 'pressure')).toMatchObject({ count: 0, missing: 1, stats: null });
  });

  it('labels current physical scale provenance without treating simulation as measured flow', () => {
    for (const simulated of [false, true]) {
      const trace = createShotDeviceDiagnostics({});
      const start = Date.now();
      trace.start(start, 0);
      trace.extractionPhaseStart(start);
      trace.connect({ transport: simulated ? 'simulated' : 'web-bluetooth', simulated }, start);
      trace.extractionStart(start);
      trace.weight({ timestampMs: start, weightG: 1 });
      trace.stop({ monotonicMs: 0 });
      trace.freeze({ settled: true, yieldG: 1 });
      expect(trace.savedProfileTiming({ scaleFlowCurve: [{ tS: 0, weightG: 1 }] }, 'scale').scaleSource)
        .toBe(simulated ? undefined : 'web-bluetooth');
    }
  });
});
