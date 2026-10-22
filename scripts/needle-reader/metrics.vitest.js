import { describe, expect, it } from 'vitest';
import {
  coveragePct,
  flipRatePct,
  jitterRms,
  labelErrorStats,
  rejectionCounts,
  restOffsetBar,
} from './metrics.mjs';

describe('section 7 replay metrics', () => {
  const frames = [
    { timeS: 0, bar: null, tracking: 'CALIBRATING', flags: 'CALIBRATING|tap-wait' },
    { timeS: 0.125, bar: null, tracking: 'CALIBRATING', flags: 'CALIBRATING|tap-wait' },
    { timeS: 1.375, bar: 0.05, tracking: 'TRACKING', flags: 'TRACKING|accepted|tap-track' },
    { timeS: 1.5, bar: 0.08, tracking: 'TRACKING', flags: 'TRACKING|accepted' },
    { timeS: 1.625, bar: 0.04, tracking: 'TRACKING', flags: 'TRACKING|accepted' },
    { timeS: 1.75, bar: 0.06, tracking: 'UNCERTAIN', flags: 'UNCERTAIN|held-flip' },
    { timeS: 1.875, bar: null, tracking: 'LOST', flags: 'LOST|tap-lost' },
  ];

  it('counts a shown reading and leaves calibrating out of coverage', () => {
    expect(coveragePct(frames)).toBeCloseTo((4 / 7) * 100, 5);
    expect(coveragePct([])).toBeNull();
  });

  it('reads rest offset from the first shown bar', () => {
    expect(restOffsetBar(frames)).toBeCloseTo(0.05, 5);
  });

  it('takes the RMS second difference only while the reading is steady', () => {
    const steady = [0, 0, 0, 0].map((bar, i) => ({ timeS: i, bar, tracking: 'TRACKING', flags: 'TRACKING|accepted' }));
    expect(jitterRms(steady)).toBe(0);
    const jump = [
      { timeS: 0, bar: 0, tracking: 'TRACKING' },
      { timeS: 1, bar: 0, tracking: 'TRACKING' },
      { timeS: 2, bar: 3, tracking: 'TRACKING' },
    ];
    expect(jitterRms(jump)).toBeNull();
  });

  it('counts rejection reasons and ignores an accepted frame', () => {
    expect(rejectionCounts(frames)).toEqual({ flip: 1, lost: 1 });
  });
});

describe('section 7 label metrics', () => {
  it('reports leave-one-clip-out median, p90, and wild rate on shown readings', () => {
    const stats = labelErrorStats([
      { barErr: 0.2, predBar: 1 },
      { barErr: -0.4, predBar: 2 },
      { barErr: 1.5, predBar: 3 },
      { barErr: null, predBar: null },
    ]);
    expect(stats.n).toBe(3);
    expect(stats.median).toBeCloseTo(0.4, 5);
    expect(stats.p90).toBeGreaterThan(1);
    expect(stats.wildPct).toBeCloseTo(100 / 3, 5);
  });

  it('counts a tail lock near 180 degrees as a flip', () => {
    expect(flipRatePct([4, 170, 180, null])).toBeCloseTo((2 / 3) * 100, 5);
    expect(flipRatePct([])).toBeNull();
    expect(flipRatePct([10, 20])).toBe(0);
  });
});
