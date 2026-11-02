import { createPressureCurveFilter } from './pressureCurveFilter.js';
import { describe, expect, it } from 'vitest';
import {
  LAB_PRESSURE_CURVE_LEAD_S,
  PRESSURE_DISPLAY_WINDOW_S,
  labPressureCurvePlotTimeS,
  labPressureReadoutState,
  peakBarFromRaw,
  rollingCenteredBar,
  rollingDisplayBar,
  pressureChartPointsForDisplay,
  pressureChartPointsForSavedCurve,
  pressureChartPointsFromRaw,
} from './pressureDisplaySmoothing.js';

describe('pressureDisplaySmoothing', () => {
  it('uses a 1s default window constant', () => {
    expect(PRESSURE_DISPLAY_WINDOW_S).toBe(1);
  });

  it('does not bridge stale readings between display samples', () => {
    const samples = [
      { tS: 0, bar: 2 },
      { tS: 0.5, bar: 4 },
      { tS: 1.2, bar: 10 },
    ];
    expect(rollingDisplayBar(samples, 1.0)).toBeNull();
    expect(rollingDisplayBar(samples, 1.2)).toBe(10);
  });

  it('peak uses raw confident samples only', () => {
    const samples = [
      { tS: 0, bar: 3, confident: true },
      { tS: 1, bar: 9, confident: true },
      { tS: 2, bar: 20, confident: false },
    ];
    expect(peakBarFromRaw(samples)).toBe(9);
  });

  it('readout marks held values dim and gaps as dashes', () => {
    expect(labPressureReadoutState(4.2, { held: false, gap: false })).toEqual({
      text: '4.2',
      dim: false,
      gap: false,
    });
    expect(labPressureReadoutState(4.2, { held: true, gap: false }).dim).toBe(true);
    expect(labPressureReadoutState(null, { held: false, gap: true }).gap).toBe(true);
  });

  it('chart display smoothing differs from raw points when window spans multiple samples', () => {
    const samples = [
      { tS: 0, bar: 2, confident: true },
      { tS: 0.5, bar: 8, confident: true },
      { tS: 1.0, bar: 8, confident: true },
    ];
    const raw = pressureChartPointsFromRaw(samples);
    const display = pressureChartPointsForDisplay(samples);
    expect(raw[raw.length - 1].bar).toBe(8);
    expect(display[display.length - 1].bar).toBe(8);
  });

  it('plot lead shifts saved-curve times earlier', () => {
    expect(LAB_PRESSURE_CURVE_LEAD_S).toBeGreaterThan(0);
    expect(labPressureCurvePlotTimeS(2)).toBeCloseTo(2 - LAB_PRESSURE_CURVE_LEAD_S, 5);
    expect(labPressureCurvePlotTimeS(0.1)).toBe(0);
  });

  it('saved-curve ramp crosses 50% earlier than trailing display on a synthetic step', () => {
    const samples = [];
    for (let i = 0; i <= 40; i += 1) {
      const tS = i * 0.1;
      const bar = tS < 2 ? 0 : 10;
      samples.push({ tS, bar, confident: true });
    }
    const crossHalf = (points) => {
      for (const p of points) {
        if (p.bar >= 5) return p.tS;
      }
      return null;
    };
    const trailingCross = crossHalf(pressureChartPointsForDisplay(samples));
    const savedCross = crossHalf(pressureChartPointsForSavedCurve(samples));
    expect(trailingCross).not.toBeNull();
    expect(savedCross).not.toBeNull();
    expect(savedCross).toBeLessThan(trailingCross);
  });

  it('follows a drop instead of holding the plateau in the trailing mean', () => {
    const samples = [
      { tS: 0.2, bar: 7.5 },
      { tS: 0.6, bar: 7.4 },
      { tS: 1.0, bar: 7.2 },
      { tS: 1.2, bar: 5.1 },
      { tS: 1.3, bar: 4.6 },
    ];
    expect(rollingDisplayBar(samples, 1.3)).toBeCloseTo(4.6, 5);
  });

  it('centered bar at a step is not delayed like trailing bar at the same instant', () => {
    const samples = [
      { tS: 1.5, bar: 0 },
      { tS: 2, bar: 10 },
      { tS: 2.5, bar: 10 },
    ];
    const at2 = rollingDisplayBar(samples, 2);
    const centered = rollingCenteredBar(samples, 2);
    expect(at2).toBe(10);
    expect(centered).toBeGreaterThan(5);
  });
});

const samplesOf = bars => bars.map((bar, i) => ({ tS: i * 0.125, bar }));

describe('causal pressure display', () => {
  it('does not carry residual smoothing into changes below the repeat-label noise floor', () => {
    const filter = createPressureCurveFilter();
    filter.step(5, 0);
    filter.step(5.15, 125);
    expect(filter.step(5.14, 250)).toBe(5.14);
  });

  it('follows large drops and rises on the first frame after a continuity reset', () => {
    for (const direction of [-1, 1]) {
      const filter = createPressureCurveFilter();
      filter.step(5, 0);
      filter.step(5, 200);
      expect(filter.step(5 + direction * .5, 300)).toBe(5 + direction * .5);
    }
  });

  it('attenuates alternating stationary noise without changing raw samples', () => {
    const samples = samplesOf(Array.from({ length: 80 }, (_, i) => 6 + (i % 2 ? .08 : -.08)));
    const original = structuredClone(samples);
    const shown = pressureChartPointsForDisplay(samples).slice(20);
    expect(Math.max(...shown.map(p => p.bar)) - Math.min(...shown.map(p => p.bar))).toBeLessThan(.12);
    expect(samples).toEqual(original);
  });

  it('has no future dependence and readout matches the live chart', () => {
    const samples = samplesOf([3, 3.1, 3, 3.1, 8]);
    const prefix = pressureChartPointsForDisplay(samples.slice(0, 4));
    expect(pressureChartPointsForDisplay(samples).slice(0, 4)).toEqual(prefix);
    expect(rollingDisplayBar(samples, .375)).toBe(prefix.at(-1).bar);
  });

  it('uses the identical filter for saved charts, retaining only existing time alignment', () => {
    const samples = samplesOf([5, 5.1, 4.9, 5, 5.1]);
    const live = pressureChartPointsForDisplay(samples);
    const saved = pressureChartPointsForSavedCurve(samples);
    expect(saved.map(p => p.bar)).toEqual(live.map(p => p.bar));
    expect(saved.at(-1).tS).toBeCloseTo(live.at(-1).tS - LAB_PRESSURE_CURVE_LEAD_S);
  });

  it('resets and breaks paths for explicit gaps and absent fresh timestamps', () => {
    const samples = [{ tS: 0, bar: 6 }, { tS: .125, bar: null },
      { tS: .25, bar: 4 }, { tS: .75, bar: 8 }];
    expect(pressureChartPointsForDisplay(samples)).toEqual([
      { tS: 0, bar: 6, dim: false, breakBefore: true },
      { tS: .25, bar: 4, dim: false, breakBefore: true },
      { tS: .75, bar: 8, dim: false, breakBefore: true },
    ]);
    expect(rollingDisplayBar(samples, .125)).toBeNull();
    expect(rollingDisplayBar(samples, 1)).toBeNull();
  });

  it('does not blend pressure onset, tracking restart or shot reset', () => {
    const filter = createPressureCurveFilter();
    filter.step(.1, 0);
    expect(filter.step(.3, 125)).toBe(.3);
    filter.step(.35, 250);
    expect(filter.step(7, 375, true)).toBe(7);
    filter.reset();
    expect(filter.step(2, 500)).toBe(2);
  });

  it('adds at most 100 ms equivalent lag on measured ramps and follows drops', () => {
    for (const slope of [.25, 1, 4, -1, -4]) {
      const filter = createPressureCurveFilter();
      for (let i = 0; i <= 40; i++) {
        const raw = 6 + slope * i * .125;
        const shown = filter.step(raw, i * 125);
        expect(Math.abs((raw - shown) / slope) * 1000).toBeLessThanOrEqual(100 + 1e-9);
      }
    }
  });

  it('crosses a one-bar step on the same frame and reaches 90% within 125 ms', () => {
    for (const delta of [-1, 1]) {
      const filter = createPressureCurveFilter();
      filter.step(5, 0);
      const first = filter.step(5 + delta, 125);
      expect((first - 5) / delta).toBeGreaterThan(.9);
      expect(Math.abs(filter.step(5 + delta, 250) - (5 + delta))).toBeLessThan(.1);
    }
  });

});
