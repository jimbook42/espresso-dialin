import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  measureTensorAngle,
  rectifyNeedle,
  rectifyPoseFromTrack,
} from '../../src/flairPressureLab/needleRectify.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PY = path.join(ROOT, 'scripts/needle-reader/rectify.py');

function blank(width, height, fill = 230) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = fill;
    data[i * 4 + 1] = fill;
    data[i * 4 + 2] = fill;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

function paintRay(image, pose, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (let r = pose.radius * 0.22; r < pose.radius * 0.92; r += 0.45) {
    for (let t = -1.4; t <= 1.4; t += 0.45) {
      const x = Math.round(pose.cx + r * cos - t * sin);
      const y = Math.round(pose.cy + r * sin + t * cos);
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const index = (y * image.width + x) * 4;
      image.data[index] = 12;
      image.data[index + 1] = 12;
      image.data[index + 2] = 12;
    }
  }
}

function angDiff(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function pythonRectify(image, pose, mode) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nr-rectify-'));
  const frame = path.join(dir, 'frame.rgba');
  const out = path.join(dir, 'out.f32');
  try {
    writeFileSync(frame, Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength));
    const job = {
      path: frame,
      out,
      width: image.width,
      height: image.height,
      mode,
      pose,
      spec: {
        mode,
        size: 96,
        dialRadiusPx: 40,
        radiusBins: 48,
        angleBins: 360,
        outerRadiusPx: 48,
      },
    };
    const proc = spawnSync('python3', [PY, '--worker'], {
      input: `${JSON.stringify(job)}\n`,
      encoding: 'utf8',
    });
    expect(proc.status, proc.stderr).toBe(0);
    const buf = readFileSync(out);
    const copy = new ArrayBuffer(buf.byteLength);
    Buffer.from(copy).set(buf);
    return {
      tensor: new Float32Array(copy),
      angle: JSON.parse(proc.stdout).angle,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('needle rectify', () => {
  const pose = { cx: 80, cy: 70, radius: 46, rotationDeg: 0 };

  it('builds a pose from the tracker and the tap calibration', () => {
    expect(rectifyPoseFromTrack(
      { cx: 10, cy: 20, radius: 30, rotationDeg: 4 },
      { restAngleDeg: 15 },
    )).toEqual({ cx: 10, cy: 20, radius: 30, rotationDeg: 15 });
  });

  it('puts a known ray on the expected crop angle in both modes', () => {
    const image = blank(160, 140);
    paintRay(image, pose, 30);
    const cartesian = rectifyNeedle(image, pose, { mode: 'cartesian' });
    const polar = rectifyNeedle(image, pose, { mode: 'polar' });
    expect(cartesian.tensor.length).toBe(3 * 96 * 96);
    expect(polar.tensor.length).toBe(3 * 48 * 360);
    expect(angDiff(measureTensorAngle(cartesian.tensor, cartesian.spec), 30)).toBeLessThan(1.5);
    expect(angDiff(measureTensorAngle(polar.tensor, polar.spec), 30)).toBeLessThan(1.5);
    const turned = rectifyNeedle(image, { ...pose, rotationDeg: 30 }, { mode: 'cartesian' });
    expect(angDiff(measureTensorAngle(turned.tensor, turned.spec), 0)).toBeLessThan(1.5);
  });

  it('matches Python within 1e-4 and 0.3° on a synthetic frame', () => {
    const image = blank(160, 140, 210);
    paintRay(image, pose, 110);
    const shifted = { ...pose, rotationDeg: 20 };
    for (const mode of ['cartesian', 'polar']) {
      const js = rectifyNeedle(image, shifted, { mode });
      const py = pythonRectify(image, shifted, mode);
      expect(py.tensor.length).toBe(js.tensor.length);
      let max = 0;
      for (let i = 0; i < js.tensor.length; i += 1) {
        max = Math.max(max, Math.abs(js.tensor[i] - py.tensor[i]));
      }
      expect(max, mode).toBeLessThanOrEqual(1e-4);
      const jsAngle = measureTensorAngle(js.tensor, js.spec);
      expect(angDiff(jsAngle, py.angle), mode).toBeLessThanOrEqual(0.3);
    }
  });
});
