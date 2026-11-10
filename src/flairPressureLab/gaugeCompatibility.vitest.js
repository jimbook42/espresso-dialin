import sharp from 'sharp';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calibrateFromTaps } from './tapCalibrate.js';
import {
  expectedFlairRestAngle, GAUGE_COMPATIBILITY, isVerifiedGaugeCalibration, verifyGaugeCompatibility,
} from './gaugeCompatibility.js';

const point = (x, y) => ({ x: (x - 200) / 2, y: (y - 430) / 2 });
const taps = { centre: point(592, 812), five: point(461, 645), ten: point(760, 667) };
const face = { hub: taps.centre, fiveDeg: 231.888, tenDeg: 319.2, radius: 108 };

async function fixture(brightness = 1) {
  const { data, info } = await sharp(fileURLToPath(new URL('../../docs/reference/flair58-face-phone.jpg', import.meta.url)))
    .extract({ left: 200, top: 430, width: 800, height: 800 })
    .resize(400, 400).modulate({ brightness }).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function testImage(svg) {
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

describe('original Flair 58 gauge compatibility', () => {
  it.each([0.72, 1, 1.15])('verifies the original reference photo at brightness %s', async (brightness) => {
    const calibration = calibrateFromTaps(await fixture(brightness), taps);
    expect(isVerifiedGaugeCalibration(calibration.calibration)).toBe(true);
  });

  it('derives the same zero for a missing, correctly resting, or displaced needle', async () => {
    const image = await fixture();
    const expected = expectedFlairRestAngle(face.fiveDeg);
    expect(verifyGaugeCompatibility(image, { ...face, needleDeg: expected, needleQuality: 0.8 }))
      .toMatchObject({ state: GAUGE_COMPATIBILITY.supported, expectedRestDeg: expected });
    expect(verifyGaugeCompatibility(image, { ...face, needleDeg: expected + 35, needleQuality: 0.99 }))
      .toMatchObject({ state: GAUGE_COMPATIBILITY.uncertain, expectedRestDeg: expected, restErrorDeg: 35 });
    expect(verifyGaugeCompatibility(image, { ...face, needleDeg: null, needleQuality: 0 }))
      .toMatchObject({ state: GAUGE_COMPATIBILITY.uncertain, reason: 'rest-needle' });
  });

  it('rejects a light pointer on a dark face, but treats an occluded face as uncertain', async () => {
    const svg = (pointer) => `<svg width="220" height="220" xmlns="http://www.w3.org/2000/svg">
      <rect width="220" height="220" fill="#252a2e"/>${pointer}</svg>`;
    const face = { hub: { x: 110, y: 110 }, fiveDeg: 235, tenDeg: 325, radius: 75, needleQuality: 0 };
    const light = await testImage(svg('<path d="M110 110h65" stroke="#e5e8e9" stroke-width="4"/>'));
    expect(verifyGaugeCompatibility(light, face)).toEqual({ state: GAUGE_COMPATIBILITY.unsupported, reason: 'light-pointer' });
    const occluded = await testImage(svg('<circle cx="160" cy="110" r="5" fill="#fff"/>'));
    expect(verifyGaugeCompatibility(occluded, face)).toEqual({ state: GAUGE_COMPATIBILITY.uncertain, reason: 'printed-face' });
  });
});
