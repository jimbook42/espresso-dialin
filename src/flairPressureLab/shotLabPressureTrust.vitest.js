import { describe, expect, it } from 'vitest';
import {
  LAB_PRESSURE_TESTING_SHOT_COUNT,
  labPressureNeedsGaugeSetup,
  labPressureStatusText,
  labPressureTestingShotLabel,
} from './shotLabPressureTrust.js';

describe('shotLabPressureTrust', () => {
  it('labels first shots as testing', () => {
    expect(labPressureTestingShotLabel(0)).toBe('testing');
    expect(labPressureTestingShotLabel(LAB_PRESSURE_TESTING_SHOT_COUNT - 1)).toBe('testing');
    expect(labPressureTestingShotLabel(LAB_PRESSURE_TESTING_SHOT_COUNT)).toBeNull();
  });

  it('status line under start', () => {
    expect(labPressureStatusText({ enabled: true, calibrated: false })).toBe('Set up gauge');
    expect(labPressureStatusText({ enabled: true, calibrated: true, readerReady: true })).toBe(
      'Pressure ready',
    );
  });

  it('needs setup when uncalibrated or view moved', () => {
    expect(labPressureNeedsGaugeSetup({ calibration: null })).toBe(true);
    expect(labPressureNeedsGaugeSetup({ calibration: {}, viewMoved: true })).toBe(true);
    expect(labPressureNeedsGaugeSetup({ calibration: {}, viewMoved: false })).toBe(false);
  });
});
