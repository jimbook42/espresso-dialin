import { describe, expect, it } from 'vitest';
import { interpolateReplaySample, needleTipFromSample } from './shotReplayInterpolation.js';

const samples = [
  { tS: 0, bar: 0, hubX: 100, hubY: 200, radius: 50, needleDeg: 0, valid: true },
  { tS: 1, bar: 2, hubX: 110, hubY: 210, radius: 55, needleDeg: 90, valid: true },
];

describe('interpolateReplaySample', () => {
  it('interpolates bar and hub at mid time', () => {
    const mid = interpolateReplaySample(samples, 0.5);
    expect(mid?.bar).toBeCloseTo(1, 5);
    expect(mid?.hubX).toBeCloseTo(105, 5);
    expect(mid?.hubY).toBeCloseTo(205, 5);
    expect(mid?.radius).toBeCloseTo(52.5, 5);
  });

  it('computes needle tip from hub and angle', () => {
    const tip = needleTipFromSample({
      hubX: 0,
      hubY: 0,
      radius: 100,
      needleDeg: 0,
      valid: true,
      bar: 5,
      tS: 0,
    });
    expect(tip?.x).toBeCloseTo(92, 1);
    expect(tip?.y).toBeCloseTo(0, 1);
  });
});
