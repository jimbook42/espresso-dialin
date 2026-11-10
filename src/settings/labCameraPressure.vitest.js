import { describe, expect, it } from 'vitest';
import { GAUGE_COMPATIBILITY } from '../flairPressureLab/gaugeCompatibility.js';
import {
  isLabCameraPressureEnabled,
  labGaugeTapCalibrationFromSettings,
  labPressureReaderLegacy,
  labPressureModelTiebreak,
  labPressureScaleLegacy,
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

  it('uses only verified tap calibrations and leaves older settings intact', () => {
    expect(labGaugeTapCalibrationFromSettings(null)).toBeNull();
    for (const compatibility of [undefined, GAUGE_COMPATIBILITY.uncertain, GAUGE_COMPATIBILITY.unsupported]) {
      const calibration = { compatibility, hub: { x: 1 } };
      expect(labGaugeTapCalibrationFromSettings({ labGaugeTapCalibration: { calibration } })).toBeNull();
      expect(calibration.hub).toEqual({ x: 1 });
    }
    const calibration = { compatibility: GAUGE_COMPATIBILITY.supported, hub: { x: 1 } };
    expect(labGaugeTapCalibrationFromSettings({ labGaugeTapCalibration: { calibration } })).toBe(calibration);
  });

  it('keeps the current pressure reader unless v4.13.17 is stored', () => {
    expect(labPressureReaderLegacy(null)).toBe(false);
    expect(labPressureReaderLegacy({})).toBe(false);
    expect(labPressureReaderLegacy({ labPressureReader: 'current' })).toBe(false);
    expect(labPressureReaderLegacy({ labPressureReader: 'v4.13.17' })).toBe(true);
    expect(labPressureReaderLegacy({ labPressureReader: 'v4.13.20' })).toBe(false);
  });

  it('uses the model as a tiebreak unless an older reader is stored', () => {
    expect(labPressureModelTiebreak(null)).toBe(true);
    expect(labPressureModelTiebreak({})).toBe(true);
    expect(labPressureModelTiebreak({ labPressureReader: 'current' })).toBe(true);
    expect(labPressureModelTiebreak({ labPressureReader: 'v4.13.20' })).toBe(false);
    expect(labPressureModelTiebreak({ labPressureReader: 'v4.13.17' })).toBe(false);
    expect(labPressureModelTiebreak({ labPressureReader: 'v4.13.21' })).toBe(true);
  });

  it('keeps the v4.13.21 scale only when that reader is stored', () => {
    expect(labPressureScaleLegacy(null)).toBe(false);
    expect(labPressureScaleLegacy({ labPressureReader: 'current' })).toBe(false);
    expect(labPressureScaleLegacy({ labPressureReader: 'v4.13.21' })).toBe(true);
    expect(labPressureScaleLegacy({ labPressureReader: 'v4.13.20' })).toBe(false);
  });
});
