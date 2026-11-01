import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { setOpenCvForTests } from './opencvRuntime.js';
import {
  createDialRegistration, inverseDialAngle, rememberDialReference,
  registerDialFrame, transformDialAngle,
} from './dialRegistration.js';
import { wrapDelta } from './gaugeConfig.js';

beforeAll(async () => {
  let cv = createRequire(import.meta.url)('@techstark/opencv-js');
  if (typeof cv.then === 'function') cv = await cv;
  setOpenCvForTests(cv);
});

// An asymmetric textured annulus for geometry tests, without pressure labels.
function texture(transform = [1, 0, 0, 1], translation = [0, 0], blank = false) {
  const size = 256, data = new Uint8ClampedArray(size * size * 4);
  const det = transform[0] * transform[3] - transform[1] * transform[2];
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const dx = x - 128 - translation[0], dy = y - 128 - translation[1];
    const u = (transform[3] * dx - transform[1] * dy) / det;
    const v = (-transform[2] * dx + transform[0] * dy) / det;
    const r = Math.hypot(u, v), angle = Math.atan2(v, u);
    let lum = 205;
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
});
