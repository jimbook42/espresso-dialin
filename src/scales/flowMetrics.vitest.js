import { describe, expect, it } from 'vitest';
import {
  FLOW_PLOT_SMOOTH_WINDOW_S,
  flowRateSeriesFromWeightCurve,
  smoothFlowSeriesForPlot,
  summarizeScaleFlow,
} from './flowMetrics.js';

describe('flow plot smoothing', () => {
  it('leaves average flow from weight curve unchanged', () => {
    const samples = [
      { tS: 0, weightG: 0 },
      { tS: 5, weightG: 10 },
      { tS: 10, weightG: 30 },
    ];
    expect(summarizeScaleFlow(samples).averageFlowRateGs).toBe(3);
  });

  it('smooths spiky instantaneous flow for plotting', () => {
    const weightCurve = [
      { tS: 0, weightG: 0 },
      { tS: 1, weightG: 3 },
      { tS: 2, weightG: 3.2 },
      { tS: 3, weightG: 6 },
      { tS: 4, weightG: 6.1 },
      { tS: 5, weightG: 9 },
    ];
    const raw = [];
    for (let i = 1; i < weightCurve.length; i += 1) {
      const dt = weightCurve[i].tS - weightCurve[i - 1].tS;
      raw.push({
        tS: weightCurve[i].tS,
        flowGs: (weightCurve[i].weightG - weightCurve[i - 1].weightG) / dt,
      });
    }
    const smoothed = smoothFlowSeriesForPlot(raw, FLOW_PLOT_SMOOTH_WINDOW_S);
    const rawVariance = raw.reduce((s, p) => s + p.flowGs ** 2, 0);
    const smoothVariance = smoothed.reduce((s, p) => s + p.flowGs ** 2, 0);
    expect(smoothVariance).toBeLessThan(rawVariance);
    expect(flowRateSeriesFromWeightCurve(weightCurve).length).toBeGreaterThan(0);
  });
});
