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

  it('hides the ideal profile when measured pressure samples are present', () => {
    renderChart({ pressureSamples: PRESSURE, flairProfile: FLAIR });
    expect(container.querySelector('[data-testid="history-ideal-pressure"]')).toBeNull();
    expect(container.querySelector('[data-testid="history-measured-pressure"]')).not.toBeNull();
  });

  it('shows the ideal profile when no measured pressure samples are recorded', () => {
    renderChart({ flairProfile: FLAIR });
    expect(container.querySelector('[data-testid="history-ideal-pressure"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="history-measured-pressure"]')).toBeNull();
    expect(container.querySelector('[data-testid="history-pressure-axis"]')).not.toBeNull();
  });

  it('does not invent an ideal profile when the saved shot has no Flair profile', () => {
    renderChart({});
    expect(container.querySelector('[data-testid="history-ideal-pressure"]')).toBeNull();
    expect(container.querySelector('[data-testid="history-pressure-axis"]')).toBeNull();
  });

  it('shows compact shot-start time, flow, and pressure axes with seconds and units', () => {
    const longFlow = [
      { tS: 0, weightG: 0 },
      { tS: 10, weightG: 60 },
      { tS: 20, weightG: 120 },
      { tS: 30, weightG: 180 },
    ];
    const longPressure = [
      { tS: 0, bar: 0, confident: true },
      { tS: 15, bar: 5, confident: true },
      { tS: 30, bar: 10, confident: true },
    ];
    renderChart({ flowCurve: longFlow, pressureSamples: longPressure });

    expect([...container.querySelectorAll('[data-testid="history-time-tick"]')].map((tick) => tick.textContent))
      .toEqual(['0s', '10s', '20s', '30s']);
    expect([...container.querySelectorAll('[data-testid="history-flow-tick"]')].map((tick) => tick.textContent))
      .toEqual(['0', '5', '10']);
    expect([...container.querySelectorAll('[data-testid="history-pressure-tick"]')].map((tick) => tick.textContent))
      .toEqual(['0', '5', '10']);
    expect(container.querySelector('[data-testid="history-flow-axis-label"]')?.textContent).toBe('g/s');
  });

  it('plots extraction flow after preinfusion on the shot-start timeline, excluding countdown', () => {
    const countdownSeconds = 3;
    const shotStartSeconds = countdownSeconds;
    const preinfusionEndSeconds = shotStartSeconds + 10;
    const extractionTimeOffsetSec = preinfusionEndSeconds - shotStartSeconds;

    // Both saved curves start at shotStartSeconds; only flow's extraction-relative
    // timestamps need the elapsed preinfusion added back.
    renderChart({ pressureSamples: PRESSURE, flowTimeOffsetSec: extractionTimeOffsetSec });

    const flowPath = container.querySelector('[data-testid="history-flow"]')?.getAttribute('d');
    const pressurePath = container
      .querySelector('[data-testid="history-measured-pressure"]')
      ?.getAttribute('d');

    expect(flowPath).toMatch(/^M 195\.5 /);
    expect(pressurePath).toMatch(/^M 32\.0 /);
  });
});
