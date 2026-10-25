import { describe, expect, it } from 'vitest';
import {
  BAD_TAP_PX,
  FIVE_WARN_BAR,
  MARK_SWEEP_DEG,
  USER_PLACED_NOTE,
  barFromRestSpan,
  calibrateFromTaps,
  captureTipTemplate,
  createCalibratedTracker,
  detectBadTap,
  estimateGaugeRadiusFromTaps,
  formatTapRejectReason,
  fiveCheckBar,
  markResidualPx,
  matchTipAngle,
  mapStoredTapPoint,
  parseTapCalQuery,
  readCalibratedFrame,
  replayMediaTimeSec,
  scaledTapTolerances,
  tapsForDisplayFrame,
  tapsGeometricallyConsistent,
  replayTapWindowOpen,
  shouldDeferLegacyLock,
  snapHub,
  tapAnchorRecord,
  tapsFromReplayHook,
} from './tapCalibrate.js';
import {
  DARK_BAND_INNER_FRACTION,
  DARK_BAND_OUTER_FRACTION,
  ESPRESSO_SECTOR,
  RED_BAND_INNER_FRACTION,
  RED_BAND_OUTER_FRACTION,
  STOP_SECTOR,
} from './dialFaceTemplate.js';
import { wrap360, wrapDelta } from './gaugeConfig.js';

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

describe('tapsForDisplayFrame', () => {
  it('turns stored 1280x720 taps into the autorotated still', () => {
    // 90° CCW: (x, y) -> (y, width - 1 - x). 180°: both axes flip.
    expect(mapStoredTapPoint([603, 398], 1280, 720, 90)).toEqual({ x: 398, y: 676 });
    expect(mapStoredTapPoint([647, 548], 1280, 720, -180)).toEqual({ x: 632, y: 171 });
    expect(mapStoredTapPoint([10, 20], 1280, 720, 270)).toEqual({ x: 699, y: 10 });
    expect(mapStoredTapPoint([624, 310], 1280, 720, 0)).toEqual({ x: 624, y: 310 });
    const mapped = tapsForDisplayFrame(
      { atSec: 5.4, centre: [603, 398], five: [565, 440], ten: [568, 370] },
      { width: 1280, height: 720, rotationDeg: 90 },
    );
    expect(mapped.atSec).toBe(5.4);
    expect(mapped.centre).toEqual([398, 676]);
    expect(mapped.five).toEqual([440, 714]);
    expect(mapped.ten).toEqual([370, 711]);
    expect(tapsForDisplayFrame(
      { atSec: 1.8, centre: [624, 310], five: [661, 270], ten: [662, 338] },
      { width: 1280, height: 720, rotationDeg: 0 },
    ).centre).toEqual([624, 310]);
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

function inPrintedSector(deg, start, end) {
  return wrap360(deg - start) <= wrap360(end - start);
}

/** Rim-sized dial with colour bands; taps may sit nearer the hub than the bezel. */
function paintBandDial(size, hub, rimRadius) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - hub.x;
      const dy = y - hub.y;
      const rr = Math.hypot(dx, dy);
      const deg = wrap360((Math.atan2(dy, dx) * 180) / Math.PI);
      const o = (y * size + x) * 4;
      let r = 248;
      let g = 248;
      let b = 248;
      if (rr < rimRadius * 0.92) {
        r = 226;
        g = 224;
        b = 216;
        const rf = rr / rimRadius;
        if (rf >= RED_BAND_INNER_FRACTION && rf <= RED_BAND_OUTER_FRACTION
          && inPrintedSector(deg, ESPRESSO_SECTOR.startDeg, ESPRESSO_SECTOR.endDeg)) {
          r = 200;
          g = 35;
          b = 30;
        } else if (rf >= DARK_BAND_INNER_FRACTION && rf <= DARK_BAND_OUTER_FRACTION
          && inPrintedSector(deg, STOP_SECTOR.startDeg, STOP_SECTOR.endDeg)) {
          r = 28;
          g = 28;
          b = 30;
        }
      }
      if (rr >= rimRadius * 0.95 && rr <= rimRadius + 10) {
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

function idealTapsAtRadius(radius, hub = { x: 120, y: 110 }) {
  const five = point(20, radius, hub);
  const ten = point(20 + MARK_SWEEP_DEG, radius, hub);
  return { centre: { ...hub }, five, ten };
}

describe('estimateGaugeRadiusFromTaps', () => {
  it('reads radius from centre→5/10 distances', () => {
    const taps = idealTapsAtRadius(52);
    expect(estimateGaugeRadiusFromTaps(taps.centre, taps.five, taps.ten)).toBeCloseTo(52, 0);
    expect(estimateGaugeRadiusFromTaps(taps.centre, taps.five, taps.ten)).toBeGreaterThan(30);
  });
});

describe('tapsGeometricallyConsistent', () => {
  it('accepts a loose finger triple and rejects a wild ten', () => {
    const good = idealTapsAtRadius(90);
    expect(tapsGeometricallyConsistent(good.centre, good.five, good.ten)).toBe(true);
    const bad = { ...good, ten: { x: good.ten.x + 120, y: good.ten.y + 40 } };
    expect(tapsGeometricallyConsistent(bad.centre, bad.five, bad.ten)).toBe(false);
  });
});

describe('scaledTapTolerances', () => {
  it('shrinks bad-tap threshold for a small gauge (Isaac ~50px class)', () => {
    const small = scaledTapTolerances(50);
    const large = scaledTapTolerances(140);
    expect(small.badTapPx).toBeLessThan(BAD_TAP_PX);
    expect(large.badTapPx).toBeGreaterThan(BAD_TAP_PX);
    expect(small.badTapPx).toBeCloseTo(BAD_TAP_PX * (50 / 90), 0);
  });
});

describe('formatTapRejectReason', () => {
  it('names the five tap in plain words', () => {
    expect(formatTapRejectReason({ ok: false, redo: 'five', reason: 'mark' }))
      .toMatch(/5/);
    expect(formatTapRejectReason({ ok: false, redo: 'centre', reason: 'hub' }))
      .toMatch(/pivot|line up/i);
  });
});

describe('calibrateFromTaps gauge sizes', () => {
  const radii = [30, 50, 90, 140];

  for (const radius of radii) {
    it(`accepts a consistent triple at ~${radius}px radius (hub snap or user placement)`, () => {
      const hub = { x: 160, y: 160 };
      const image = paintDial(360, hub, radius);
      const taps = idealTapsAtRadius(radius, hub);
      const noisyCentre = { x: hub.x + 6, y: hub.y - 4 };
      const result = calibrateFromTaps(image, {
        centre: noisyCentre,
        five: taps.five,
        ten: taps.ten,
      });
      expect(result.ok, `radius ${radius} reason=${result.reason}`).toBe(true);
      expect(result.calibration.radius).toBeGreaterThan(radius * 0.55);
      expect(result.calibration.radius).toBeLessThan(radius * 1.6);
    });
  }

  it('documents fixed 78–110px bezel search miss at radius 30 (root cause class)', () => {
    const hub = { x: 120, y: 110 };
    const image = paintDial(240, hub, 30);
    const snapped = snapHub(image, { x: hub.x + 4, y: hub.y - 3 }, { estRadius: 90 });
    expect(snapped.ok).toBe(false);
    const scaled = snapHub(image, { x: hub.x + 4, y: hub.y - 3 }, { estRadius: 30 });
    expect(scaled.ok).toBe(true);
  });

  it('keeps the centre tap exactly when snap would move the hub', () => {
    const trueHub = { x: 120, y: 110 };
    const radius = 72;
    const image = paintDial(240, trueHub, radius);
    const centreTap = { x: trueHub.x + 14, y: trueHub.y - 11 };
    const taps = idealTapsAtRadius(radius, centreTap);
    const snapped = snapHub(image, centreTap, { estRadius: radius });
    expect(snapped.ok).toBe(true);
    expect(Math.hypot(snapped.x - centreTap.x, snapped.y - centreTap.y)).toBeGreaterThan(6);
    const result = calibrateFromTaps(image, {
      centre: centreTap,
      five: taps.five,
      ten: taps.ten,
    });
    expect(result.ok).toBe(true);
    expect(result.calibration.hub.x).toBe(centreTap.x);
    expect(result.calibration.hub.y).toBe(centreTap.y);
    expect(result.calibration.five.x).toBe(taps.five.x);
    expect(result.calibration.five.y).toBe(taps.five.y);
    expect(result.calibration.ten.x).toBe(taps.ten.x);
    expect(result.calibration.ten.y).toBe(taps.ten.y);
    expect(result.userPlaced).toBe(true);
  });

  it('falls back to user taps when snap fails but geometry is consistent', () => {
    const hub = { x: 100, y: 100 };
    const radius = 48;
    const image = paintDial(220, hub, radius);
    const taps = idealTapsAtRadius(radius, hub);
    const result = calibrateFromTaps(image, {
      centre: { x: hub.x + 3, y: hub.y + 2 },
      five: taps.five,
      ten: taps.ten,
    });
    expect(result.ok).toBe(true);
    if (result.userPlaced) {
      expect(result.userPlacedNote).toBe(USER_PLACED_NOTE);
    }
  });

  it('asks for the centre again when that tap misses the dial', () => {
    const image = paintDial(240, { x: 120, y: 110 }, 72);
    const result = calibrateFromTaps(image, {
      centre: { x: 18, y: 20 },
      five: { x: 160, y: 110 },
      ten: { x: 120, y: 160 },
    });
    expect(result.ok).toBe(false);
    expect(result.redo).toBe('centre');
    expect(formatTapRejectReason(result)).toMatch(/pivot|line up/i);
  });
});

describe('userPlaced rim radius vs tap radius', () => {
  it('stores the bezel radius when taps sit at ~0.55 rim and keeps rotation near 0', () => {
    const hub = { x: 200, y: 200 };
    const rimRadius = 88;
    const tapRadius = 50;
    const image = paintBandDial(400, hub, rimRadius);
    const taps = idealTapsAtRadius(tapRadius, hub);
    const result = calibrateFromTaps(image, {
      centre: hub,
      five: taps.five,
      ten: taps.ten,
    });
    expect(result.ok).toBe(true);
    expect(result.userPlaced).toBe(true);
    expect(result.calibration.hub.x).toBe(hub.x);
    expect(result.calibration.five.x).toBe(taps.five.x);
    expect(result.calibration.radius).toBeGreaterThan(tapRadius * 1.25);
    expect(result.calibration.radius).toBeLessThan(rimRadius * 1.05);
    const tracker = createCalibratedTracker(result.calibration);
    const read = readCalibratedFrame(image, tracker);
    const scale = tracker.pose.radius / result.calibration.radius;
    expect(scale).toBeGreaterThan(0.88);
    expect(scale).toBeLessThan(1.12);
    expect(Math.abs(wrapDelta(read.shiftDeg ?? 0, 0))).toBeLessThan(1);
  });
});
