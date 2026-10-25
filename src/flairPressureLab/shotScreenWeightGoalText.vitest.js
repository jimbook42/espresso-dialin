import { describe, expect, it } from 'vitest';
import { shotScreenWeightGoalText } from './shotScreenWeightGoalText.js';

const BASE = {
  settingEnabled: true,
  scaleConnected: true,
  scaleFeatureEnabled: true,
  timerRunning: true,
  timerUsePreInfusion: false,
  preInfusionPhase: false,
  extractionElapsedS: 5,
  liveRelativeWeightG: 10,
  targetYieldG: 32,
  targetTimeMaxS: 30,
};

const WEIGHT_TAPER_PROFILE = {
  peakPressure: '9',
  taperPressure: '6',
  taperStartTrigger: 'weight',
  peakEndYield: '16',
};

describe('shotScreenWeightGoalText', () => {
  it('returns null when setting is off', () => {
    expect(
      shotScreenWeightGoalText({
        ...BASE,
        settingEnabled: false,
        flairProfile: WEIGHT_TAPER_PROFILE,
      }),
    ).toBeNull();
  });

  it('returns null when scale is not connected', () => {
    expect(
      shotScreenWeightGoalText({
        ...BASE,
        scaleConnected: false,
        flairProfile: WEIGHT_TAPER_PROFILE,
      }),
    ).toBeNull();
  });

  it('shows peak weight goal and stop during peak phase', () => {
    expect(
      shotScreenWeightGoalText({
        ...BASE,
        flairProfile: WEIGHT_TAPER_PROFILE,
        liveRelativeWeightG: 10,
      }),
    ).toBe('Peak → 16 g · Stop 32 g');
  });

  it('shows taper stop line after peak weight reached', () => {
    expect(
      shotScreenWeightGoalText({
        ...BASE,
        flairProfile: WEIGHT_TAPER_PROFILE,
        liveRelativeWeightG: 18,
      }),
    ).toBe('Taper · Stop 32 g');
  });

  it('shows pre-infusion weight goal in pre phase', () => {
    expect(
      shotScreenWeightGoalText({
        ...BASE,
        timerUsePreInfusion: true,
        preInfusionPhase: true,
        flairProfile: {
          ...WEIGHT_TAPER_PROFILE,
          preinfusionEndTrigger: 'weight',
          preinfusionEndWeightG: '4',
          preinfusionTime: '5',
        },
        liveRelativeWeightG: 2,
      }),
    ).toBe('Pre → 4 g · Stop 32 g');
  });

  it('shows only stop when no weight-triggered stages', () => {
    expect(
      shotScreenWeightGoalText({
        ...BASE,
        flairProfile: {
          taperStartTrigger: 'time',
          taperStartTimeS: '12',
        },
      }),
    ).toBe('Stop 32 g');
  });
});
