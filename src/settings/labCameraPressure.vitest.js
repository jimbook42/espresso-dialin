import { describe, expect, it } from 'vitest';
import {
  isLabCameraPressureEnabled,
  labGaugeTapCalibrationFromSettings,
} from './labCameraPressure.js';

describe('labCameraPressure settings', () => {
  it('defaults off when unset', () => {
    expect(isLabCameraPressureEnabled(null)).toBe(false);
    expect(isLabCameraPressureEnabled({})).toBe(false);
    expect(isLabCameraPressureEnabled({ labCameraPressureEnabled: false })).toBe(false);
  });

  it('is on only when explicitly true', () => {
    expect(isLabCameraPressureEnabled({ labCameraPressureEnabled: true })).toBe(true);
  });

  it('reads stored tap calibration', () => {
    expect(labGaugeTapCalibrationFromSettings(null)).toBeNull();
    expect(
      labGaugeTapCalibrationFromSettings({ labGaugeTapCalibration: { calibration: { hub: { x: 1 } } } }),
    ).toEqual({ hub: { x: 1 } });
  });
});
