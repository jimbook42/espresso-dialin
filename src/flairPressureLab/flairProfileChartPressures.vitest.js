import { describe, expect, it } from 'vitest';
import {
  flairProfileChartPreBar,
  flairProfileChartPressures,
} from './flairProfileChartPressures.js';

describe('flairProfileChartPressures', () => {
  it('uses explicit pre-infusion pressure when set', () => {
    expect(flairProfileChartPreBar({ preinfusionPressure: 3, peakPressure: 9 })).toBe(3);
  });

  it('falls back to 35% of peak when pre-infusion pressure is missing', () => {
    expect(flairProfileChartPreBar({ peakPressure: 10 })).toBe(3.5);
  });

  it('falls back to 2 bar when only pre-infusion time is set', () => {
    const p = flairProfileChartPressures({ preinfusionTime: 8, peakPressure: 9 });
    expect(p.preP).toBe(0);
    expect(p.pPre).toBe(3.15);
  });
});
