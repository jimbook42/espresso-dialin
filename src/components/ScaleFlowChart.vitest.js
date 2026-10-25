/**
 * @vitest-environment happy-dom
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScaleFlowChart } from './ScaleFlowChart.jsx';

const FLOW = [
  { tS: 0, weightG: 0 },
  { tS: 5, weightG: 15 },
  { tS: 10, weightG: 30 },
];

const PRESSURE = [
  { tS: 0, bar: 2, confident: true },
  { tS: 5, bar: 8, confident: true },
  { tS: 10, bar: 6, confident: true },
];

const FLAIR = {
  preinfusionTime: '5',
  preinfusionPressure: '2',
  peakPressure: '9',
  taperPressure: '6',
};

let container;
let root;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

function renderChart(props) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(ScaleFlowChart, { flowCurve: FLOW, compact: true, ...props }));
  });
}

describe('ScaleFlowChart history pressure overlay', () => {
  it('flow-only card has no pressure overlay', () => {
    renderChart({});
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('data-pressure-overlay')).toBe('false');
    expect(container.querySelector('[data-testid="history-measured-pressure"]')).toBeNull();
  });

  it('shows measured pressure line when samples provided', () => {
    renderChart({ pressureSamples: PRESSURE, pressurePeakBar: 8.2 });
    expect(container.querySelector('svg')?.getAttribute('data-pressure-overlay')).toBe('true');
    expect(container.querySelector('[data-testid="history-measured-pressure"]')).not.toBeNull();
    expect(container.textContent).toContain('peak 8.2 bar');
  });

  it('shows pressure without ideal profile when flairProfile missing', () => {
    renderChart({ pressureSamples: PRESSURE });
    expect(container.querySelector('[data-testid="history-measured-pressure"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="history-ideal-pressure"]')).toBeNull();
  });

  it('draws ideal profile when flairProfile and pressure data present', () => {
    renderChart({ pressureSamples: PRESSURE, flairProfile: FLAIR });
    expect(container.querySelector('[data-testid="history-ideal-pressure"]')).not.toBeNull();
  });
});
