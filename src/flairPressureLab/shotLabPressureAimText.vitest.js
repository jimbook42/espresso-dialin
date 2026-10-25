import { describe, expect, it } from 'vitest';
import { shotLabPressureAimText } from './shotLabPressureAimText.js';

const profile = {
  preinfusionPressure: 3,
  peakPressure: 9,
  taperPressure: 6,
  taperStartTrigger: 'weight',
  peakEndYield: 30,
};

describe('shotLabPressureAimText', () => {
  it('returns null without a flair profile', () => {
    expect(
      shotLabPressureAimText({
        flairProfile: null,
        phaseGoal: { phase: 'peak', targetBar: 9 },
        timerRunning: true,
      }),
    ).toBeNull();
  });

  it('summarises profile before start when pre-infusion is used', () => {
    expect(
      shotLabPressureAimText({
        flairProfile: profile,
        phaseGoal: { phase: 'peak', targetBar: 9 },
        timerRunning: false,
        timerUsePreInfusion: true,
      }),
    ).toBe('Aim: 3 bar pre-infusion, then 9 bar, then 6 bar');
  });

  it('shows first-phase target only before start when peak-only pull', () => {
    expect(
      shotLabPressureAimText({
        flairProfile: { peakPressure: 9 },
        timerRunning: false,
        timerUsePreInfusion: false,
      }),
    ).toBe('Aim: 9.0 bar');
  });

  it('shows pre-infusion aim during live pre phase', () => {
    expect(
      shotLabPressureAimText({
        flairProfile: profile,
        phaseGoal: { phase: 'pre', targetBar: 3 },
        timerRunning: true,
        timerUsePreInfusion: true,
      }),
    ).toBe('Aim: 3 bar');
  });

  it('shows chart-matched pre aim when preinfusionPressure is missing', () => {
    const peakOnly = { peakPressure: 10, preinfusionTime: 5 };
    expect(
      shotLabPressureAimText({
        flairProfile: peakOnly,
        phaseGoal: { phase: 'pre', targetBar: 3.5 },
        timerRunning: true,
        timerUsePreInfusion: true,
      }),
    ).toBe('Aim: 3.5 bar');
  });

  it('summarises pre-infusion before start using chart fallback pressure', () => {
    expect(
      shotLabPressureAimText({
        flairProfile: { peakPressure: 10, preinfusionTime: 5 },
        timerRunning: false,
        timerUsePreInfusion: true,
      }),
    ).toBe('Aim: 3.5 bar pre-infusion, then 10 bar');
  });

  it('shows peak aim with one decimal during extraction', () => {
    expect(
      shotLabPressureAimText({
        flairProfile: profile,
        phaseGoal: { phase: 'peak', targetBar: 9 },
        timerRunning: true,
      }),
    ).toBe('Aim: 9.0 bar');
  });

  it('shows taper arrow from peak to taper pressure', () => {
    expect(
      shotLabPressureAimText({
        flairProfile: profile,
        phaseGoal: { phase: 'taper', targetBar: null, taperBand: { lowBar: 5.1, highBar: 6.3 } },
        timerRunning: true,
      }),
    ).toBe('Aim: 9 → 6 bar');
  });

  it('falls back to taper band when taper pressure missing', () => {
    expect(
      shotLabPressureAimText({
        flairProfile: { peakPressure: 9 },
        phaseGoal: { phase: 'taper', taperBand: { lowBar: 4.25, highBar: 5.25 } },
        timerRunning: true,
      }),
    ).toBe('Aim: 4.3–5.3 bar');
  });

  it('returns null during shot when lab would have no phase target', () => {
    expect(
      shotLabPressureAimText({
        flairProfile: {},
        phaseGoal: { phase: 'peak', targetBar: null },
        timerRunning: true,
      }),
    ).toBeNull();
  });
});
