import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { pressureGapBridges } from './pressureGapBridges.js';
import { ScaleFlowChart } from './ScaleFlowChart.jsx';
import { ShotPressureChart } from './ShotPressureChart.jsx';
import { DiagnosticTrace } from '../flairPressureLab/DiagnosticTrace.jsx';

describe('pressureGapBridges', () => {
  it.each([[0.5, 1], [0.999, 1], [1, 0], [1.5, 0]])(
    'bridges a %s second gap with %s endpoint pairs', (elapsed, count) => {
      const points = Object.freeze([
        Object.freeze({ tS: 0, bar: 2 }),
        Object.freeze({ tS: elapsed, bar: 4, breakBefore: true }),
      ]);
      const bridges = pressureGapBridges(points);
      expect(bridges).toHaveLength(count);
      if (count) {
        expect(bridges[0][0]).toBe(points[0]);
        expect(bridges[0][1]).toBe(points[1]);
      }
    },
  );

  it('does not bridge continuous, empty, single-point or non-increasing readings', () => {
    expect(pressureGapBridges([])).toEqual([]);
    expect(pressureGapBridges([{ tS: 0, bar: 2, breakBefore: true }])).toEqual([]);
    expect(pressureGapBridges([{ tS: 0, bar: 2 }, { tS: 0.125, bar: 3 }])).toEqual([]);
    for (const tS of [0, -1]) {
      expect(pressureGapBridges([{ tS: 0, bar: 2 }, { tS, bar: 3, breakBefore: true }])).toEqual([]);
    }
  });
});

const charts = [
  ['History flow overlay', (samples) => createElement(ScaleFlowChart, {
    pressureSamples: samples,
    flowCurve: [{ tS: 0, weightG: 0 }, { tS: 5, weightG: 15 }],
  }), '2'],
  ['live shot', (samples) => createElement(ShotPressureChart, { samples }), '2'],
  ['saved shot', (samples) => createElement(ShotPressureChart, { samples, savedCurve: true }), '2'],
  ['live/replay diagnostic pressure', (samples) => createElement(DiagnosticTrace, {
    samples: samples.map((s) => ({ t: s.tS * 1000, pressure: s.bar })),
  }), '1.4'],
];

describe.each(charts)('%s rendering', (_name, chart, solidWidth) => {
  it.each([[0.5, 1], [1, 0], [1.5, 0]])(
    'renders %s second gaps with %s dotted bridges without changing stored samples', (elapsed, count) => {
      // Start at zero to cover saved-curve time clamping near shot start.
      const samples = Object.freeze([
        Object.freeze({ tS: 0, bar: 2, confident: true }),
        Object.freeze({ tS: 0.125, bar: null, confident: false }),
        Object.freeze({ tS: elapsed, bar: 4, confident: true }),
        Object.freeze({ tS: elapsed + 0.125, bar: null }),
      ]);
      const before = structuredClone(samples);
      const markup = renderToStaticMarkup(chart(samples));
      expect(samples).toEqual(before);
      const paths = [...markup.matchAll(/<path\b[^>]*>/g)].map(([path]) => path);
      const bridges = paths.filter((path) => path.includes('data-testid="pressure-gap-bridge"'));
      expect(bridges).toHaveLength(count);
      if (count) {
        expect(bridges[0]).toContain('stroke-width="1"');
        expect(bridges[0]).toContain('stroke-dasharray="1 3"');
        expect(bridges[0]).toContain('stroke-linecap="round"');
        const stroke = bridges[0].match(/stroke="([^"]+)"/)[1];
        const solid = paths.find((path) => path.includes(`stroke="${stroke}"`)
          && path.includes(`stroke-width="${solidWidth}"`));
        expect(solid).toBeDefined();
        // The existing solid line still breaks; only the extra dotted SVG joins it.
        expect(solid.match(/M ?/g)).toHaveLength(2);
      }
    },
  );
});
