import { describe, expect, it } from 'vitest';
import {
  isLabCameraPressureEnabled,
  labGaugeTapCalibrationFromSettings,
  labPressureReaderLegacy,
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

  it('keeps the current pressure reader unless v4.13.17 is stored', () => {
    expect(labPressureReaderLegacy(null)).toBe(false);
    expect(labPressureReaderLegacy({})).toBe(false);
    expect(labPressureReaderLegacy({ labPressureReader: 'current' })).toBe(false);
    expect(labPressureReaderLegacy({ labPressureReader: 'v4.13.17' })).toBe(true);
  });
});
