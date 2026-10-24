import { describe, expect, it } from 'vitest';
import { regularizeTapAnchors, PROFILE_REST_TO_TEN_DEG } from './anchorRegularize.js';
import {
  createClassicalReaderR6,
  DEFAULT_R6_CONFIG,
  measureSmoothingDelayMs,
} from './classicalReaderR6.js';
import { clockwiseDeg } from './tapCalibrate.js';

const zero = 140;
const ten = zero + PROFILE_REST_TO_TEN_DEG;

function track(reader, t, needleDeg, extra = {}) {
  return reader.processFrame({
    t,
    tracking: 'TRACKING',
    needleDeg,
    rest: false,
    zeroDeg: zero,
    tenDeg: ten,
    ...extra,
  });
}

describe('anchorRegularize', () => {
  it('rejects span out of tolerance', () => {
    const reg = regularizeTapAnchors(
      { zeroAngleDeg: 140, fiveAngleDeg: 220, tenAngleDeg: 320 },
      { x: 100, y: 100 },
      { x: 80, y: 120 },
      { x: 120, y: 120 },
      { spanToleranceDeg: 4, blendWeight: 1 },
    );
    expect(reg.rejected).toBe(true);
    expect(Math.abs(reg.spanDeg - PROFILE_REST_TO_TEN_DEG)).toBeLessThan(6);
  });
});

describe('classicalReaderR6', () => {
  it('rejects 180 deg flip spike', () => {
    const reader = createClassicalReaderR6();
    track(reader, 0, zero + 30);
    const spike = track(reader, 0.125, zero + 30 + 180);
    expect(spike.published).toBe(false);
    expect(spike.reason).toBe('spike-reject');
  });

  it('r7 spike mode allows in-arc rate steps', () => {
    const reader = createClassicalReaderR6({ spikeRejectMode: 'r7', rateRejectEnabled: false });
    track(reader, 0, zero + 20);
    const step = track(reader, 0.125, zero + 50);
    expect(step.published).toBe(true);
  });

  it('pins rest at 0', () => {
    const reader = createClassicalReaderR6();
    const out = reader.processFrame({
      t: 0,
      tracking: 'TRACKING',
      needleDeg: zero,
      rest: true,
      zeroDeg: zero,
      tenDeg: ten,
    });
    expect(out.bar).toBe(0);
    expect(out.published).toBe(true);
  });

  it('limits uncertain hold duration', () => {
    const reader = createClassicalReaderR6({ uncertainHoldMaxS: 0.25 });
    track(reader, 0, zero + 40);
    let held = 0;
    for (let i = 1; i <= 5; i += 1) {
      const out = reader.processFrame({
        t: i * 0.125,
        tracking: 'UNCERTAIN',
        needleDeg: null,
        rest: false,
        zeroDeg: zero,
        tenDeg: ten,
        r5Bar: 3,
        r5Conf: 0.8,
      });
      if (out.reason === 'uncertain-hold') held += 1;
    }
    expect(held).toBeLessThanOrEqual(Math.ceil(0.25 / 0.125) + 1);
  });

  it('smoothing group delay stays within 150 ms', () => {
    const delay = measureSmoothingDelayMs(DEFAULT_R6_CONFIG);
    expect(delay).toBeLessThanOrEqual(150);
  });

  it('rejects out-of-arc tail reading via spike', () => {
    const reader = createClassicalReaderR6();
    track(reader, 0, zero + 20);
    const tail = track(reader, 0.125, zero + 20 + 175);
    expect(tail.published).toBe(false);
  });
});
