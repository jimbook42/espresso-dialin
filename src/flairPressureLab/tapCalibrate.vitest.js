import { describe, expect, it } from 'vitest';
import {
  BAD_TAP_PX,
  FIVE_WARN_BAR,
  MARK_SWEEP_DEG,
  barFromRestSpan,
  calibrateFromTaps,
  captureTipTemplate,
  detectBadTap,
  fiveCheckBar,
  markResidualPx,
  matchTipAngle,
  parseTapCalQuery,
  replayMediaTimeSec,
  replayTapWindowOpen,
  shouldDeferLegacyLock,
  snapHub,
  tapAnchorRecord,
  tapsFromReplayHook,
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

describe('tapsFromReplayHook', () => {
  it('keeps an optional rest time with the three taps', () => {
    expect(tapsFromReplayHook({
      __pressureLabTapCal: { atSec: 0.4, centre: [1, 2], five: [3, 4], ten: [5, 6] },
    })).toEqual({
      centre: { x: 1, y: 2 },
      five: { x: 3, y: 4 },
      ten: { x: 5, y: 6 },
      atSec: 0.4,
    });
    expect(tapsFromReplayHook({})).toBeNull();
  });
});

describe('replay tap window', () => {
  const slot = 0.125;
  const samplesFrom = (index0) => {
    const hits = [];
    for (let index = index0; index < 400; index += 1) {
      const t = index * slot;
      if (replayTapWindowOpen(t, null)) hits.push(t);
      if (t > 30) break;
    }
    return hits;
  };

  it('uses the still clock, not a missing video.currentTime of 0', () => {
    expect(replayMediaTimeSec(1.875, 0)).toBeCloseTo(1.875, 6);
    expect(replayMediaTimeSec(0, 1875)).toBe(0);
    expect(replayMediaTimeSec(null, 1875)).toBeCloseTo(1.875, 6);
    expect(replayTapWindowOpen(0, 1.8)).toBe(false);
    expect(replayTapWindowOpen(replayMediaTimeSec(null, 1875), 1.8)).toBe(true);
  });

  it('hits the half-second window on the 8 Hz replay grid', () => {
    const hitsAt = (atSec) => {
      const hits = [];
      for (let index = 4; index < 800; index += 1) {
        const t = index * slot;
        if (t > atSec + 1) break;
        if (replayTapWindowOpen(t, atSec)) hits.push(Number(t.toFixed(4)));
      }
      return hits;
    };
    expect(hitsAt(1.8)).toEqual([1.875, 2, 2.125, 2.25]);
    expect(hitsAt(1).length).toBeGreaterThan(0);
    expect(hitsAt(7.5813165).length).toBeGreaterThan(0);
    expect(hitsAt(1.8).every((t) => t >= 1.8 && t < 2.3)).toBe(true);
  });

  it('stays open when atSec is omitted so the first frame can lock', () => {
    expect(replayTapWindowOpen(0.5, null)).toBe(true);
    expect(samplesFrom(4)[0]).toBeCloseTo(0.5, 6);
  });

  it('defers the legacy lock until the tap window has had its frames', () => {
    const injected = { atSec: 1.8, centre: { x: 1, y: 2 }, five: { x: 3, y: 4 }, ten: { x: 5, y: 6 } };
    expect(shouldDeferLegacyLock({ injected, applied: false, sampleT: 0.5 })).toBe(true);
    expect(shouldDeferLegacyLock({ injected, applied: false, sampleT: 1.875 })).toBe(true);
    expect(shouldDeferLegacyLock({ injected, applied: false, sampleT: 2.3 })).toBe(false);
    expect(shouldDeferLegacyLock({ injected, applied: true, sampleT: 0.5 })).toBe(false);
    expect(shouldDeferLegacyLock({ injected: { atSec: null }, applied: false, sampleT: 0.5 })).toBe(false);
    expect(shouldDeferLegacyLock({ injected: null, applied: false, sampleT: 0.5 })).toBe(false);
  });

  it('records anchors without the image templates', () => {
    expect(tapAnchorRecord({
      hub: { x: 624, y: 310 },
      five: { x: 661, y: 270 },
      ten: { x: 662, y: 338 },
      zeroAngleDeg: 12,
      fiveAngleDeg: 80,
      tenAngleDeg: 170,
      spanDeg: 158,
      radius: 90,
      template: { red: [1], dark: [2] },
      needleTemplate: [3],
    })).toEqual({
      centre: { x: 624, y: 310 },
      five: { x: 661, y: 270 },
      ten: { x: 662, y: 338 },
      zeroAngleDeg: 12,
      fiveAngleDeg: 80,
      tenAngleDeg: 170,
      spanDeg: 158,
      radius: 90,
    });
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

describe('matchTipAngle', () => {
  it('follows the tip template and leaves the tail and a tick alone', () => {
    const size = 240;
    const hub = { x: 120, y: 120 };
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 210;
      data[i + 1] = 208;
      data[i + 2] = 200;
      data[i + 3] = 255;
    }
    const image = { width: size, height: size, data };
    const paint = (deg, r0, r1, half) => {
      const rad = (deg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      for (let r = r0; r <= r1; r += 0.5) {
        const x = hub.x + r * cos;
        const y = hub.y + r * sin;
        for (let off = -half; off <= half; off += 0.5) {
          const px = Math.round(x - sin * off);
          const py = Math.round(y + cos * off);
          if (px < 0 || py < 0 || px >= size || py >= size) continue;
          const o = (py * size + px) * 4;
          data[o] = 16;
          data[o + 1] = 16;
          data[o + 2] = 16;
        }
      }
    };
    paint(30, 22, 78, 1.5);
    paint(210, 16, 38, 1.5);
    paint(110, 62, 78, 1);
    const template = captureTipTemplate(image, hub.x, hub.y, 30, 90);
    const matched = matchTipAngle(image, hub.x, hub.y, 90, template, 30, 30 + 170, 30, 0);
    expect(matched).not.toBeNull();
    expect(matched.angleDeg).toBeGreaterThan(26);
    expect(matched.angleDeg).toBeLessThan(34);
    expect(barFromRestSpan(matched.angleDeg, 30, 200)).toBeLessThan(1);
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
