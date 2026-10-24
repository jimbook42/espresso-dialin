import { describe, expect, it } from 'vitest';

/**
 * Mirrors camera-start gating in useShotLabPressure (no camera when toggle off).
 */
export function shouldStartLabPressureCamera({
  enabled,
  calibrateSheetOpen,
  timerRunning,
  calibrated,
  simMode,
}) {
  if (!enabled) return false;
  if (simMode) return false;
  return calibrateSheetOpen || (timerRunning && calibrated);
}

describe('shot lab pressure camera gating', () => {
  it('never starts camera when toggle is off', () => {
    expect(
      shouldStartLabPressureCamera({
        enabled: false,
        calibrateSheetOpen: true,
        timerRunning: true,
        calibrated: true,
        simMode: false,
      }),
    ).toBe(false);
  });

  it('starts for calibration sheet when enabled', () => {
    expect(
      shouldStartLabPressureCamera({
        enabled: true,
        calibrateSheetOpen: true,
        timerRunning: false,
        calibrated: false,
        simMode: false,
      }),
    ).toBe(true);
  });

  it('starts during shots when calibrated', () => {
    expect(
      shouldStartLabPressureCamera({
        enabled: true,
        calibrateSheetOpen: false,
        timerRunning: true,
        calibrated: true,
        simMode: false,
      }),
    ).toBe(true);
  });
});
