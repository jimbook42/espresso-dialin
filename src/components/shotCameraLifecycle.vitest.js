/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const camera = vi.hoisted(() => ({ videoRef: { current: null }, start: vi.fn(async () => {}), stop: vi.fn() }));
vi.mock('../flairPressureLab/hooks/useFrontCameraStream.js', () => ({
  useFrontCameraStream: () => ({ ...camera, status: 'live', error: '' }),
}));
vi.mock('../flairPressureLab/opencvRuntime.js', async (importOriginal) => ({
  ...await importOriginal(), loadOpenCv: async () => {},
}));
vi.mock('../flairPressureLab/needleModel.js', async (importOriginal) => ({
  ...await importOriginal(), loadNeedleModel: async () => {},
  isNeedleModelReady: () => true, needleModelStatus: () => 'ready',
}));

import { useShotLabPressure } from '../flairPressureLab/hooks/useShotLabPressure.js';
import { LabGaugeTapCalibrateSheet } from './LabGaugeTapCalibrateSheet.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  document.body.innerHTML = '';
});

describe('shared gauge camera lifecycle', () => {
  it('starts the camera for an uncalibrated live shot after setup was opened and cancelled', async () => {
    vi.stubEnv('VITE_PRESSURE_ALLOW_SIM', 'false');
    let result;
    function Harness(props) {
      result = useShotLabPressure({ enabled: true, storedCalibration: null, timerSeconds: 1,
        weighingViewOpen: false, preShotDialCheckSurface: false, ...props });
      return null;
    }
    const container = document.createElement('div');
    root = createRoot(container);
    await act(async () => root.render(createElement(Harness, {
      calibrateSheetOpen: true, timerRunning: false, cameraPreviewActive: false,
    })));
    expect(camera.start).toHaveBeenCalledTimes(1);
    await act(async () => root.render(createElement(Harness, {
      calibrateSheetOpen: false, timerRunning: false, cameraPreviewActive: false,
    })));
    expect(camera.stop).toHaveBeenCalled();
    await act(async () => root.render(createElement(Harness, {
      calibrateSheetOpen: false, timerRunning: true, cameraPreviewActive: true,
    })));
    expect(camera.start).toHaveBeenCalledTimes(2);
    expect(result.calibrated).toBe(false);
    expect(result.displayBar).toBeNull();
    expect(result.samples).toEqual([]);
  });

  it('gauge setup subscribes to the owner stream without acquiring another camera', async () => {
    const stream = {};
    vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'set').mockImplementation(function (value) {
      Object.defineProperty(this, 'srcObject', { configurable: true, writable: true, value });
    });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const container = document.createElement('div');
    root = createRoot(container);
    await act(async () => root.render(createElement(LabGaugeTapCalibrateSheet, {
      open: true, sourceCamera: { videoRef: { current: { srcObject: stream } }, cameraStatus: 'live' },
    })));
    const video = container.querySelector('video');
    expect(video.srcObject).toBe(stream);
    expect(play).toHaveBeenCalled();
    expect(camera.start).not.toHaveBeenCalled();
    expect(camera.stop).not.toHaveBeenCalled();
  });
});
