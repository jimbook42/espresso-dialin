import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  ISAAC_GAUGE_FIXTURE_SIZE,
  ISAAC_GAUGE_TAPS,
} from './fixtures/isaacGaugeTapCoords.js';
import {
  calibrateFromTaps,
  formatTapRejectReason,
  MARK_SWEEP_DEG,
  pointDist,
} from './tapCalibrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(
  __dirname,
  '../../public/flair-pressure-lab/fixtures/isaac-gauge-crop.jpg',
);

async function loadFixtureImage() {
  const { data, info } = await sharp(readFileSync(FIXTURE_PATH))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info.width).toBe(ISAAC_GAUGE_FIXTURE_SIZE.w);
  expect(info.height).toBe(ISAAC_GAUGE_FIXTURE_SIZE.h);
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
  };
}

describe('Isaac gauge fixture taps', () => {
  it('calibrates with measured pivot / 5 / 10 pixels', async () => {
    const image = await loadFixtureImage();
    const result = calibrateFromTaps(image, ISAAC_GAUGE_TAPS);
    expect(result.ok).toBe(true);
    expect(pointDist(result.calibration.hub, ISAAC_GAUGE_TAPS.centre)).toBeLessThan(6);
  });

  it('accepts a correct centre with slightly off 5/10 taps', async () => {
    const image = await loadFixtureImage();
    const { centre, ten } = ISAAC_GAUGE_TAPS;
    const result = calibrateFromTaps(image, {
      centre,
      five: { x: five.x - 10, y: five.y - 8 },
      ten: { x: ten.x + 10, y: ten.y + 8 },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects clearly inconsistent taps with plain words', async () => {
    const image = await loadFixtureImage();
    const result = calibrateFromTaps(image, {
      centre: ISAAC_GAUGE_TAPS.centre,
      five: { x: 80, y: 120 },
      ten: { x: 90, y: 130 },
    });
    expect(result.ok).toBe(false);
    const msg = formatTapRejectReason(result);
    expect(msg.length).toBeGreaterThan(8);
    expect(msg).toMatch(/5|10|pivot|line up/i);
  });

  it('uses MARK_SWEEP geometry consistent with measured 5→10 arc', () => {
    const { centre, five, ten } = ISAAC_GAUGE_TAPS;
    const sweep = Math.abs(
      (Math.atan2(ten.y - centre.y, ten.x - centre.x)
        - Math.atan2(five.y - centre.y, five.x - centre.x)) * 180 / Math.PI,
    );
    expect(Math.abs(sweep - MARK_SWEEP_DEG)).toBeLessThan(8);
  });
});
