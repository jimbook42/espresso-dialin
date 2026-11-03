/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdaptiveShotScreen, ShotScreenView } from './AdaptiveShotScreen.jsx';
import { ShotScreenCustomizer } from './ShotScreenCustomizer.jsx';
import { ShotLabPressureContext } from './ShotLabPressureContext.jsx';
import { drawShotGaugeFrame } from './shotGaugeFrame.js';
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
    expect(Boolean(container.querySelector('[data-testid="shot-gauge-camera"]'))).toBe(gauge);
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
    const container = render(ShotScreenView, { equipment: { gauge: true, scale: false }, values, preview: true });
    const toggle = container.querySelector('[aria-pressed]');
    click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="shot-gauge-camera"]').textContent).toContain('8.4');
    expect(container.querySelector('[data-testid="live-shot-chart"]')).toBeNull();
    click(container.querySelector('[data-testid="shot-gauge-camera"]'));
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-testid="live-shot-chart"]')).not.toBeNull();
  });

  it('does not turn missing, stale or disconnected sensor readings into numbers', () => {
    const pressure = { enabled: true, calibrated: true, readerUncertain: true, displayBar: null, samples: [] };
    function Host() {
      return createElement(ShotLabPressureContext.Provider, { value: pressure }, createElement(AdaptiveShotScreen, {
        settings: { labCameraPressureEnabled: true, shotScreen: { scale: true, cameraPreview: false } }, seconds: 12, scaleEnabled: true, flowGs: null,
      }));
    }
    const container = render(Host);
    expect(container.querySelector('[data-metric="pressure"]').textContent).toContain('—');
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
  it('draws the existing needle angle in source-image coordinates and withholds invalid or stale lines', () => {
    const context = { canvas: {}, drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
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
  });
});
