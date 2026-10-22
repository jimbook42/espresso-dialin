import { describe, expect, it } from 'vitest';
import { CANONICAL_ZERO_BAR_ANGLE_DEG, barToDialAngle } from './dialFaceTemplate.js';
import { FLAIR_58_SCALE, formatPressureBar, wrapDelta } from './gaugeConfig.js';
import { renderNeedleCrop } from './needleCropRender.js';
import {
  NEEDLE_CONFIDENCE_MIN,
  NEEDLE_CROP_HALF_SCALE,
  NEEDLE_INPUT_SIZE,
  applyNeedleModelReading,
  decodeNeedleOutput,
  prepareRegisteredFace,
  registeredAngleToBar,
  tensorFromRgba,
} from './needleModel.js';

function pixel(rgba, size, x, y) {
  const i = (Math.round(y) * size + Math.round(x)) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2]];
}

function dialToPixel(xd, yd, size = NEEDLE_INPUT_SIZE) {
  const i = (xd / (2 * NEEDLE_CROP_HALF_SCALE) + 0.5) * size - 0.5;
  const j = (yd / (2 * NEEDLE_CROP_HALF_SCALE) + 0.5) * size - 0.5;
  return [i, j];
}

describe('needle model pre/post', () => {
  it('maps registered angles through the printed scale', () => {
    expect(registeredAngleToBar(CANONICAL_ZERO_BAR_ANGLE_DEG)).toBeCloseTo(0, 5);
    expect(registeredAngleToBar(barToDialAngle(5))).toBeCloseTo(5, 2);
    expect(registeredAngleToBar(barToDialAngle(10))).toBeCloseTo(10, 2);
    const off = barToDialAngle(10) + 40;
    expect(registeredAngleToBar(off)).toBeNull();
  });

  it('shows one decimal and a gap when the bar is missing', () => {
    expect(formatPressureBar(8.04)).toBe('8.0');
    expect(formatPressureBar(8.06)).toBe('8.1');
    expect(formatPressureBar(0)).toBe('0.0');
    expect(formatPressureBar(null)).toBe('—');
  });

  it('decodes sin/cos into a bar and withholds a dim needle', () => {
    const zero = (CANONICAL_ZERO_BAR_ANGLE_DEG * Math.PI) / 180;
    const seen = decodeNeedleOutput([Math.sin(zero), Math.cos(zero), 4]);
    expect(seen.ok).toBe(true);
    expect(seen.confidence).toBeGreaterThan(NEEDLE_CONFIDENCE_MIN);
    expect(seen.bar).toBeCloseTo(0, 1);
    const hidden = decodeNeedleOutput([Math.sin(zero), Math.cos(zero), -4]);
    expect(hidden.ok).toBe(false);
    expect(hidden.confidence).toBeLessThan(NEEDLE_CONFIDENCE_MIN);
  });

  it('clears a low-confidence reading and keeps a confident one', () => {
    const classical = { relativeAngleDeg: 200, angleDeg: 200, quality: 0.5, likeness: 0.5, gauge: { rotationDeg: 10 } };
    applyNeedleModelReading(classical, { ok: false, confidence: 0.2, angleDeg: 10, bar: 0 });
    expect(classical.relativeAngleDeg).toBeNull();
    expect(classical.quality).toBe(0);
    expect(classical.model.used).toBe(false);

    const reading = { relativeAngleDeg: 10, quality: 0.2, likeness: 0.2, gauge: { rotationDeg: 15 } };
    const five = barToDialAngle(5);
    applyNeedleModelReading(reading, {
      ok: true,
      confidence: 0.9,
      angleDeg: five,
      bar: registeredAngleToBar(five),
    });
    expect(reading.model.used).toBe(true);
    expect(reading.relativeAngleDeg).toBeCloseTo(five, 5);
    expect(reading.angleDeg).toBeCloseTo((five + 15) % 360, 4);
    expect(reading.model.bar).toBeCloseTo(5, 2);
  });

  it('packs RGB in NCHW and undoes a clockwise registration', () => {
    const rgba = new Uint8ClampedArray(NEEDLE_INPUT_SIZE * NEEDLE_INPUT_SIZE * 4);
    rgba[0] = 255;
    const tensor = tensorFromRgba(rgba);
    expect(tensor[0]).toBe(1);
    expect(tensor[NEEDLE_INPUT_SIZE * NEEDLE_INPUT_SIZE]).toBe(0);

    const width = 96;
    const height = 96;
    const image = { data: new Uint8ClampedArray(width * height * 4), width, height };
    const cx = 48;
    const cy = 48;
    const radius = 40;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const o = ((cy + Math.round(radius * 0.45) + dy) * width + (cx + dx)) * 4;
        image.data[o] = 255;
        image.data[o + 3] = 255;
      }
    }
    const turned = prepareRegisteredFace(image, cx, cy, radius, 90);
    let peak = 0;
    for (let j = 24; j < 40; j += 1) {
      for (let i = 40; i < 58; i += 1) peak = Math.max(peak, turned[j * NEEDLE_INPUT_SIZE + i]);
    }
    expect(peak).toBeGreaterThan(0.4);
  });

  it('paints the needle on the measured arc', () => {
    const rest = renderNeedleCrop({
      seed: 11,
      bar: 0,
      clean: true,
      residualDeg: 0,
      aspect: 1,
    });
    expect(Math.abs(wrapDelta(CANONICAL_ZERO_BAR_ANGLE_DEG, rest.angleDeg))).toBeLessThan(0.05);
    expect(rest.confidence).toBeGreaterThan(0.9);
    const rad = (CANONICAL_ZERO_BAR_ANGLE_DEG * Math.PI) / 180;
    const [nx, ny] = dialToPixel(0.55 * Math.cos(rad), 0.55 * Math.sin(rad));
    const [ox, oy] = dialToPixel(
      0.55 * Math.cos(rad + 0.7),
      0.55 * Math.sin(rad + 0.7),
    );
    const needle = pixel(rest.rgba, rest.size, nx, ny);
    const face = pixel(rest.rgba, rest.size, ox, oy);
    expect(needle[0] + needle[1] + needle[2]).toBeLessThan(face[0] + face[1] + face[2] - 40);

    const turned = renderNeedleCrop({
      seed: 12,
      bar: 0,
      clean: true,
      residualDeg: 20,
      aspect: 1,
    });
    expect(wrapDelta(CANONICAL_ZERO_BAR_ANGLE_DEG, turned.angleDeg)).toBeCloseTo(20, 1);

    const five = renderNeedleCrop({
      seed: 13,
      bar: 5,
      clean: true,
      residualDeg: 0,
      aspect: 1,
    });
    const fiveRad = (barToDialAngle(5) * Math.PI) / 180;
    const [fx, fy] = dialToPixel(0.55 * Math.cos(fiveRad), 0.55 * Math.sin(fiveRad));
    const onNeedle = pixel(five.rgba, five.size, fx, fy);
    const beside = pixel(
      five.rgba,
      five.size,
      ...dialToPixel(0.55 * Math.cos(fiveRad + 0.35), 0.55 * Math.sin(fiveRad + 0.35)),
    );
    expect(onNeedle[0]).toBeLessThan(beside[0] - 30);
    expect(five.bar).toBe(5);
    expect(FLAIR_58_SCALE.sweepDeg).toBeGreaterThan(170);
  });
});
