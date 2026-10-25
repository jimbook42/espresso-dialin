/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ShotTimerWeightGoalLine } from './ShotTimerWeightGoalLine.jsx';

function renderLine(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(ShotTimerWeightGoalLine, props));
  });
  return { container, root };
}

describe('ShotTimerWeightGoalLine', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders nothing when setting is off', () => {
    const { container } = renderLine({
      enabled: false,
      scaleConnected: true,
      flairProfile: { taperStartTrigger: 'weight', peakEndYield: '16' },
      targetYieldG: 32,
      timerRunning: true,
      liveRelativeWeightG: 5,
    });
    expect(container.querySelector('[data-testid="shot-timer-weight-goals"]')).toBeNull();
  });

  it('renders goal line when setting is on', () => {
    const { container } = renderLine({
      enabled: true,
      scaleConnected: true,
      flairProfile: { taperStartTrigger: 'weight', peakEndYield: '16' },
      targetYieldG: 32,
      timerRunning: true,
      liveRelativeWeightG: 5,
    });
    const el = container.querySelector('[data-testid="shot-timer-weight-goals"]');
    expect(el?.textContent).toBe('Peak → 16 g · Stop 32 g');
  });
});
