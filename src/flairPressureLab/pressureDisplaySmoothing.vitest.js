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

  it('rolling average ignores samples outside the window', () => {
    const samples = [
      { tS: 0, bar: 2 },
      { tS: 0.5, bar: 4 },
      { tS: 1.2, bar: 10 },
    ];
    expect(rollingDisplayBar(samples, 1.0)).toBe(3);
    expect(rollingDisplayBar(samples, 1.2)).toBe(7);
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
    expect(display[display.length - 1].bar).toBeLessThan(8);
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

  it('centered bar at a step is not delayed like trailing bar at the same instant', () => {
    const samples = [
      { tS: 1.5, bar: 0 },
      { tS: 2, bar: 10 },
      { tS: 2.5, bar: 10 },
    ];
    const at2 = rollingDisplayBar(samples, 2);
    const centered = rollingCenteredBar(samples, 2);
    expect(centered).toBeGreaterThan(at2);
  });
});
