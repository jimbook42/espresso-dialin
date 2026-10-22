import { describe, expect, it } from 'vitest';
import {
  BAD_TAP_PX,
  FIVE_WARN_BAR,
  MARK_SWEEP_DEG,
  barFromRestSpan,
  calibrateFromTaps,
  detectBadTap,
  fiveCheckBar,
  markResidualPx,
  parseTapCalQuery,
  snapHub,
} from './tapCalibrate.js';

function point(angleDeg, radius, origin = { x: 200, y: 180 }) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: origin.x + radius * Math.cos(rad), y: origin.y + radius * Math.sin(rad) };
}

function idealTriple() {
  const centre = { x: 200, y: 180 };
  const five = point(20, 70, centre);
  const ten = point(20 + MARK_SWEEP_DEG, 70, centre);
  return { centre, five, ten };
}

describe('barFromRestSpan', () => {
  const zero = 12;
  const ten = 12 + 160;

  it('reads 0 on the rest needle and 10 on the snapped ten', () => {
    expect(barFromRestSpan(zero, zero, ten)).toBeCloseTo(0, 5);
    expect(barFromRestSpan(ten, zero, ten)).toBeCloseTo(10, 5);
    expect(barFromRestSpan(zero + 80, zero, ten)).toBeCloseTo(5, 5);
  });

  it('keeps a short step past either end and rejects the rest of the circle', () => {
    expect(barFromRestSpan(zero - 8, zero, ten)).toBe(0);
    expect(barFromRestSpan(ten + 8, zero, ten)).toBe(10);
    expect(barFromRestSpan(zero + 220, zero, ten)).toBeNull();
  });

  it('warns when the printed 5 is off the rest-to-10 span', () => {
    const five = fiveCheckBar(zero + 80, zero, ten);
    expect(Math.abs(five - 5)).toBeLessThan(FIVE_WARN_BAR);
    const skewed = fiveCheckBar(zero + 40, zero, ten);
    expect(Math.abs(skewed - 5)).toBeGreaterThan(FIVE_WARN_BAR);
  });
});

describe('detectBadTap', () => {
  it('accepts a consistent triple and a 20px finger miss', () => {
    const { centre, five, ten } = idealTriple();
    expect(detectBadTap(centre, five, ten, { hubPx: 4, fivePx: 8, tenPx: 12 }).bad).toBeNull();
    const noisy = {
      centre: { x: centre.x + 18, y: centre.y - 8 },
      five: { x: five.x - 12, y: five.y + 16 },
      ten: { x: ten.x + 10, y: ten.y + 14 },
    };
    expect(detectBadTap(noisy.centre, noisy.five, noisy.ten, { hubPx: 20, fivePx: 22, tenPx: 18 }).bad).toBeNull();
    expect(markResidualPx(centre, five, ten)).toBeLessThan(1);
  });

  it('names the single tap that is ~80px off its feature', () => {
    expect(detectBadTap(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { hubPx: 6, fivePx: 14, tenPx: 80 },
    ).bad).toBe('ten');
    expect(detectBadTap(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { hubPx: 82, fivePx: 10, tenPx: 12 },
    ).bad).toBe('centre');
    expect(detectBadTap(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { hubPx: 4, fivePx: BAD_TAP_PX + 20, tenPx: 9 },
    ).bad).toBe('five');
  });
});

describe('parseTapCalQuery', () => {
  it('reads six video-pixel numbers from a replay query', () => {
    expect(parseTapCalQuery('?tapcal=10,20,30,40,50,60')).toEqual({
      centre: { x: 10, y: 20 },
      five: { x: 30, y: 40 },
      ten: { x: 50, y: 60 },
    });
    expect(parseTapCalQuery('')).toBeNull();
    expect(parseTapCalQuery('?tapcal=1,2,3')).toBeNull();
  });
});

function paintDial(size, hub, radius) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - hub.x;
      const dy = y - hub.y;
      const rr = Math.hypot(dx, dy);
      const o = (y * size + x) * 4;
      let r = 150;
      let g = 150;
      let b = 150;
      if (rr < radius) {
        r = 226;
        g = 224;
        b = 216;
      }
      if (rr >= radius && rr <= radius + 10) {
        r = 18;
        g = 18;
        b = 18;
      }
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

describe('snapHub', () => {
  it('pulls a rough centre tap onto the bezel pivot', () => {
    const hub = { x: 120, y: 110 };
    const image = paintDial(240, hub, 72);
    const snapped = snapHub(image, { x: hub.x + 16, y: hub.y - 12 });
    expect(snapped.ok).toBe(true);
    expect(Math.hypot(snapped.x - hub.x, snapped.y - hub.y)).toBeLessThan(8);
    expect(snapped.radius).toBeGreaterThan(68);
    expect(snapped.radius).toBeLessThan(96);
  });

  it('does not claim a pivot when the tap is far from the dial', () => {
    const image = paintDial(240, { x: 120, y: 110 }, 72);
    const snapped = snapHub(image, { x: 20, y: 24 });
    expect(snapped.ok).toBe(false);
  });
});

describe('calibrateFromTaps', () => {
  it('asks for the centre again when that tap misses the dial', () => {
    const image = paintDial(240, { x: 120, y: 110 }, 72);
    const result = calibrateFromTaps(image, {
      centre: { x: 18, y: 20 },
      five: { x: 160, y: 110 },
      ten: { x: 120, y: 160 },
    });
    expect(result.ok).toBe(false);
    expect(result.redo).toBe('centre');
  });
});
