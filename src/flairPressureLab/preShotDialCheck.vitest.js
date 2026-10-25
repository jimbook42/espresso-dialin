import { describe, expect, it } from 'vitest';
import {
  createPreShotDialVerdictSampler,
  preShotDialMismatch,
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

  it('locks found after a stable run', () => {
    const sampler = createPreShotDialVerdictSampler({ stableMs: 100 });
    let t = 0;
    expect(sampler.observe(false, t).status).toBe('checking');
    t += 50;
    expect(sampler.observe(false, t).status).toBe('checking');
    t += PRE_SHOT_DIAL_STABLE_MS;
    const locked = sampler.observe(false, t);
    expect(locked.status).toBe('found');
    expect(locked.locked).toBe(true);
    expect(sampler.observe(true, t + 5000).status).toBe('found');
  });

  it('locks not_found when pose stays far', () => {
    const sampler = createPreShotDialVerdictSampler({ stableMs: 50 });
    sampler.observe(true, 0);
    const locked = sampler.observe(true, 100);
    expect(locked).toEqual({ status: 'not_found', locked: true });
  });
});
