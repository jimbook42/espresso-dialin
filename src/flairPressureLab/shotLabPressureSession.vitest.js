import { describe, expect, it } from 'vitest';
import { createShotLabPressureSession } from './shotLabPressureSession.js';

describe('createShotLabPressureSession getShotMetrics', () => {
  it('returns confident samples for the curve', () => {
    const session = createShotLabPressureSession();
    session.begin(0);
    session.pushRaw(5, true, 1000);
    session.pushRaw(6, false, 2000);
    session.pushRaw(7, true, 3000);
    const metrics = session.getShotMetrics();
    expect(metrics.labPressureCurve).toEqual([
      { tS: 1, bar: 5 },
      { tS: 3, bar: 7 },
    ]);
    expect(metrics.labPressurePeakBar).toBe(7);
  });

  it('falls back to low-confidence samples when none are confident', () => {
    const session = createShotLabPressureSession();
    session.begin(0);
    session.pushRaw(4.2, false, 500);
    session.pushRaw(5.1, false, 1500);
    const metrics = session.getShotMetrics();
    expect(metrics.labPressureCurve).toHaveLength(2);
    expect(metrics.labPressurePeakBar).toBe(5.1);
  });

  it('handles a long shot (~120 s, 1200 samples)', () => {
    const session = createShotLabPressureSession();
    const t0 = 1_700_000_000_000;
    session.begin(t0);
    for (let i = 0; i < 1200; i += 1) {
      const tMs = t0 + i * 100;
      const bar = 2 + Math.sin(i / 40) * 4;
      session.pushRaw(bar, i % 17 !== 0, tMs);
    }
    const metrics = session.getShotMetrics();
    expect(metrics.labPressureCurve?.length).toBeGreaterThan(1000);
    expect(metrics.labPressureCurve?.at(-1)?.tS).toBeCloseTo(119.9, 0);
    expect(metrics.labPressurePeakBar).toBeGreaterThan(0);
  });
});
