import { describe, expect, it } from 'vitest';
import { barToDialAngle } from './dialFaceTemplate.js';
import { tapNeedleModelPose, tapNeedlePrediction, prepareTapNeedleInput } from './tapNeedleModel.js';
import { transformDialAngle } from './dialRegistration.js';
import { wrapDelta } from './gaugeConfig.js';

const at = (angle, radius) => ({ x: 128 + Math.cos(angle * Math.PI / 180) * radius,
  y: 128 + Math.sin(angle * Math.PI / 180) * radius });
const cal = { hub: { x: 128, y: 128 }, radius: 70, five: at(215, 40), ten: at(303, 44),
  zeroAngleDeg: 140, fiveAngleDeg: 215, tenAngleDeg: 303 };

describe('tap-registered needle model geometry', () => {
  it('uses the actual 5 and 10 taps under translation and affine tilt', () => {
    const matrix = [0.96, -0.1, 0.17, 1.03];
    const pose = tapNeedleModelPose(cal, { hub: { x: 134, y: 119 }, radius: 75, poseMatrix: matrix });
    for (const [bar, angle] of [[5, 215], [10, 303]]) {
      const decoded = tapNeedlePrediction({ angleDeg: barToDialAngle(bar) }, pose);
      expect(decoded.bar).toBeCloseTo(bar, 7);
      expect(Math.abs(wrapDelta(decoded.angleDeg, transformDialAngle(angle, matrix)))).toBeLessThan(1e-7);
    }
  });

  it('keeps calibration zero even when it differs from the model design zero', () => {
    const pose = tapNeedleModelPose(cal, { hub: cal.hub, radius: cal.radius, shiftDeg: 0 });
    const b = pose.basis, r = cal.zeroAngleDeg * Math.PI / 180;
    const x = Math.cos(r), y = Math.sin(r);
    const canonicalAngle = Math.atan2(-b[2] * x + b[0] * y, b[3] * x - b[1] * y) * 180 / Math.PI;
    expect(tapNeedlePrediction({ angleDeg: canonicalAngle }, pose).bar).toBeCloseTo(0, 7);
    expect(Math.abs(wrapDelta(canonicalAngle, barToDialAngle(0)))).toBeGreaterThan(5);
  });

  it('samples finite RGB tensors and refuses a lost face', () => {
    const data = new Uint8ClampedArray(256 * 256 * 4).fill(128);
    const image = { width: 256, height: 256, data };
    const pose = tapNeedleModelPose(cal, { hub: cal.hub, radius: 70, shiftDeg: 0 });
    const tensor = prepareTapNeedleInput(image, pose);
    expect(tensor).toHaveLength(3 * 64 * 64);
    expect(Array.from(tensor).every(v => Math.abs(v - 128 / 255) < 1e-6)).toBe(true);
    expect(tapNeedleModelPose(cal, { hub: cal.hub, radius: 70, lost: true })).toBeNull();
  });
});
