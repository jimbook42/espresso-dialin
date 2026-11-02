import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { setOpenCvForTests } from './opencvRuntime.js';
import {
  createDialRegistration, inverseDialAngle, rememberDialReference,
  registerDialFrame, seedDialRegistration, transformDialAngle,
} from './dialRegistration.js';
import { wrapDelta } from './gaugeConfig.js';

beforeAll(async () => {
  let cv = createRequire(import.meta.url)('@techstark/opencv-js');
  if (typeof cv.then === 'function') cv = await cv;
  setOpenCvForTests(cv);
});

// An asymmetric textured annulus for geometry tests, without pressure labels.
function texture(transform = [1, 0, 0, 1], translation = [0, 0], blank = false, background = 205) {
  const size = 256, data = new Uint8ClampedArray(size * size * 4);
  const det = transform[0] * transform[3] - transform[1] * transform[2];
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const dx = x - 128 - translation[0], dy = y - 128 - translation[1];
    const u = (transform[3] * dx - transform[1] * dy) / det;
    const v = (-transform[2] * dx + transform[0] * dy) / det;
    const r = Math.hypot(u, v), angle = Math.atan2(v, u);
    let lum = r > 100 ? background : 205;
    if (!blank && r > 37 && r < 72) {
      lum = 150 + 45 * Math.sin(u / 5.3) * Math.cos(v / 4.1) + 35 * Math.sin(angle * 7 + r / 4);
    }
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = lum; data[i + 3] = 255;
  }
  return { width: size, height: size, data };
}

const calibration = () => ({ hub: { x: 128, y: 128 }, radius: 80,
  zeroAngleDeg: 140, fiveAngleDeg: 220, tenAngleDeg: 310 });

describe('calibration-anchored dial registration', () => {
  it('maps every tap ray through an affine tilt and back, including wraparound', () => {
    const matrix = [0.92, -0.18, 0.3, 1.05];
    for (const angle of [0, 5, 140, 220, 310, 359]) {
      expect(Math.abs(wrapDelta(inverseDialAngle(transformDialAngle(angle, matrix), matrix), angle))).toBeLessThan(1e-8);
    }
    expect(inverseDialAngle(null, matrix)).toBeNull();
  });

  it('follows printed texture and keeps the tapped pivot under translation and tilt', () => {
    const cal = calibration(), before = JSON.stringify(cal);
    rememberDialReference(texture(), cal);
    const state = createDialRegistration({ ...cal, hub: { ...cal.hub } });
    const matrix = [0.99, -0.08, 0.09, 1.02];
    const moved = registerDialFrame(texture(matrix, [12, -8]), cal,
      { x: 137, y: 122, radius: 82 }, state);
    expect(moved).not.toBeNull();
    expect(moved.x).toBeCloseTo(140, 0);
    expect(moved.y).toBeCloseTo(120, 0);
    for (const angle of [cal.zeroAngleDeg, cal.fiveAngleDeg, cal.tenAngleDeg]) {
      expect(Math.abs(wrapDelta(transformDialAngle(angle, moved.matrix), transformDialAngle(angle, matrix)))).toBeLessThan(1);
    }
    expect(JSON.stringify(cal)).toBe(before);
  });

  it('refuses an occluded face instead of treating a round surround as rotation evidence', () => {
    const cal = calibration();
    rememberDialReference(texture(), cal);
    const result = registerDialFrame(texture(undefined, undefined, true), cal,
      { x: 128, y: 128, radius: 80 }, createDialRegistration(cal));
    expect(result).toBeNull();
  });

  it('recovers the tapped pivot after loss and a translation instead of staying at the last accepted position', () => {
    const cal = calibration(), before = JSON.stringify(cal);
    rememberDialReference(texture(), cal);
    const state = createDialRegistration(cal);
    expect(registerDialFrame(texture(), cal, { x: 128, y: 128, radius: 80 }, state)).not.toBeNull();
    expect(registerDialFrame(texture(undefined, undefined, true), cal,
      { x: 128, y: 128, radius: 80 }, state)).toBeNull();
    // The caller records a lost frame without accepting a new pose.
    state.misses += 1;
    const matrix = [0.98, -0.09, 0.1, 1.01];
    const recovered = registerDialFrame(texture(matrix, [32, -10]), cal,
      { x: 158, y: 119, radius: 81 }, state);
    expect(recovered).not.toBeNull();
    expect(recovered.x).toBeCloseTo(160, 0);
    expect(recovered.y).toBeCloseTo(118, 0);
    for (const angle of [cal.zeroAngleDeg, cal.fiveAngleDeg, cal.tenAngleDeg]) {
      expect(Math.abs(wrapDelta(transformDialAngle(angle, recovered.matrix), transformDialAngle(angle, matrix)))).toBeLessThan(1);
    }
    expect(state.misses).toBe(0);
    expect(JSON.stringify(cal)).toBe(before);
  });

  it('does not turn a new rim candidate into a lock when the printed face stays occluded', () => {
    const cal = calibration();
    rememberDialReference(texture(), cal);
    const state = createDialRegistration(cal);
    expect(registerDialFrame(texture(), cal, { x: 128, y: 128, radius: 80 }, state)).not.toBeNull();
    const accepted = structuredClone(state.last);
    state.misses = 5;
    expect(registerDialFrame(texture(undefined, undefined, true), cal,
      { x: 160, y: 118, radius: 81 }, state)).toBeNull();
    expect(state.last).toEqual(accepted);
    expect(state.misses).toBe(5);
  });

  it('tracks printed features when the surround changes independently of the face', () => {
    const cal = calibration();
    rememberDialReference(texture(), cal);
    const matrix = [0.99, -0.08, 0.09, 1.02];
    const moved = registerDialFrame(texture(matrix, [20, -5], false, 35), cal,
      { x: 146, y: 125, radius: 82 }, createDialRegistration(cal));
    expect(moved).not.toBeNull();
    expect(moved.x).toBeCloseTo(148, 0);
    expect(moved.y).toBeCloseTo(123, 0);
    expect(Math.abs(wrapDelta(transformDialAngle(cal.zeroAngleDeg, moved.matrix),
      transformDialAngle(cal.zeroAngleDeg, matrix)))).toBeLessThan(1);
  });

  it('can restore a transient reference from confirmed face rotation without changing zero', () => {
    const cal = { ...calibration(), zeroAngleDeg: 141 };
    const state = createDialRegistration(cal), before = JSON.stringify(cal);
    expect(state.reference).toBeNull();
    const r = 5 * Math.PI / 180, matrix = [Math.cos(r), -Math.sin(r), Math.sin(r), Math.cos(r)];
    const image = texture(matrix, [4, 7]), pose = { x: 132, y: 135, radius: 80 };
    seedDialRegistration(image, cal, pose, state, 5, 260);
    const matched = registerDialFrame(image, cal, pose, state);
    expect(matched).not.toBeNull();
    expect(Math.abs(wrapDelta(matched.shiftDeg, 5))).toBeLessThan(0.5);
    expect(JSON.stringify(cal)).toBe(before);
  });
});
