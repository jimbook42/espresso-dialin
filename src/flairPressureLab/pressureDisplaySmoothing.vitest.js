import { describe, expect, it } from 'vitest';
import {
  PRESSURE_DISPLAY_WINDOW_S,
  labPressureReadoutState,
  peakBarFromRaw,
  rollingDisplayBar,
  pressureChartPointsForDisplay,
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
});
