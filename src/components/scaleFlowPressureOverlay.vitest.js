import { describe, expect, it } from 'vitest';
import {
  idealPressureBarAtShotTime,
  idealPressureSeriesForShot,
} from './scaleFlowPressureOverlay.js';

const PROFILE = {
  preinfusionTime: '5',
  preinfusionPressure: '2',
  peakPressure: '9',
  taperPressure: '6',
};

describe('scaleFlowPressureOverlay', () => {
  it('maps ideal pressure across shot duration', () => {
    const shotMax = 30;
    const series = idealPressureSeriesForShot(PROFILE, shotMax, 10);
    expect(series.length).toBeGreaterThan(2);
    expect(series[0].tS).toBe(0);
    expect(series[series.length - 1].tS).toBe(shotMax);
    const mid = idealPressureBarAtShotTime(PROFILE, 15, shotMax);
    expect(mid).toBeGreaterThan(2);
    expect(mid).toBeLessThanOrEqual(9);
  });

  it('returns empty series without profile data', () => {
    expect(idealPressureSeriesForShot(null, 20)).toEqual([]);
    expect(idealPressureSeriesForShot({}, 20)).toEqual([]);
  });
});
