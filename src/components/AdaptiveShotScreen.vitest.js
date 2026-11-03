/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdaptiveShotScreen, ShotScreenView } from './AdaptiveShotScreen.jsx';
import { ShotScreenCustomizer } from './ShotScreenCustomizer.jsx';
import { ShotScreenPreview } from './ShotScreenPreview.jsx';
import { ShotLabPressureContext } from './ShotLabPressureContext.jsx';
import { drawShotGaugeFrame, drawShotGaugeOverlay, shotGaugeObjectPosition } from './shotGaugeFrame.js';
import { publishScaleLiveWeight, resetScaleLiveWeightStore } from '../scales/scaleLiveWeightStore.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const roots = [];
const values = { pressure: 8.4, weight: 24.6, time: 21.3, flow: 1.8 };
function render(component, props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(component, props)));
  return container;
}
const click = (element) => act(() => element.click());
const bigMetrics = (container) => [...container.querySelectorAll('[data-size="big"]')].map((node) => node.dataset.metric);
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  resetScaleLiveWeightStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('adaptive live shot screen', () => {
  it.each([
    [true, true, ['pressure', 'weight'], ['time', 'flow']],
    [true, false, ['pressure', 'time'], []],
    [false, true, ['weight', 'time'], ['flow']],
    [false, false, ['time'], []],
  ])('renders the metrics for gauge=%s scale=%s', (gauge, scale, big, small) => {
    const container = render(ShotScreenView, { equipment: { gauge, scale }, values, preview: true, targetYieldG: 36, targetTimeS: 30 });
    expect(bigMetrics(container)).toEqual(big);
    expect([...container.querySelectorAll('[data-size="small"]')].map((node) => node.dataset.metric)).toEqual(small);
    expect(container.querySelector('[data-testid="shot-gauge-camera"]')).toBeNull();
    expect(Boolean(container.querySelector('progress'))).toBe(scale);
  });

  it('cycles Minimal by tapping the number without propagating a shot-stop tap', () => {
    const parentClick = vi.fn();
    function Host() {
      return createElement('div', { onClick: parentClick }, createElement(ShotScreenView, {
        settings: { labCameraPressureEnabled: true, shotScreen: { scale: true, minimal: true } }, values, preview: true,
      }));
    }
    const container = render(Host);
    expect(bigMetrics(container)).toEqual(['pressure']);
    for (const next of ['weight', 'time', 'flow', 'pressure']) {
      click(container.querySelector('[aria-label="Cycle big number"]'));
      expect(bigMetrics(container)).toEqual([next]);
      const pressure = container.querySelector('[data-metric="pressure"]');
      expect(pressure.textContent).toContain('8.4');
      if (next !== 'pressure') expect(pressure.innerHTML).toContain('text-4xl');
    }
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('expands and collapses trust view from its toggle and camera tap', () => {
    vi.useFakeTimers();
    const container = render(ShotScreenView, { equipment: { gauge: true, scale: false }, values, preview: true });
    const toggle = container.querySelector('[aria-pressed]');
    const chart = container.querySelector('[data-testid="live-shot-chart"]');
    const metrics = container.querySelector('.shot-hero');
    click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const camera = container.querySelector('.shot-trust-camera--open [data-testid="shot-gauge-camera"]');
    expect(camera.textContent).toContain('8.4');
    expect(camera.querySelector('[data-testid="shot-camera-pressure"]').className).toContain('bottom-3 left-3');
    expect(camera.textContent).not.toContain('Tap to hide gauge');
    expect(container.querySelector('[data-metric="pressure"]').textContent).toContain('8.4');
    expect(container.querySelector('[data-metric="pressure"]').textContent).toContain('bar');
    expect(container.querySelector('[data-metric="pressure"]').textContent).not.toContain('On camera');
    expect(container.querySelector('[data-testid="live-shot-chart"]')).toBe(chart);
    expect(container.querySelector('.shot-hero')).toBe(metrics);
    click(camera);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-testid="live-shot-chart"]')).toBe(chart);
    expect(container.querySelector('.shot-trust-camera').getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[data-metric="pressure"]').textContent).toContain('8.4');
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector('.shot-trust-camera')).toBeNull();
    expect(container.querySelector('[data-testid="shot-gauge-camera"]')).toBeNull();
    expect(container.querySelector('[data-testid="live-shot-chart"]')).toBe(chart);
  });

  it('draws an uncalibrated, unlocked stream in trust view without preview or test-mode bypass', () => {
    let nextFrame;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { nextFrame = callback; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const context = { canvas: null, clearRect: vi.fn() };
    const stream = {};
    // Unit-test media attachment; Happy DOM's native setter requires its own
    // MediaStream implementation, so model just the display's srcObject slot.
    vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'set').mockImplementation(function (value) {
      Object.defineProperty(this, 'srcObject', { configurable: true, writable: true, value });
    });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      context.canvas = this;
      return context;
    });
    const video = { readyState: 2, videoWidth: 640, videoHeight: 480, srcObject: stream };
    const pressure = { enabled: true, calibrated: false, readerUncertain: true, displayBar: null,
      hold: { gap: true }, samples: [], videoRef: { current: video },
      liveFrameRef: { current: { valid: false, fresh: false } } };
    function Host() {
      return createElement(ShotLabPressureContext.Provider, { value: pressure }, createElement(AdaptiveShotScreen, {
        settings: { labCameraPressureEnabled: true, shotScreen: { showGauge: true } }, seconds: 12, scaleEnabled: false,
      }));
    }
    const container = render(Host);
    act(() => nextFrame(100));
    const trustVideo = container.querySelector('[data-testid="shot-trust-video"]');
    expect(trustVideo.srcObject).toBe(stream);
    expect(trustVideo.muted).toBe(true);
    expect(trustVideo.playsInline).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 640, 480);
    expect(container.querySelector('.shot-trust-camera--open')).not.toBeNull();
    expect(container.querySelector('[data-testid="shot-gauge-camera"] canvas')).not.toBeNull();
    expect(container.querySelector('[data-testid="shot-camera-status"]').textContent).toBe('Looking for gauge…');
    const tile = container.querySelector('[data-metric="pressure"]');
    expect(tile.textContent).toContain('--');
    expect(tile.textContent).toContain('bar');
    expect(tile.textContent).not.toContain('On camera');
    expect(container.querySelector('[data-testid="shot-camera-pressure"]').textContent).toContain('--');
  });

  it('shows Camera unavailable inside the trust box when no stream exists', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const container = render(ShotScreenView, {
      settings: { labCameraPressureEnabled: true, shotScreen: { showGauge: true } }, values,
      pressure: { videoRef: { current: null }, calibrated: false },
    });
    expect(container.querySelector('.shot-trust-camera--open')).not.toBeNull();
    expect(container.querySelector('[data-testid="shot-camera-status"]').textContent).toBe('Camera unavailable');
    expect(container.querySelector('[data-metric="pressure"]').textContent).toContain('8.4');
    expect(container.querySelector('[data-metric="pressure"]').textContent).not.toContain('On camera');
  });

  it('keeps the Minimal hero in its full-height centring layer when trust opens', () => {
    vi.useFakeTimers();
    const container = render(ShotScreenView, {
      settings: { labCameraPressureEnabled: true, shotScreen: { minimal: true } }, values, preview: true,
    });
    const screen = container.querySelector('[data-testid="adaptive-shot-screen"]');
    const hero = container.querySelector('[aria-label="Cycle big number"]');
    expect(screen.classList.contains('shot-screen--minimal')).toBe(true);
    expect(hero.classList.contains('shot-minimal-center')).toBe(true);
    expect(hero.parentElement).toBe(screen);
    expect(container.querySelector('.shot-hero')).toBeNull();
    click(container.querySelector('[aria-pressed]'));
    expect(container.querySelector('[aria-label="Cycle big number"]')).toBe(hero);
    expect(container.querySelector('.shot-trust-camera').parentElement).toBe(screen);
    expect(container.querySelector('[data-testid="live-shot-chart"]')).toBeNull();
    click(container.querySelector('[data-testid="shot-gauge-camera"]'));
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector('.shot-trust-camera')).toBeNull();
    expect(hero.parentElement).toBe(screen);
  });

  it('reserves the gauge-only time sub-label and retains its block when trust changes', () => {
    vi.useFakeTimers();
    const container = render(ShotScreenView, { equipment: { gauge: true, scale: false }, values, preview: true });
    const time = container.querySelector('[data-metric="time"]');
    const sublabel = time.querySelector('.shot-time-sublabel');
    const timeMarkup = time.innerHTML;
    expect(sublabel).not.toBeNull();
    expect(sublabel.textContent).toBe('\u00a0');
    const toggle = container.querySelector('[aria-pressed]');
    click(toggle);
    expect(container.querySelector('[data-metric="time"]')).toBe(time);
    expect(time.innerHTML).toBe(timeMarkup);
    click(toggle);
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector('[data-metric="time"]')).toBe(time);
    expect(time.innerHTML).toBe(timeMarkup);
    expect(container.querySelector('.shot-trust-camera')).toBeNull();
  });

  it('removes the hidden camera immediately with reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    const container = render(ShotScreenView, {
      settings: { labCameraPressureEnabled: true, shotScreen: { showGauge: true } }, values, preview: true,
    });
    expect(container.querySelector('.shot-trust-camera')).not.toBeNull();
    click(container.querySelector('[aria-pressed]'));
    expect(container.querySelector('.shot-trust-camera')).toBeNull();
    expect(container.querySelector('[data-testid="shot-gauge-camera"]')).toBeNull();
    expect(container.querySelector('[data-testid="live-shot-chart"]')).not.toBeNull();
  });

  it('uses growing hero/chart regions for scale-only and a distinct timer hero', () => {
    const scale = render(ShotScreenView, { equipment: { gauge: false, scale: true }, values });
    expect(scale.querySelector('.shot-screen--scale .shot-hero')).not.toBeNull();
    expect(scale.querySelector('.shot-live-chart--grow')).not.toBeNull();
    const timer = render(ShotScreenView, { equipment: { gauge: false, scale: false }, values });
    expect(timer.querySelector('.shot-screen--timer .shot-hero')).not.toBeNull();
    expect(timer.querySelector('[aria-label="Cycle big number"]')).toBeNull();
    expect(timer.querySelector('[data-testid="live-shot-chart"]')).toBeNull();
  });

  it('does not turn missing, stale or disconnected sensor readings into numbers', () => {
    const pressure = { enabled: true, calibrated: true, readerUncertain: true, displayBar: null, samples: [] };
    function Host() {
      return createElement(ShotLabPressureContext.Provider, { value: pressure }, createElement(AdaptiveShotScreen, {
        settings: { labCameraPressureEnabled: true, shotScreen: { scale: true, cameraPreview: false } }, seconds: 12, scaleEnabled: true, flowGs: null,
      }));
    }
    const container = render(Host);
    expect(container.querySelector('[data-metric="pressure"]').textContent).toContain('--');
    expect(container.querySelector('[data-metric="weight"]').textContent).toContain('—');
    expect(container.textContent).toContain('Pressure uncertain');
    act(() => publishScaleLiveWeight({ isConnected: true, weightTriggersPrimed: false, liveWeightG: 999 }));
    expect(container.querySelector('[data-metric="weight"]').textContent).not.toContain('999');
    act(() => publishScaleLiveWeight({ weightTriggersPrimed: true, liveRelativeWeightG: 24.6 }));
    expect(container.querySelector('[data-metric="weight"]').textContent).toContain('24.6');
    expect(container.querySelector('[data-metric="flow"]').textContent).toContain('—');
    act(() => publishScaleLiveWeight({ isConnected: false }));
    expect(container.querySelector('[data-metric="weight"]').textContent).toContain('—');
  });

  it('plots the provided pressure and flow series', () => {
    const container = render(ShotScreenView, { equipment: { gauge: true, scale: true }, values, preview: true,
      pressure: { samples: [{ tS: 1, bar: 2, confident: true }, { tS: 2, bar: 5, confident: true }] },
      flowSeries: [{ tS: 1, flowGs: 1 }, { tS: 2, flowGs: 2 }],
    });
    const paths = container.querySelectorAll('[data-testid="live-shot-chart"] path');
    expect(paths[1].getAttribute('d')).toContain('M');
    expect(paths[2].getAttribute('d')).toContain('M30.0,30.0 L60.0,5.0');
  });
});

describe('customiser', () => {
  it('scales a full phone layout to fit both preview dimensions without cropping', () => {
    let resize;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    const container = render(ShotScreenPreview, { settings: {} });
    const phone = container.querySelector('[data-testid="shot-screen-preview-phone"]');
    expect(phone.style.width).toBe('390px');
    expect(phone.style.height).toBe('844px');
    expect(phone.textContent).toContain('Stop shot');
    expect(phone.querySelector('[data-layout="timer"]')).not.toBeNull();
    act(() => resize([{ contentRect: { width: 195, height: 422 } }]));
    expect(phone.style.transform).toBe('scale(0.5)');
    act(() => resize([{ contentRect: { width: 195, height: 211 } }]));
    expect(phone.style.transform).toBe('scale(0.25)');
    expect(container.querySelector('[data-testid="shot-screen-preview"]').className).not.toContain('overflow');
  });

  function Harness() {
    const [settings, setSettings] = useState({});
    return createElement(ShotScreenCustomizer, { settings, onPatch: (patch) => setSettings((old) => ({ ...old, ...patch })) });
  }
  it('updates its preview, disables unavailable metrics, and resets recommended settings', () => {
    const container = render(Harness);
    const check = (text) => [...container.querySelectorAll('[role="switch"]')].find((toggle) => toggle.getAttribute('aria-label') === text);
    const preview = () => container.querySelector('[data-testid="shot-screen-preview"]');
    expect(container.querySelectorAll('[role="switch"]').length).toBe(7);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(bigMetrics(preview())).toEqual(['time']);
    expect(container.querySelector('option[value="pressure"]').disabled).toBe(true);
    click(check('Pressure gauge via camera'));
    expect(bigMetrics(preview())).toEqual(['pressure', 'time']);
    click(check('Smart scale'));
    expect(bigMetrics(preview())).toEqual(['pressure', 'weight']);
    const select = container.querySelector('select');
    act(() => { select.value = 'flow'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(bigMetrics(preview())).toEqual(['pressure', 'flow']);
    click(check('Minimal mode'));
    expect(bigMetrics(preview())).toEqual(['flow']);
    click(check('Show gauge'));
    expect(preview().querySelector('[aria-pressed="true"]')).not.toBeNull();
    click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Recommended for my setup'));
    expect(bigMetrics(preview())).toEqual(['pressure', 'weight']);
    expect(check('Minimal mode').getAttribute('aria-checked')).toBe('false');
    click(check('Timer only'));
    expect(bigMetrics(preview())).toEqual(['time']);
    expect(check('Camera preview').disabled).toBe(true);
  });
});

describe('trust camera overlay', () => {
  it('centres a cover crop on the reported gauge hub without changing source coordinates', () => {
    const frame = { hubX: 320, hubY: 240 };
    expect(shotGaugeObjectPosition(frame, 640, 480, 320, 180)).toBe('50.00% 50.00%');
    expect(shotGaugeObjectPosition({ ...frame, hubY: 100 }, 640, 480, 320, 180)).toBe('50.00% 0.00%');
    expect(shotGaugeObjectPosition({ ...frame, hubY: 400 }, 640, 480, 320, 180)).toBe('50.00% 100.00%');
    expect(shotGaugeObjectPosition({ ...frame, hubX: 600 }, 640, 480, 180, 320)).toBe('100.00% 50.00%');
    expect(shotGaugeObjectPosition(null, 640, 480, 320, 180)).toBe('50% 50%');
    expect(frame).toEqual({ hubX: 320, hubY: 240 });
  });

  it('draws the existing needle angle in source-image coordinates and withholds invalid or stale lines', () => {
    const context = { canvas: {}, drawImage: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
    const video = { videoWidth: 640, videoHeight: 480, readyState: 2 };
    const frame = { hubX: 100, hubY: 100, radius: 50, needleDeg: 0, fresh: true, valid: true, observedAtMs: 1000 };
    drawShotGaugeFrame(context, video, frame, 1100);
    expect(context.canvas).toEqual({ width: 640, height: 480 });
    expect(context.moveTo).toHaveBeenCalledWith(100, 100);
    expect(context.lineTo).toHaveBeenCalledWith(146, 100);
    expect(context.stroke).toHaveBeenCalledTimes(1);
    drawShotGaugeFrame(context, video, frame, 2000);
    drawShotGaugeFrame(context, video, { ...frame, valid: false }, 1100);
    drawShotGaugeFrame(context, video, { ...frame, held: true }, 1100);
    drawShotGaugeFrame(context, video, { ...frame, fresh: false }, 1100);
    expect(context.stroke).toHaveBeenCalledTimes(1);
    expect(context.drawImage).toHaveBeenCalledTimes(5);
    drawShotGaugeOverlay(context, video, frame, 1100);
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 640, 480);
    expect(context.stroke).toHaveBeenCalledTimes(2);
    expect(context.drawImage).toHaveBeenCalledTimes(5);
  });
});
