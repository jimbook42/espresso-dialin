import { describe, expect, it } from 'vitest';
import { shotLabPressurePhaseGoal } from './shotLabPressurePhaseGoal.js';

const profile = {
  preinfusionPressure: 2,
  peakPressure: 9,
  taperPressure: 5,
  taperStartTrigger: 'weight',
  peakEndYield: 30,
};

describe('shotLabPressurePhaseGoal', () => {
  it('selects pre phase during pre-infusion', () => {
    const g = shotLabPressurePhaseGoal({
      flairProfile: profile,
      timerRunning: true,
      timerUsePreInfusion: true,
      preInfusionPhase: true,
      extractionElapsedS: 2,
      liveRelativeWeightG: 0,
      scaleConnected: true,
    });
    expect(g.phase).toBe('pre');
    expect(g.targetBar).toBe(2);
  });

  it('hides taper band before taper begins', () => {
    const g = shotLabPressurePhaseGoal({
      flairProfile: profile,
      timerRunning: true,
      timerUsePreInfusion: false,
      preInfusionPhase: false,
      extractionElapsedS: 5,
      liveRelativeWeightG: 10,
      scaleConnected: true,
    });
    expect(g.phase).toBe('peak');
    expect(g.taperBand).toBeNull();
  });

  it('shows taper easing band once taper phase starts (weight trigger)', () => {
    const g = shotLabPressurePhaseGoal({
      flairProfile: profile,
      timerRunning: true,
      timerUsePreInfusion: false,
      preInfusionPhase: false,
      extractionElapsedS: 20,
      liveRelativeWeightG: 31,
      scaleConnected: true,
    });
    expect(g.phase).toBe('taper');
    expect(g.targetBar).toBeNull();
    expect(g.taperBand?.lowBar).toBeLessThan(g.taperBand?.highBar);
  });
});
