import { barToDialAngle } from './dialFaceTemplate.js';
import { NEEDLE_CROP_HALF_SCALE, NEEDLE_INPUT_SIZE } from './needleModel.js';
import { barFromTapAnchors } from './tapCalibrate.js';
import { inverseDialAngle } from './dialRegistration.js';
import { wrap360 } from './gaugeConfig.js';

/** Canonical dial unit vectors -> the current source frame, through the user's pins. */
export function tapNeedleModelPose(calibration, read) {
  if (!calibration?.hub || !calibration.five || !calibration.ten || !read?.hub || read.lost) return null;
  const f = { x: calibration.five.x - calibration.hub.x, y: calibration.five.y - calibration.hub.y };
  const t = { x: calibration.ten.x - calibration.hub.x, y: calibration.ten.y - calibration.hub.y };
  const five = barToDialAngle(5) * Math.PI / 180, ten = barToDialAngle(10) * Math.PI / 180;
  const a = Math.cos(five), b = Math.cos(ten), c = Math.sin(five), d = Math.sin(ten);
  const det = a * d - b * c;
  const pinRadius = Math.sqrt((f.x ** 2 + f.y ** 2 + t.x ** 2 + t.y ** 2) / 2);
  if (pinRadius < 8 || Math.abs(det) < 0.2) return null;
  const k = calibration.radius / pinRadius;
  const base = [(f.x * d - t.x * c) / det * k, (-f.x * b + t.x * a) / det * k,
    (f.y * d - t.y * c) / det * k, (-f.y * b + t.y * a) / det * k];
  const angle = (read.shiftDeg ?? 0) * Math.PI / 180;
  const motion = read.poseMatrix ?? [Math.cos(angle), -Math.sin(angle), Math.sin(angle), Math.cos(angle)];
  const motionDet = motion[0] * motion[3] - motion[1] * motion[2];
  if (motionDet <= 0) return null;
  const scale = read.radius / calibration.radius / Math.sqrt(motionDet);
  const basis = [(motion[0] * base[0] + motion[1] * base[2]) * scale,
    (motion[0] * base[1] + motion[1] * base[3]) * scale,
    (motion[2] * base[0] + motion[3] * base[2]) * scale,
    (motion[2] * base[1] + motion[3] * base[3]) * scale];
  return { hub: { ...read.hub }, radius: read.radius, shiftDeg: read.shiftDeg ?? 0,
    basis, motion, calibration };
}

/** Same tensor layout as the shipped model, sampled directly from the source once. */
export function prepareTapNeedleInput(image, pose) {
  const size = NEEDLE_INPUT_SIZE, plane = size * size, out = new Float32Array(plane * 3);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const u = ((x + 0.5) / size * 2 - 1) * NEEDLE_CROP_HALF_SCALE;
    const v = ((y + 0.5) / size * 2 - 1) * NEEDLE_CROP_HALF_SCALE;
    const sx = pose.hub.x + pose.basis[0] * u + pose.basis[1] * v;
    const sy = pose.hub.y + pose.basis[2] * u + pose.basis[3] * v;
    if (sx < 0 || sy < 0 || sx >= image.width - 1 || sy >= image.height - 1) continue;
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    for (let channel = 0; channel < 3; channel += 1) {
      const at = (dx, dy) => image.data[((iy + dy) * image.width + ix + dx) * 4 + channel];
      const value = (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy)
        + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
      out[channel * plane + y * size + x] = value / 255;
    }
  }
  return out;
}

/** A model angle becomes an image angle and a user-tap pressure, never a design bar. */
export function tapNeedlePrediction(prediction, pose) {
  if (!pose || !Number.isFinite(prediction?.angleDeg)) return null;
  const rad = prediction.angleDeg * Math.PI / 180, x = Math.cos(rad), y = Math.sin(rad);
  const angleDeg = wrap360(Math.atan2(pose.basis[2] * x + pose.basis[3] * y,
    pose.basis[0] * x + pose.basis[1] * y) * 180 / Math.PI);
  const referenceAngle = inverseDialAngle(angleDeg, pose.motion);
  const cal = pose.calibration;
  return { angleDeg, bar: barFromTapAnchors(referenceAngle, cal.zeroAngleDeg, cal.fiveAngleDeg, cal.tenAngleDeg) };
}
