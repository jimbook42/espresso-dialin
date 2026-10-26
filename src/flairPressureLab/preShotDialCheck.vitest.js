import { describe, expect, it } from 'vitest';
import {
  createDialPoseMismatchDebouncer,
  createPreShotDialVerdictSampler,
  createShotStartDialHintTracker,
  dialPoseWindowSaysFound,
  dialPoseWindowSaysLost,
  preShotDialMismatch,
  PRE_SHOT_DIAL_FOUND_CLEAR_MS,
  PRE_SHOT_DIAL_NOT_FOUND_MIN_MS,
  PRE_SHOT_DIAL_STABLE_MS,
} from './preShotDialCheck.js';

describe('preShotDialCheck', () => {
  const calHub = { x: 0, y: 0 };
  const calRadius = 100;

  it('reuses shot-start mismatch rules', () => {
    expect(
      preShotDialMismatch({
        trackedHub: { x: 10, y: 0 },
        calibratedHub: calHub,
        calibratedRadius: calRadius,
      }),
    ).toBe(false);
    expect(
      preShotDialMismatch({
        trackedHub: { x: 80, y: 0 },
        calibratedHub: calHub,
        calibratedRadius: calRadius,
      }),
    ).toBe(true);
    expect(
      preShotDialMismatch({ poseLost: true, calibratedHub: calHub, calibratedRadius: calRadius }),
    ).toBe(true);
  });

  it('window helpers treat up to two bad samples as found', () => {
    expect(dialPoseWindowSaysFound([false, false, true, false, false, false])).toBe(true);
    expect(dialPoseWindowSaysLost([false, false, true, true, true, false])).toBe(true);
  });

  it('locks found after a stable good window', () => {
    const sampler = createPreShotDialVerdictSampler({ stableMs: 100 });
    let t = 0;
    for (let i = 0; i < 4; i += 1) {
      expect(sampler.observe(false, t).status).toBe('checking');
      t += 25;
    }
    t += PRE_SHOT_DIAL_STABLE_MS;
    const locked = sampler.observe(false, t);
    expect(locked.status).toBe('found');
    expect(locked.locked).toBe(true);
    expect(sampler.observe(true, t + 5000).status).toBe('found');
  });

  it('single bad frame does not flip locked found', () => {
    const sampler = createPreShotDialVerdictSampler({ stableMs: 50, foundClearMs: 2000 });
    let t = 0;
    for (let i = 0; i < 8; i += 1) {
      sampler.observe(false, t);
      t += 40;
    }
    t += 60;
    expect(sampler.observe(false, t)).toMatchObject({ status: 'found', locked: true });
    expect(sampler.observe(true, t + 50).status).toBe('found');
    expect(sampler.observe(false, t + 100).status).toBe('found');
  });

  it('two bad frames do not lock not_found from checking', () => {
    const sampler = createPreShotDialVerdictSampler({
      stableMs: 100,
      notFoundMinMs: PRE_SHOT_DIAL_NOT_FOUND_MIN_MS,
    });
    let t = 0;
    sampler.observe(true, t);
    sampler.observe(true, t + 50);
    expect(sampler.observe(false, t + 100).status).toBe('checking');
    expect(sampler.observe(false, t + 200).locked).toBe(false);
  });

  it('locks not_found only after sustained bad samples over time', () => {
    const sampler = createPreShotDialVerdictSampler({
      stableMs: 100,
      notFoundMinBad: 5,
      notFoundMinMs: 1500,
    });
    let t = 0;
    for (let i = 0; i < 4; i += 1) {
      expect(sampler.observe(true, t).locked).toBe(false);
      t += 333;
    }
    expect(sampler.observe(true, t).locked).toBe(false);
    t += 600;
    const locked = sampler.observe(true, t);
    expect(locked).toEqual({ status: 'not_found', locked: true });
  });

  it('recovers from not_found to found after sustained good window', () => {
    const sampler = createPreShotDialVerdictSampler({
      stableMs: 100,
      notFoundMinBad: 5,
      notFoundMinMs: 1500,
    });
    let t = 0;
    for (let i = 0; i < 5; i += 1) {
      sampler.observe(true, t);
      t += 350;
    }
    expect(sampler.observe(true, t)).toMatchObject({ status: 'not_found', locked: true });
    for (let i = 0; i < 6; i += 1) {
      sampler.observe(false, t);
      t += 30;
    }
    t += PRE_SHOT_DIAL_STABLE_MS;
    expect(sampler.observe(false, t)).toMatchObject({ status: 'found', locked: true });
  });

  it('clears found only after sustained windowed loss', () => {
    const sampler = createPreShotDialVerdictSampler({
      stableMs: 50,
      foundClearMs: PRE_SHOT_DIAL_FOUND_CLEAR_MS,
    });
    let t = 0;
    for (let i = 0; i < 8; i += 1) {
      sampler.observe(false, t);
      t += 40;
    }
    t += 60;
    expect(sampler.observe(false, t)).toMatchObject({ status: 'found', locked: true });
    t += 100;
    for (let i = 0; i < 8; i += 1) {
      sampler.observe(true, t);
      t += 400;
    }
    t += PRE_SHOT_DIAL_FOUND_CLEAR_MS;
    expect(sampler.observe(true, t).status).toBe('not_found');
  });

  it('static good stream stays found once locked', () => {
    const sampler = createPreShotDialVerdictSampler({ stableMs: 80 });
    let t = 0;
    while (t < 500) {
      const r = sampler.observe(false, t);
      if (r.locked) break;
      t += 80;
    }
    expect(sampler.observe(false, t + 5000)).toMatchObject({ status: 'found', locked: true });
  });
});

describe('createShotStartDialHintTracker', () => {
  it('ignores brief mismatch blips before showing hint', () => {
    const tracker = createShotStartDialHintTracker({ stableMs: 100 });
    expect(tracker.observe(true, 0)).toEqual({ showHint: false, done: false });
    expect(tracker.observe(false, 50)).toEqual({ showHint: false, done: false });
  });

  it('debouncer majority rule', () => {
    const d = createDialPoseMismatchDebouncer();
    for (let i = 0; i < 5; i += 1) d.push(false);
    d.push(true);
    expect(d.saysFound()).toBe(true);
    expect(d.saysLost()).toBe(false);
  });
});
