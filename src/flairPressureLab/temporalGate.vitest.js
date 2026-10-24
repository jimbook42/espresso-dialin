import { describe, expect, it } from 'vitest';
import {
  TEMPORAL_GATE,
  runTemporalGate,
} from './temporalGate.js';

/** R4 rules, with the repair paths switched off. */
const BASE = {
  ...TEMPORAL_GATE,
  recovery: 'off',
  prelock: false,
  classicalCarryS: 0,
  holdGapS: 0,
};

function sample(t, r2Bar, classicalBar, extra = {}) {
  return {
    t,
    r2Bar,
    r2Conf: extra.r2Conf ?? 0.8,
    r2Angle: extra.r2Angle ?? null,
    classicalBar,
    classicalConfidence: extra.classicalConfidence ?? 0.5,
    classicalAngle: extra.classicalAngle ?? null,
    rest: extra.rest === true,
  };
}

describe('temporal gate', () => {
  it('publishes an R2 bar that agrees with the classical median', () => {
    const [frame] = runTemporalGate([sample(0, 1.2, 1.1)], BASE);
    expect(frame.bar).toBeCloseTo(1.2, 5);
    expect(frame.reason).toBe('ok');
  });

  it('withholds a reading when the classical window is empty', () => {
    const [frame] = runTemporalGate([sample(0, 1.2, null, { classicalConfidence: null })], BASE);
    expect(frame.bar).toBeNull();
    expect(frame.reason).toBe('no-classical');
  });

  it('withholds a reading that disagrees with the classical median by more than 1.5 bar', () => {
    const [frame] = runTemporalGate([sample(0, 0, 2)], BASE);
    expect(frame.bar).toBeNull();
    expect(frame.reason).toBe('disagree');
  });

  it('withholds a flickering R2 history', () => {
    const loose = { ...BASE, rateBarPerS: 1e6 };
    const frames = runTemporalGate([
      sample(0, 0, 0),
      sample(0.25, 3, 3),
      sample(0.5, 0, 0),
    ], loose);
    expect(frames[1].bar).toBeNull();
    expect(frames[1].reason).toBe('flicker');
    expect(frames[2].reason).toBe('flicker');
  });

  it('holds a fast step and relocks after three agreeing readings', () => {
    // Flicker is disabled so a 5 bar step is judged by the rate gate alone.
    const config = { ...BASE, flickerJumpBar: 100, disagreeBar: 10 };
    const out = runTemporalGate([
      sample(0, 0, 0),
      sample(0.125, 5, 5),
      sample(0.25, 5, 5),
      sample(0.375, 5.2, 5.2),
    ], config);
    expect(out[0].bar).toBeCloseTo(0, 5);
    expect(out[1].reason).toBe('rate');
    expect(out[1].bar).toBeNull();
    expect(out[2].reason).toBe('rate');
    expect(out[3].bar).toBeCloseTo(5.2, 5);
    expect(out[3].reason).toBe('ok');
  });

  it('pins an accepted rest frame to 0 bar and still withholds a rejected one', () => {
    const accepted = runTemporalGate([
      sample(0, 0.4, 0.3, { rest: true }),
    ], BASE);
    expect(accepted[0].bar).toBe(0);
    expect(accepted[0].reason).toBe('rest');
    const rejected = runTemporalGate([
      sample(0, 4, null, { rest: true, classicalConfidence: null }),
    ], BASE);
    expect(rejected[0].bar).toBeNull();
    expect(rejected[0].reason).toBe('no-classical');
  });

  it('shows a confident classical bar when recovery (a) is on and the needle is not flipped', () => {
    const config = { ...BASE, recovery: 'classical' };
    const shown = runTemporalGate([
      sample(0, 0, 4, { r2Angle: 10, classicalAngle: 80 }),
    ], config);
    expect(shown[0].bar).toBe(4);
    expect(shown[0].reason).toBe('classical');
    const flipped = runTemporalGate([
      sample(0, 0, 4, { r2Angle: 10, classicalAngle: 190 }),
    ], config);
    expect(flipped[0].bar).toBeNull();
  });

  it('widens the agreement band to 2 bar when recovery (b) is on and R2 confidence is above 0.5', () => {
    const config = { ...BASE, recovery: 'wide' };
    const wide = runTemporalGate([sample(0, 0, 1.8, { r2Conf: 0.8 })], config);
    expect(wide[0].bar).toBeCloseTo(0, 5);
    const low = runTemporalGate([sample(0, 0, 1.8, { r2Conf: 0.4 })], config);
    expect(low[0].bar).toBeNull();
    expect(low[0].reason).toBe('disagree');
  });

  it('publishes a pre-lock R2 run once three readings sit within 0.5 bar', () => {
    const config = { ...BASE, prelock: true };
    const frames = runTemporalGate([
      sample(0, 4, null, { classicalConfidence: null }),
      sample(0.125, 4.1, null, { classicalConfidence: null }),
      sample(0.25, 4.2, null, { classicalConfidence: null }),
    ], config);
    expect(frames[0].bar).toBeNull();
    expect(frames[0].reason).toBe('no-classical');
    expect(frames[1].bar).toBeNull();
    expect(frames[2].bar).toBeCloseTo(4.2, 5);
    expect(frames[2].reason).toBe('prelock');
  });

  it('does not pre-lock once a classical reading has been seen', () => {
    const config = { ...BASE, prelock: true };
    const frames = runTemporalGate([
      sample(0, 1, 1),
      sample(1.5, 4, null, { classicalConfidence: null }),
      sample(1.625, 4.1, null, { classicalConfidence: null }),
      sample(1.75, 4.2, null, { classicalConfidence: null }),
    ], config);
    expect(frames[3].bar).toBeNull();
    expect(frames[3].reason).toBe('no-classical');
  });

  it('withholds a pre-lock run whose last three readings spread by more than 0.5 bar', () => {
    const config = { ...BASE, prelock: true };
    const frames = runTemporalGate([
      sample(0, 4, null, { classicalConfidence: null }),
      sample(0.125, 4.6, null, { classicalConfidence: null }),
      sample(0.25, 4, null, { classicalConfidence: null }),
    ], config);
    expect(frames[2].bar).toBeNull();
    expect(frames[2].reason).toBe('no-classical');
  });

  it('carries the last classical median for a second after the window empties', () => {
    const config = { ...BASE, classicalCarryS: 1 };
    const frames = runTemporalGate([
      sample(0, 2, 2),
      sample(1, 2.1, null, { classicalConfidence: null }),
      sample(1.25, 2.2, null, { classicalConfidence: null }),
      sample(2.25, 2.2, null, { classicalConfidence: null }),
    ], config);
    expect(frames[2].bar).toBeCloseTo(2.2, 5);
    expect(frames[2].reason).toBe('ok');
    expect(frames[3].bar).toBeNull();
    expect(frames[3].reason).toBe('no-classical');
  });

  it('holds the last bar for at most half a second when R2 still matches it', () => {
    const config = { ...BASE, holdGapS: 0.5, holdBandBar: 0.5, flickerJumpBar: 100 };
    const frames = runTemporalGate([
      sample(0, 1, 1),
      sample(0.125, 1.1, 8),
      sample(0.7, 1.1, 8),
    ], config);
    expect(frames[0].bar).toBeCloseTo(1, 5);
    expect(frames[1].bar).toBeCloseTo(1, 5);
    expect(frames[1].reason).toBe('hold');
    expect(frames[2].bar).toBeNull();
    expect(frames[2].reason).toBe('disagree');
  });

  it('does not hold a short gap when R2 has moved away from the last bar', () => {
    const config = { ...BASE, holdGapS: 0.5, holdBandBar: 0.5 };
    const frames = runTemporalGate([
      sample(0, 1, 1),
      sample(0.125, 3, 10),
    ], config);
    expect(frames[1].bar).toBeNull();
  });

  it('ships wide recovery, pre-lock, and the half-second hold', () => {
    expect(TEMPORAL_GATE.recovery).toBe('wide');
    expect(TEMPORAL_GATE.prelock).toBe(true);
    expect(TEMPORAL_GATE.prelockCount).toBe(3);
    expect(TEMPORAL_GATE.prelockBandBar).toBe(0.5);
    expect(TEMPORAL_GATE.classicalCarryS).toBe(0);
    expect(TEMPORAL_GATE.holdGapS).toBe(0.5);
    expect(TEMPORAL_GATE.holdBandBar).toBe(0.5);
  });
});
