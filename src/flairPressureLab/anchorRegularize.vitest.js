import { describe, expect, it } from 'vitest';
import {
  PROFILE_FIVE_TO_TEN_DEG,
  PROFILE_REST_TO_TEN_DEG,
  regularizeTapAnchors,
} from './anchorRegularize.js';
import { clockwiseDeg } from './tapCalibrate.js';
import { regularizeReplayAnchors } from './classicalReaderR6.js';

const hub = { x: 100, y: 100 };
const fiveTap = { x: 80, y: 120 };
const tenTap = { x: 120, y: 120 };

describe('regularizeTapAnchors userPlaced', () => {
  it('keeps a 5.26° span error as placed when userPlaced', () => {
    const zero = 140;
    const ten = zero + PROFILE_REST_TO_TEN_DEG + 5.26;
    const five = zero + PROFILE_FIVE_TO_TEN_DEG * 0.5;
    const reg = regularizeTapAnchors(
      { zeroAngleDeg: zero, fiveAngleDeg: five, tenAngleDeg: ten },
      hub,
      fiveTap,
      tenTap,
      { spanToleranceDeg: 4, blendWeight: 1, userPlaced: true },
    );
    expect(reg.rejected).toBe(false);
    expect(reg.tenAngleDeg).toBe(ten);
    expect(reg.fiveAngleDeg).toBe(five);
    expect(Math.abs(reg.spanDeg - clockwiseDeg(zero, ten))).toBeLessThan(0.01);
  });

  it('still falls back to profile for legacy auto setups', () => {
    const reg = regularizeTapAnchors(
      { zeroAngleDeg: 140, fiveAngleDeg: 220, tenAngleDeg: 320 },
      hub,
      fiveTap,
      tenTap,
      { spanToleranceDeg: 4, blendWeight: 1, userPlaced: false },
    );
    expect(reg.rejected).toBe(true);
    expect(Math.abs(reg.spanDeg - PROFILE_REST_TO_TEN_DEG)).toBeLessThan(6);
  });
});

describe('regularizeReplayAnchors userPlaced', () => {
  it('honours userPlaced on tap calibration payload', () => {
    const tap = {
      userPlaced: true,
      zeroAngleDeg: 200,
      fiveAngleDeg: 260,
      tenAngleDeg: 200 + PROFILE_REST_TO_TEN_DEG + 5.26,
      centre: hub,
      five: fiveTap,
      ten: tenTap,
    };
    const { anchors, stats } = regularizeReplayAnchors(tap, { spanToleranceDeg: 4, blendWeight: 1 });
    expect(stats.rejected).toBe(false);
    expect(anchors.tenAngleDeg).toBe(tap.tenAngleDeg);
  });
});
