import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { setOpenCvForTests } from './opencvRuntime.js';
import { calibrateFromTaps, createCalibratedTracker, readCalibratedFrame } from './tapCalibrate.js';
import { createShotLabR7Publisher } from './shotLabR7Live.js';
import { PROCESS_INTERVAL_MS, wrap360 } from './gaugeConfig.js';
import { createPreShotDialVerdictSampler } from './preShotDialCheck.js';
import { createPreShotReadableWindow, samplePreShotDialPose } from './preShotReadableStatus.js';

beforeAll(async () => {
  let cv = createRequire(import.meta.url)('@techstark/opencv-js');
  if (typeof cv.then === 'function') cv = await cv;
  setOpenCvForTests(cv);
});

const home = { x: 180, y: 240, radius: 70 };
const ray = (hub, radius, angle) => ({ x: hub.x + radius * Math.cos(angle * Math.PI / 180),
  y: hub.y + radius * Math.sin(angle * Math.PI / 180) });

// A deterministic dial with asymmetric printed texture and a long thin pointer.
// Transforms apply to pixels, never to reader observations or pressure values.
function dial({ x = home.x, y = home.y, radius = home.radius, rotation = 0,
  angle = 140, serial = 0, blank = false, identity = 0, needle = true, obstruction = false } = {}) {
  const width = 480, height = 480, data = new Uint8ClampedArray(width * height * 4);
  const c = Math.cos(rotation * Math.PI / 180), s = Math.sin(rotation * Math.PI / 180);
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const u = ((px - x) * c + (py - y) * s) * 70 / radius;
    const v = (-(px - x) * s + (py - y) * c) * 70 / radius;
    const r = Math.hypot(u, v), deg = wrap360(Math.atan2(v, u) * 180 / Math.PI);
    let lum = 248;
    if (!blank && r < 77) {
      lum = r >= 66 ? 18 : 224;
      if (identity !== 'circle' && r > 34 && r < 54) {
        lum = 185 + 30 * Math.sin((u + identity * 19) / 3.7) * Math.cos(v / 3.1)
          + 25 * Math.sin(deg * Math.PI / 180 * 7 + r / 3 + identity);
      }
      const a = angle * Math.PI / 180, along = u * Math.cos(a) + v * Math.sin(a);
      const across = -u * Math.sin(a) + v * Math.cos(a);
      if (needle && along > 14 && along < 60 && Math.abs(across) < 1.4) lum = 18;
      if (needle && along < -14 && along > -29 && Math.abs(across) < 4) lum = 18;
    }
    if (obstruction && px > x - radius && px < x + radius && py < y + radius) lum = 135;
    const i = (py * width + px) * 4;
    // One level of changing sensor noise permits genuine new stationary frames.
    data[i] = data[i + 1] = data[i + 2] = lum + ((px + py + serial) % 2);
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function setup() {
  const result = calibrateFromTaps(dial(), { centre: home,
    five: ray(home, 42, 214), ten: ray(home, 42, 302) });
  expect(result.ok).toBe(true);
  expect(Math.abs(result.calibration.zeroAngleDeg - 140)).toBeLessThan(3);
  const tracker = createCalibratedTracker(result.calibration);
  expect(tracker.registration.reference).not.toBeNull();
  return { calibration: result.calibration, tracker,
    publisher: createShotLabR7Publisher(result.calibration), time: 1000, serial: 0,
    sampler: createPreShotDialVerdictSampler(), readable: createPreShotReadableWindow() };
}

function step(state, scene = {}, interval = PROCESS_INTERVAL_MS) {
  const image = dial({ angle: 214, ...scene, serial: ++state.serial });
  const started = performance.now();
  const read = readCalibratedFrame(image, state.tracker);
  const processMs = performance.now() - started;
  const gated = state.publisher.stepFrame({ read, nowMs: state.time, capturedAtMs: state.time });
  const pose = samplePreShotDialPose({ ...state, read, nowMs: state.time });
  state.readable.note(gated, state.time, read);
  const result = { read, gated, pose, processMs, time: state.time };
  state.time += interval;
  return result;
}

const scenarios = [
  ['stationary', {}],
  ['right', { x: 320 }], ['left', { x: 90 }],
  ['up', { y: 110 }], ['down', { y: 350 }],
  ['larger', { radius: 94.5 }], ['smaller', { radius: 45.5 }],
  ['translation/scale/rotation', { x: 320, y: 170, radius: 49, rotation: 12 }],
];

describe('lever movement through the production tap reader and R7 publisher', { timeout: 20000 }, () => {
  for (const [name, scene] of scenarios) it(`reacquires ${name} without changing calibration`, () => {
    const state = setup(), original = JSON.stringify(state.calibration);
    expect(step(state).gated.fresh).toBe(true);
    state.publisher.beginShot(state.time);
    const frames = Array.from({ length: 10 }, () => step(state, scene));
    const fresh = frames.filter(frame => frame.gated.fresh);
    expect(fresh.length, JSON.stringify(frames.map(f => [f.read.lost, f.read.pointerSource, f.gated.reason]))).toBeGreaterThan(0);
    const latencyMs = fresh[0].time - frames[0].time;
    expect(latencyMs).toBeLessThanOrEqual(1000);
    for (const frame of frames) {
      if (frame.read.lost) expect(frame.gated.bar).toBeNull();
      if (frame.gated.fresh) {
        expect(frame.read.poseVerified).toBe(true);
        expect(Math.abs(frame.gated.bar - 5)).toBeLessThan(0.3);
      }
    }
    expect(JSON.stringify(state.calibration)).toBe(original);
    console.log(JSON.stringify({ scenario: name, frames: frames.length, confident: fresh.length,
      latencyMs, worstErrorBar: Math.max(...fresh.map(f => Math.abs(f.gated.bar - 5))),
      processingMedianMs: frames.map(f => f.processMs).sort((a, b) => a - b)[5],
      processingMaxMs: Math.max(...frames.map(f => f.processMs)) }));
  });

  it('preserves pressure at representative needle angles, including stationary zero', () => {
    const state = setup();
    for (const [angle, expected] of [[140, 0], [177, 2.5], [214, 5], [258, 7.5], [284.4, 9]]) {
      const frames = Array.from({ length: 4 }, () => step(state, { angle }));
      const fresh = frames.filter(f => f.gated.fresh);
      expect(fresh.length).toBeGreaterThan(0);
      for (const frame of fresh) expect(Math.abs(frame.gated.bar - expected)).toBeLessThan(0.3);
    }
  });

  it('follows gradual translation and scaling before and during a shot', () => {
    const state = setup();
    for (let i = 0; i <= 12; i++) {
      if (i === 6) state.publisher.beginShot(state.time);
      const frame = step(state, { x: 180 + i * 9, y: 240 - i * 5, radius: 70 - i * 1.5, rotation: i * 0.6 });
      expect(frame.read.lost, `frame ${i}`).toBe(false);
      expect(frame.gated.fresh, frame.gated.reason).toBe(true);
      expect(Math.abs(frame.gated.bar - 5)).toBeLessThan(0.3);
    }
  });

  for (const loss of [{ blank: true }, { obstruction: true }]) {
    it(`publishes gaps through ${loss.blank ? 'missing frames' : 'hand obstruction'} and recovers the original gauge`, () => {
      const state = setup();
      expect(step(state).gated.fresh).toBe(true);
      const epoch = state.tracker.poseEpoch;
      for (let i = 0; i < 5; i++) {
        const frame = step(state, loss);
        expect(frame.read.lost).toBe(true);
        expect(frame.gated).toMatchObject({ bar: null, fresh: false });
      }
      expect(state.tracker.poseEpoch).toBeGreaterThan(epoch);
      const frames = Array.from({ length: 8 }, () => step(state, { x: 320, y: 170, radius: 49 }));
      const fresh = frames.filter(f => f.gated.fresh);
      expect(fresh.length).toBeGreaterThan(0);
      expect(fresh[0].time - frames[0].time).toBeLessThanOrEqual(1000);
      for (const frame of fresh) expect(Math.abs(frame.gated.bar - 5)).toBeLessThan(0.3);
    });
  }

  for (const [name, scene] of [
    ['unrelated circle', { identity: 'circle' }],
    ['different printed face', { identity: 3 }],
    ['unverified orientation', { rotation: 70 }],
    ['missing needle', { needle: false }],
  ]) it(`rejects ${name} at a new location`, () => {
    const state = setup();
    expect(step(state).gated.fresh).toBe(true);
    for (let i = 0; i < 8; i++) {
      const frame = step(state, { x: 320, y: 170, radius: 49, ...scene });
      expect(frame.gated.fresh, JSON.stringify(frame)).toBe(false);
      // A verified face with no needle may retain only the existing short,
      // explicitly non-fresh display hold. Pose loss never retains a bar.
      if (frame.read.lost) expect(frame.gated.bar).toBeNull();
    }
  });

  it('recovers the pre-shot verdict at the raised-lever position and still reads after Start', () => {
    const state = setup();
    for (let i = 0; i < 8; i++) step(state, {}, 333);
    const scene = { x: 320, y: 170, radius: 49 };
    let last;
    for (let i = 0; i < 12; i++) last = step(state, scene, 333);
    expect(last.pose.poseStatus).toBe('found');
    expect(last.pose.status).toBe('found');
    state.publisher.beginShot(state.time);
    expect(step(state, scene).gated.fresh).toBe(true);
  });

  it('never treats identical recovered pixels as a new measurement', () => {
    const state = setup();
    const image = dial({ angle: 214 });
    const first = readCalibratedFrame(image, state.tracker);
    expect(first.ok).toBe(true);
    expect(readCalibratedFrame(image, state.tracker)).toMatchObject({ duplicate: true, fresh: false, bar: null });
  });
});
