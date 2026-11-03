/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

// Observe the reader/provider boundary without opening a physical camera or
// loading OpenCV/ONNX. Frames below are unit-test observer events, not readings.
const reader = vi.hoisted(() => ({
  options: null,
  videoRef: { current: null },
  getShotMetrics: () => ({}),
  replayObserver: vi.fn(),
}));

vi.mock('../flairPressureLab/hooks/useShotLabPressure.js', () => ({
  useShotLabPressure: (options) => {
    reader.options = options;
    return { videoRef: reader.videoRef, calibrated: true, displayBar: null,
      samples: [], hold: { gap: true }, getShotMetrics: reader.getShotMetrics };
  },
}));
vi.mock('../flairPressureLab/hooks/useLabShotReplay.js', async () => {
  const { useEffect } = await import('react');
  return { useLabShotReplay: ({ replayFrameObserverRef }) => {
    useEffect(() => {
      replayFrameObserverRef.current = reader.replayObserver;
      return () => { replayFrameObserverRef.current = null; };
    }, [replayFrameObserverRef]);
  } };
});
vi.mock('./LabGaugeTapCalibrateSheet.jsx', () => ({ LabGaugeTapCalibrateSheet: () => null }));
vi.mock('../flairPressureLab/hooks/useLabPressureCornerPreviewStyle.js', () => ({ useLabPressureCornerPreviewStyle: () => ({}) }));

import { ShotLabPressureProvider } from './ShotLabPressureContext.jsx';
import { AdaptiveShotScreen } from './AdaptiveShotScreen.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  reader.replayObserver.mockClear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('reader frames while trust camera is hidden', () => {
  it('keeps an uncalibrated owner video mounted from idle into a live shot', () => {
    const container = document.createElement('div');
    root = createRoot(container);
    const settings = { labCameraPressureEnabled: true };
    act(() => root.render(createElement(ShotLabPressureProvider, { settings, timerRunning: false, timerSeconds: 0 })));
    const video = container.querySelector('[data-testid="shot-reader-video"]');
    expect(video).not.toBeNull();
    expect(reader.options.storedCalibration).toBeNull();
    expect(reader.options.cameraPreviewActive).toBe(false);
    act(() => root.render(createElement(ShotLabPressureProvider, { settings, timerRunning: true, timerSeconds: 1 })));
    expect(container.querySelector('[data-testid="shot-reader-video"]')).toBe(video);
    expect(reader.videoRef.current).toBe(video);
    expect(reader.options.cameraPreviewActive).toBe(true);
  });

  it('retains the playing source video and frame observer through show/hide', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const settings = { labCameraPressureEnabled: true, labGaugeTapCalibration: { calibration: {} } };
    act(() => root.render(createElement(ShotLabPressureProvider, { settings, timerRunning: true, timerSeconds: 1 },
      createElement(AdaptiveShotScreen, { settings, seconds: 1, targetTimeS: 30, scaleEnabled: false }))));

    const video = container.querySelector('[data-testid="shot-reader-video"]');
    const observer = reader.options.replayFrameObserverRef.current;
    // Drive the existing frame observer directly; no MediaStream assignment is
    // needed for this UI-boundary test of source-video and observer continuity.
    const play = vi.spyOn(video, 'play').mockResolvedValue();
    const pause = vi.spyOn(video, 'pause');
    // Model the already-started camera stream at this UI boundary.
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    await act(async () => { await video.play(); });
    expect(video.autoplay).toBe(true);
    expect(video.style.position).toBe('absolute');
    expect(video.style.width).toBe('1px');
    expect(video.style.height).toBe('1px');
    expect(video.style.opacity).toBe('0.01');
    expect(video.style.pointerEvents).toBe('none');
    expect(video.style.display).not.toBe('none');
    expect(video.style.visibility).not.toBe('hidden');
    expect(container.querySelector('[data-testid="shot-gauge-camera"]')).toBeNull();

    const emitFrame = (tS) => {
      const frame = { tS, capturedAtSec: tS, fresh: true, valid: false, bar: null };
      observer(frame);
      expect(reader.replayObserver).toHaveBeenLastCalledWith(frame);
    };
    emitFrame(1);
    const toggle = container.querySelector('[aria-pressed]');
    act(() => toggle.click());
    expect(container.querySelector('[data-testid="shot-gauge-camera"]')).not.toBeNull();
    emitFrame(2);
    act(() => toggle.click());
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector('[data-testid="shot-gauge-camera"]')).toBeNull();
    expect(container.querySelector('.shot-trust-camera')).toBeNull();
    expect(container.querySelector('[data-testid="shot-reader-video"]')).toBe(video);
    expect(reader.videoRef.current).toBe(video);
    expect(video.paused).toBe(false);
    expect(reader.options.enabled).toBe(true);
    expect(reader.options.timerRunning).toBe(true);
    expect(reader.options.replayFrameObserverRef.current).toBe(observer);
    emitFrame(3);
    expect(reader.replayObserver).toHaveBeenCalledTimes(3);
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });
});
