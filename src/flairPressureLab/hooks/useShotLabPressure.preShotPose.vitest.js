/**
 * Hook integration: useShotLabPressure keeps feeding the pose sampler after
 * the first lock, then the readable gate shows that live verdict.
 * Confident publisher results stay in the window the whole time.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROCESS_INTERVAL_MS } from '../gaugeConfig.js';
import {
  PRE_SHOT_DIAL_FOUND_CLEAR_MS,
  PRE_SHOT_DIAL_FOUND_LABEL,
  PRE_SHOT_DIAL_NOT_FOUND_LABEL,
  PRE_SHOT_DIAL_SAMPLE_MS,
  PRE_SHOT_DIAL_STABLE_MS,
  createPreShotDialVerdictSampler,
  preShotDialMismatch,
} from '../preShotDialCheck.js';
import {
  createPreShotReadableWindow,
  preShotDialDisplayStatus,
  preShotDialStatusView,
  samplePreShotDialPose,
} from '../preShotReadableStatus.js';

const CAL_HUB = { x: 100, y: 100 };
const CAL_RADIUS = 100;
const CONFIDENT = { bar: 4, fresh: true, reason: 'tap-fresh' };

function createCheck() {
  return {
    sampler: createPreShotDialVerdictSampler(),
    readable: createPreShotReadableWindow(),
    calibration: { hub: CAL_HUB, radius: CAL_RADIUS },
  };
}

/** Pose sample, then the confident publisher result, then the readable gate. */
function push(state, hub, nowMs) {
  const read = { hub, radius: CAL_RADIUS, lost: false };
  const step = samplePreShotDialPose({
    sampler: state.sampler,
    readable: state.readable,
    read,
    calibration: state.calibration,
    nowMs,
  });
  state.readable.note(CONFIDENT, nowMs, read);
  const snap = state.readable.snapshot(nowMs);
  return {
    locked: step.locked,
    poseStatus: step.poseStatus,
    status: preShotDialDisplayStatus({
      poseStatus: step.poseStatus,
      nowMs,
      lastConfidentMs: snap.lastConfidentMs,
      confidentAt: snap.confidentAt,
      rejections: snap.rejections,
    }),
  };
}

function lockFound(state) {
  let t = 0;
  let step = push(state, { ...CAL_HUB }, t);
  while (step.poseStatus !== 'found') {
    t += PRE_SHOT_DIAL_SAMPLE_MS;
    if (t > 8000) throw new Error(`pose stayed ${step.poseStatus}`);
    step = push(state, { ...CAL_HUB }, t);
  }
  expect(step.locked).toBe(true);
  expect(step.status).toBe('found');
  expect(preShotDialStatusView(step.status)).toEqual({
    tone: 'green',
    label: PRE_SHOT_DIAL_FOUND_LABEL,
  });
  return t;
}

describe('pre-shot pose recheck after lock', () => {
  it('the hook keeps sampling after the sampler locks', () => {
    const source = readFileSync(fileURLToPath(new URL('./useShotLabPressure.js', import.meta.url)), 'utf8');
    const start = source.indexOf('const observePreShotDialPose');
    const end = source.indexOf('const notePreShotReadable');
    const fn = source.slice(start, end);
    expect(fn).toContain('samplePreShotDialPose');
    expect(fn).not.toMatch(/preShotDialSamplerLockedRef\.current\)\s*return/);
  });

  it('goes amber when the gauge leaves the calibrated pose while readings stay confident', () => {
    const far = { x: CAL_HUB.x + 80, y: CAL_HUB.y };
    expect(preShotDialMismatch({
      trackedHub: far,
      calibratedHub: CAL_HUB,
      calibratedRadius: CAL_RADIUS,
    })).toBe(true);

    const state = createCheck();
    let t = lockFound(state);
    t += PROCESS_INTERVAL_MS;
    const movedAt = t;
    push(state, far, t);
    t += PROCESS_INTERVAL_MS;
    let step = push(state, far, t);
    expect(step.status).toBe('found');

    while (step.status !== 'not_found') {
      t += PROCESS_INTERVAL_MS;
      if (t - movedAt > 8000) throw new Error(`status stayed ${step.status}`);
      step = push(state, far, t);
    }
    expect(t - movedAt).toBeGreaterThanOrEqual(PRE_SHOT_DIAL_FOUND_CLEAR_MS);
    expect(preShotDialStatusView(step.status)).toEqual({
      tone: 'amber',
      label: PRE_SHOT_DIAL_NOT_FOUND_LABEL,
    });
  });

  it('returns to green when the gauge comes back to the calibrated pose', () => {
    const state = createCheck();
    let t = lockFound(state);
    const far = { x: CAL_HUB.x + 80, y: CAL_HUB.y };
    let step = push(state, far, t);
    while (step.status !== 'not_found') {
      t += PROCESS_INTERVAL_MS;
      if (t > 20000) throw new Error(`status stayed ${step.status}`);
      step = push(state, far, t);
    }

    const back = { x: CAL_HUB.x, y: CAL_HUB.y };
    t += PROCESS_INTERVAL_MS;
    const returnedAt = t;
    step = push(state, back, t);
    expect(step.status).toBe('not_found');
    while (step.status !== 'found') {
      t += PROCESS_INTERVAL_MS;
      if (t - returnedAt > 8000) throw new Error(`status stayed ${step.status}`);
      step = push(state, back, t);
    }
    expect(t - returnedAt).toBeGreaterThanOrEqual(PRE_SHOT_DIAL_STABLE_MS);
    expect(preShotDialStatusView(step.status)).toEqual({
      tone: 'green',
      label: PRE_SHOT_DIAL_FOUND_LABEL,
    });
  });

  it('stays green for jitter inside the mismatch distance', () => {
    const jitters = [
      { x: CAL_HUB.x + 10, y: CAL_HUB.y },
      { x: CAL_HUB.x, y: CAL_HUB.y + 20 },
      { x: CAL_HUB.x - 15, y: CAL_HUB.y - 10 },
      { x: CAL_HUB.x + 40, y: CAL_HUB.y },
    ];
    for (const hub of jitters) {
      expect(preShotDialMismatch({
        trackedHub: hub,
        calibratedHub: CAL_HUB,
        calibratedRadius: CAL_RADIUS,
      })).toBe(false);
    }

    const state = createCheck();
    let t = lockFound(state);
    const steps = Math.ceil((PRE_SHOT_DIAL_FOUND_CLEAR_MS + PRE_SHOT_DIAL_STABLE_MS) / PROCESS_INTERVAL_MS);
    let step;
    for (let i = 0; i < steps; i += 1) {
      t += PROCESS_INTERVAL_MS;
      step = push(state, jitters[i % jitters.length], t);
      expect(step.status).toBe('found');
    }
    expect(preShotDialStatusView(step.status)).toEqual({
      tone: 'green',
      label: PRE_SHOT_DIAL_FOUND_LABEL,
    });
  });
});
