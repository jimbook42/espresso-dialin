import { describe, expect, it } from 'vitest';
import {
  createFlowEmaState,
  FLOW_PLOT_SMOOTH_WINDOW_S,
  SCALE_FLOW_MAX_SAMPLE_GAP_S,
  flowRateSeriesFromWeightCurve,
  smoothFlowSeriesForPlot,
  stepFlowEma,
  summarizeScaleFlow,
} from './flowMetrics.js';

describe('flow plot smoothing', () => {
  it('breaks the plot across a gap without deriving flow from the missing interval', () => {
    expect(flowRateSeriesFromWeightCurve([
      { tS: 0, weightG: 0 },
      { tS: 0.1, weightG: 0.2 },
      { tS: 3, weightG: 4 },
      { tS: 3.125, weightG: 4.5 },
    ], FLOW_PLOT_SMOOTH_WINDOW_S, SCALE_FLOW_MAX_SAMPLE_GAP_S)).toEqual([
      { tS: 0.1, flowGs: 2 },
      { tS: 3.125, flowGs: 4, breakBefore: true },
    ]);
  });

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

  it('matches a full-series EMA when stepped one sample at a time', () => {
    const raw = [];
    for (let t = 0; t <= 30; t += 0.25) {
      const flowGs = t < 8 ? 0.2 : t < 22 ? 2.8 : 0.1;
      raw.push({ tS: t, flowGs });
    }
    const full = smoothFlowSeriesForPlot(raw, FLOW_PLOT_SMOOTH_WINDOW_S);
    let state = createFlowEmaState();
    const stepped = raw.map((sample) => {
      state = stepFlowEma(state, sample, FLOW_PLOT_SMOOTH_WINDOW_S);
      return { tS: sample.tS, flowGs: state.ema };
    });
    expect(stepped.map((p) => p.flowGs)).toEqual(full.map((p) => p.flowGs));
  });
});
