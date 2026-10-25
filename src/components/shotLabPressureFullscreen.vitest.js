/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ShotLabPressureReadout } from './ShotLabPressureReadout.jsx';
import { ShotLabPressureIntegration } from './ShotLabPressureIntegration.jsx';
import { ShotLabPressureContext } from './ShotLabPressureContext.jsx';

const PRESSURE_SAMPLES = [
  { tS: 0.5, bar: 2.1, confident: true },
  { tS: 1.2, bar: 4.5, confident: true },
  { tS: 2.0, bar: 6.8, confident: true },
];

function renderReadout(props) {
  const container = document.createElement('div');
  container.className = 'flex flex-col items-center justify-center min-h-0 flex-1';
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(ShotLabPressureReadout, {
        displayBar: 5.2,
        hold: { held: false, gap: false },
        peakBar: 6.8,
        samples: PRESSURE_SAMPLES,
        variant: 'fullscreen',
        viewportWidth: 390,
        ...props,
      }),
    );
  });
  return { container, root };
}

function renderFullscreenIntegration(ctxValue) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        ShotLabPressureContext.Provider,
        { value: ctxValue },
        createElement(ShotLabPressureIntegration, { variant: 'fullscreen', ui: {} }),
      ),
    );
  });
  return { container, root };
}

describe('fullscreen shot lab pressure', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders live bar number, peak chip, aim line, and profile line (not flex-collapsed)', () => {
    const { container } = renderReadout({
      aimText: 'Aim: 9.0 bar',
    });
    const readout = container.querySelector('[data-testid="shot-lab-pressure-readout"]');
    expect(readout).toBeTruthy();
    expect(readout.className).toContain('shrink-0');
    expect(readout.textContent).toMatch(/5\.2/);
    expect(readout.textContent).toMatch(/6\.8 peak/);
    expect(container.querySelector('[data-testid="shot-lab-pressure-aim"]')?.textContent).toBe(
      'Aim: 9.0 bar',
    );
    expect(container.querySelector('[data-testid="shot-pressure-chart"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="shot-pressure-peak-chip"]')).toBeTruthy();
  });

  it('renders aim text before start on weighing variant', () => {
    const { container } = renderReadout({
      variant: 'weighing',
      aimText: 'Aim: 3 bar pre-infusion, then 9 bar',
    });
    const aim = container.querySelector('[data-testid="shot-lab-pressure-aim"]');
    expect(aim?.textContent).toBe('Aim: 3 bar pre-infusion, then 9 bar');
    expect(aim?.className).toContain('text-[14px]');
  });

  it('ShotLabPressureIntegration fullscreen uses readoutVisible with fake feed', () => {
    const { container } = renderFullscreenIntegration({
      enabled: true,
      readoutVisible: true,
      showLive: true,
      calibrated: true,
      timerRunning: true,
      displayBar: 4.1,
      hold: { held: false, gap: false },
      peakBar: 7.2,
      samples: PRESSURE_SAMPLES,
      phaseGoal: { phase: 'peak', targetBar: 9 },
      aimText: 'Aim: 9.0 bar',
      openCalibrate: () => {},
      storedCalibration: true,
    });
    const readout = container.querySelector('[data-testid="shot-lab-pressure-readout"]');
    expect(readout).toBeTruthy();
    expect(readout.textContent).toMatch(/4\.1/);
    expect(container.querySelector('[data-testid="shot-pressure-chart"] svg path')).toBeTruthy();
  });

  it('hides fullscreen readout when lab toggle off', () => {
    const { container } = renderFullscreenIntegration({
      enabled: false,
      readoutVisible: false,
      showLive: false,
      calibrated: false,
      timerRunning: true,
      displayBar: null,
      hold: { held: false, gap: true },
      peakBar: null,
      samples: [],
      openCalibrate: () => {},
      storedCalibration: false,
    });
    expect(container.querySelector('[data-testid="shot-lab-pressure-readout"]')).toBeFalsy();
  });
});
