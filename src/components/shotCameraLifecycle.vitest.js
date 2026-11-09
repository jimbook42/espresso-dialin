/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const camera = vi.hoisted(() => ({ videoRef: { current: null }, start: vi.fn(async () => {}), stop: vi.fn(),
  status: 'live', error: '', revision: 0 }));
const readFrame = vi.hoisted(() => vi.fn());
vi.mock('../flairPressureLab/hooks/useFrontCameraStream.js', async (importOriginal) => ({
  ...await importOriginal(),
  useFrontCameraStream: () => camera,
}));
vi.mock('../flairPressureLab/tapCalibrate.js', async (importOriginal) => ({
  ...await importOriginal(),
  createCalibratedTracker: (calibration) => ({ calibration }),
  readCalibratedFrame: readFrame,
}));
vi.mock('../flairPressureLab/shotLabR7Needle.js', () => ({ r5SampleFromTapFrame: async () => ({}) }));
vi.mock('../flairPressureLab/gaugeSnapshotJpeg.js', () => ({ gaugeSnapshotJpegFromImageData: () => null }));
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
  vi.unstubAllGlobals();
  camera.videoRef.current = null;
  camera.status = 'live';
  camera.revision = 0;
  document.body.innerHTML = '';
});

async function mountReader() {
  vi.stubEnv('VITE_PRESSURE_ALLOW_SIM', 'false');
  const hub = { x: 20, y: 20 };
  const calibration = {
    centre: hub, hub, radius: 16, five: { x: 18, y: 8 }, ten: { x: 31, y: 12 },
    zeroAngleDeg: 200, fiveAngleDeg: 260, tenAngleDeg: 320,
  };
  const reading = { ok: true, fresh: true, bar: 0, needleDeg: 200, needleQuality: .3,
    lost: false, poseVerified: true, hub, radius: 16, tenDeg: 320 };
  const video = { readyState: 2, videoWidth: 40, videoHeight: 40, currentTime: 0, srcObject: {} };
  camera.videoRef.current = video;
  let raf;
  vi.stubGlobal('requestAnimationFrame', (callback) => { raf = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { raf = null; });
  let elapsed = 0;
  const epoch = 1_000_000;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  vi.spyOn(Date, 'now').mockImplementation(() => epoch + elapsed);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage() {},
    getImageData: () => ({ width: 40, height: 40, data: new Uint8ClampedArray(6400).fill(video.currentTime) }),
  });
  let result;
  function Harness({ running }) {
    result = useShotLabPressure({ enabled: true, storedCalibration: calibration, timerSeconds: elapsed / 1000,
      preShotDialCheckSurface: true, timerRunning: running });
    return null;
  }
  root = createRoot(document.createElement('div'));
  const render = (running) => act(async () => root.render(createElement(Harness, { running })));
  await render(false);
  const frame = async ({ step = 334, advance = true } = {}) => {
    elapsed += step;
    if (advance) video.currentTime += 1;
    await act(async () => raf?.());
  };
  return { render, frame, reading, video, result: () => result };
}

describe('shared gauge camera lifecycle', () => {
  it('shows readiness only with new pressure evidence and recovers after a reader exception', async () => {
    const { result, frame, reading } = await mountReader();
    readFrame.mockReturnValue({ ...reading, ok: false, bar: null, fresh: false, needleDeg: null });
    for (let i = 0; i < 8; i++) await frame();
    expect(result().preShotDialStatus).toBe('unreadable');
    readFrame.mockReturnValue(reading);
    await frame();
    expect(result().preShotDialStatus).toBe('found');
    await frame({ step: 1501, advance: false });
    expect(result().preShotDialStatus).toBe('unreadable');
    await frame();
    expect(result().preShotDialStatus).toBe('found');
    readFrame.mockImplementationOnce(() => { throw new Error('capture failed'); });
    await frame();
    expect(result().preShotDialStatus).toBe('paused');
    readFrame.mockReturnValueOnce({ ...reading, ok: false, bar: null, fresh: false, needleDeg: null });
    await frame();
    expect(result().preShotDialStatus).toBe('paused');
    await frame();
    expect(result().preShotDialStatus).toBe('found');
  });

  it('keeps the shot epoch and measured curve across a camera interruption', async () => {
    const { result, render, frame, reading, video } = await mountReader();
    await render(true);
    readFrame.mockReturnValue(reading);
    await frame({ step: 125 });
    expect(result().getShotMetrics().labPressureCurve).toEqual([{ tS: 0.125, bar: 0 }]);
    camera.status = 'interrupted';
    camera.revision++;
    await render(true);
    await frame({ step: 2000, advance: false });
    expect(result().displayBar).toBeNull();
    expect(result().getShotMetrics().labPressureCurve).toHaveLength(1);
    camera.status = 'live';
    camera.revision++;
    video.srcObject = {};
    await render(true);
    await frame({ step: 125, advance: false });
    await frame({ step: 125 });
    await render(false);
    expect(result().getShotMetrics().labPressureCurve).toEqual([
      { tS: 0.125, bar: 0 }, { tS: 2.375, bar: 0 },
    ]);
  });

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
    expect(container.textContent).toContain("Set the lever where it'll be when you press Start.");
    expect(play).toHaveBeenCalled();
    expect(camera.start).not.toHaveBeenCalled();
    expect(camera.stop).not.toHaveBeenCalled();
  });
});
