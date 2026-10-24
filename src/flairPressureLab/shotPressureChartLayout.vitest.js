import { describe, expect, it } from 'vitest';
import { shotLabPressurePhaseGoal } from './shotLabPressurePhaseGoal.js';
import { shotPressureChartY, shotPressureChartYMax } from './shotPressureChartLayout.js';

const profile = {
  preinfusionPressure: 2,
  peakPressure: 9,
  taperPressure: 6,
  taperStartTrigger: 'time',
  taperStartTimeS: 12,
  peakEndYield: 30,
};

describe('shotPressureChartLayout', () => {
  it('uses recipe peak as Y ceiling so phase goals sit at different heights', () => {
    const pre = shotLabPressurePhaseGoal({
      flairProfile: profile,
      timerRunning: true,
      timerUsePreInfusion: true,
      preInfusionPhase: true,
      extractionElapsedS: 1,
      liveRelativeWeightG: 0,
      scaleConnected: true,
    });
    const peak = shotLabPressurePhaseGoal({
      flairProfile: profile,
      timerRunning: true,
      timerUsePreInfusion: false,
      preInfusionPhase: false,
      extractionElapsedS: 5,
      liveRelativeWeightG: 10,
      scaleConnected: true,
    });
    const padT = 10;
    const chartH = 40;
    const yMax = shotPressureChartYMax({
      chartMaxBar: pre.chartMaxBar,
      sampleBars: [4],
      goalBars: [pre.targetBar, peak.targetBar].filter((v) => v != null),
    });
    const preY = shotPressureChartY(pre.targetBar, yMax, padT, chartH);
    const peakY = shotPressureChartY(peak.targetBar, yMax, padT, chartH);
    expect(preY).toBeGreaterThan(peakY);
  });

  it('has no taper band target line before taper phase', () => {
    const peak = shotLabPressurePhaseGoal({
      flairProfile: profile,
      timerRunning: true,
      timerUsePreInfusion: false,
      preInfusionPhase: false,
      extractionElapsedS: 5,
      liveRelativeWeightG: 10,
      scaleConnected: true,
    });
    expect(peak.targetBar).toBe(9);
    expect(peak.taperBand).toBeNull();
  });
});
