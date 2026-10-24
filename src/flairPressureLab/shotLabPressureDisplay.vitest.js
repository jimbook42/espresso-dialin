import { describe, expect, it } from 'vitest';
import {
  shotLabPressurePipelineLive,
  shotLabPressureReadoutVisible,
  shotLabPressureShowLive,
} from './shotLabPressureDisplay.js';

describe('shotLabPressureDisplay', () => {
  it('readout visible on fullscreen timer with lab on (sim or calibrated)', () => {
    expect(
      shotLabPressureReadoutVisible({
        enabled: true,
        displaySurfaceActive: true,
        calibrated: false,
        simMode: true,
      }),
    ).toBe(true);
    expect(
      shotLabPressureReadoutVisible({
        enabled: true,
        displaySurfaceActive: true,
        calibrated: true,
        simMode: false,
      }),
    ).toBe(true);
  });

  it('readout hidden when lab off or surface idle', () => {
    expect(
      shotLabPressureReadoutVisible({
        enabled: false,
        displaySurfaceActive: true,
        calibrated: true,
        simMode: true,
      }),
    ).toBe(false);
    expect(
      shotLabPressureReadoutVisible({
        enabled: true,
        displaySurfaceActive: false,
        calibrated: true,
        simMode: false,
      }),
    ).toBe(false);
  });

  it('showLive requires pipeline live for camera path', () => {
    expect(
      shotLabPressureShowLive({
        enabled: true,
        displaySurfaceActive: true,
        calibrated: true,
        simMode: false,
        cameraStatus: 'starting',
      }),
    ).toBe(false);
    expect(
      shotLabPressureShowLive({
        enabled: true,
        displaySurfaceActive: true,
        calibrated: true,
        simMode: false,
        cameraStatus: 'live',
      }),
    ).toBe(true);
    expect(
      shotLabPressurePipelineLive({ simMode: true, cameraStatus: 'idle' }),
    ).toBe(true);
  });
});
