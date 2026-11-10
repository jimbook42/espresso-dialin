import { describe, expect, it } from 'vitest';
import { createShotLabR7Publisher } from './shotLabR7Live.js';
import { createTapReadingPublisher, currentTapModel, TAP_DISPLAY_HOLD_MS, TAP_MODEL_MAX_AGE_MS } from './tapReadingPublisher.js';
import { GAUGE_COMPATIBILITY } from './gaugeCompatibility.js';
import { isRecordedSampleConfident } from './preShotReadableStatus.js';

const calibration = { compatibility: GAUGE_COMPATIBILITY.supported,
  hub: { x: 100, y: 100 }, zeroAngleDeg: 0, fiveAngleDeg: 75, tenAngleDeg: 160 };
const read = (bar = 5) => ({ ok: bar != null, poseCompatible: true, lost: false, fresh: bar != null, bar,
  needleDeg: bar == null ? null : 75, needleQuality: 0.8, tenDeg: 160,
  hub: { x: 100, y: 100 }, radius: 60, shiftDeg: 0, poseEpoch: 1 });
const modelFrame = () => ({ nowMs: 1125, read: read(null), r5Registered: true,
  r5Corroborated: true, r5Bar: 5, r5Angle: 75, r5Conf: 0.9, r5CapturedAtMs: 1000,
  r5Pose: { hub: { x: 100, y: 100 }, radius: 60, shiftDeg: 0, epoch: 1 } });

describe('fresh tap observations and held display pressure', () => {
  it('starts immediately at pressure, with a zero pin at angle 0 and no rest observations', () => {
    const pub = createShotLabR7Publisher(calibration);
    const before = JSON.stringify(calibration);
    pub.beginShot(1000);
    const result = pub.stepFrame({ nowMs: 1010, capturedAtMs: 1005, read: read(5) });
    expect(result).toMatchObject({ bar: 5, fresh: true, held: false, uncertain: false, measuredAtMs: 1005 });
    expect(JSON.stringify(calibration)).toBe(before);
  });

  it('does not mark repeated holds confident or extend their measurement age', () => {
    const pub = createShotLabR7Publisher(calibration);
    pub.beginShot(1000);
    pub.stepFrame({ nowMs: 1000, read: read() });
    for (const elapsed of [125, 250, TAP_DISPLAY_HOLD_MS]) {
      expect(pub.stepFrame({ nowMs: 1000 + elapsed, read: read(null) }))
        .toMatchObject({ bar: 5, fresh: false, held: true, uncertain: true, measuredAtMs: null });
    }
    expect(pub.stepFrame({ nowMs: 1001 + TAP_DISPLAY_HOLD_MS, read: read(null) }).bar).toBeNull();
    expect(pub.stepFrame({ nowMs: 1600, read: { ...read(null), lost: true } }).bar).toBeNull();
  });

  it('ignores legacy model bars without source coordinates and acquisition time', () => {
    const pub = createShotLabR7Publisher(calibration);
    pub.beginShot(1000);
    const out = pub.stepFrame({ nowMs: 1125, read: read(null), r5Bar: 5, r5Conf: 0.99, r5Angle: 75 });
    expect(out).toMatchObject({ bar: null, fresh: false, held: false });
  });

  it('blocks the reported 7.07 bar at rest even with high confidence and corroboration', () => {
    const pub = createShotLabR7Publisher(calibration);
    pub.beginShot(1000);
    const falseAtRest = { ...modelFrame(), r5Bar: 7.07, r5Conf: 0.89 };
    for (const frame of [falseAtRest, { ...falseAtRest, read: { ...read(), ok: false } }]) {
      expect(pub.stepFrame(frame)).toMatchObject({ bar: null, fresh: false, measuredAtMs: null });
    }
    expect(pub.stepFrame({ ...falseAtRest, read: { ...read(0), needleDeg: 0 } }))
      .toMatchObject({ bar: 0, fresh: true, reason: 'tap-fresh' });
    const hold = pub.stepFrame({ ...falseAtRest, nowMs: 1250 });
    expect(hold).toMatchObject({ bar: 0, fresh: false, held: true });
    expect(isRecordedSampleConfident(hold)).toBe(false);
  });

  it('publishes only the main reader with agreeing, disagreeing, stale and previous-pose models', () => {
    const frame = { ...modelFrame(), read: read(), r5Bar: 5.1 };
    for (const input of [frame, { ...frame, r5Angle: 120, r5Conf: 0.99 },
      { ...frame, nowMs: 2000 }, { ...frame, r5Pose: { ...frame.r5Pose, epoch: 0 } }]) {
      const pub = createShotLabR7Publisher(calibration);
      pub.beginShot(1000);
      expect(pub.stepFrame(input)).toMatchObject({ bar: 5, fresh: true, reason: 'tap-fresh' });
    }
  });

  it('blocks unverified calibration even with a valid main reader, including the legacy scale', () => {
    for (const compatibility of [undefined, GAUGE_COMPATIBILITY.uncertain, GAUGE_COMPATIBILITY.unsupported]) {
      for (const legacyScale of [false, true]) {
        const pub = createShotLabR7Publisher({ ...calibration, compatibility }, { legacyScale });
        expect(pub.stepFrame({ ...modelFrame(), read: read() }))
          .toMatchObject({ bar: null, fresh: false, reason: 'gauge-unverified' });
      }
    }
  });

  it('rejects model results after age, movement, rotation, loss, or missing pixel confirmation', () => {
    const frame = modelFrame();
    expect(currentTapModel(frame, 1000)).not.toBeNull();
    const bad = [
      { nowMs: 1001 + TAP_MODEL_MAX_AGE_MS }, { r5CapturedAtMs: 999 },
      { r5CapturedAtMs: 1200 }, { r5Corroborated: false },
      { read: { ...frame.read, lost: true } },
      { read: { ...frame.read, shiftDeg: 8 } },
      { read: { ...frame.read, hub: { x: 120, y: 100 } } },
    ];
    for (const change of bad) expect(currentTapModel({ ...frame, ...change }, 1000)).toBeNull();
  });

  it('counts publisher and rate rejections without changing what is published', () => {
    const pub = createTapReadingPublisher({
      rateSlackBar: 0.3, rateBarPerS: 2, relockCount: 2, relockBandBar: 0.35,
    });
    pub.beginShot(1000);
    expect(pub.step({ nowMs: 1000, capturedAtMs: 1000, read: read(2) }))
      .toMatchObject({ bar: 2, fresh: true, reason: 'tap-fresh' });
    expect(pub.rejectionCounts).toMatchObject({ publisher: 0, rate: 0 });
    const rejected = pub.step({ nowMs: 1100, capturedAtMs: 1100, read: read(8) });
    expect(rejected).toMatchObject({ bar: 2, fresh: false, held: true, reason: 'held:rate-unconfirmed' });
    expect(pub.rejectionCounts.publisher).toBe(1);
    expect(pub.rejectionCounts.rate).toBe(1);
    expect(pub.step({ nowMs: 1200, capturedAtMs: 1200, read: { ...read(null), lost: true } }).fresh).toBe(false);
    expect(pub.rejectionCounts.publisher).toBe(1);
    expect(pub.rejectionCounts.byReason['pose-lost']).toBe(1);
    expect(pub.step({ nowMs: 1300, capturedAtMs: 1300, read: read(2.1) }))
      .toMatchObject({ bar: 2.1, fresh: true });
    expect(pub.rejectionCounts.publisher).toBe(1);
    pub.beginShot(2000);
    expect(pub.rejectionCounts).toMatchObject({ publisher: 0, rate: 0, byReason: {} });
    expect(pub.step({ nowMs: 2000, capturedAtMs: 2000, read: read(null) }).reason).toBe('needle-missing');
    expect(pub.rejectionCounts.publisher).toBe(0);
    expect(pub.rejectionCounts.byReason['needle-missing']).toBe(1);
  });

  it('cannot reuse an asynchronous result across a lost/reacquired pose, even at identical coordinates', () => {
    const frame = modelFrame();
    frame.read.poseEpoch = 4;
    frame.r5Pose.epoch = 4;
    expect(currentTapModel(frame, 1000)).not.toBeNull();
    for (const change of [
      { poseEpoch: 5 }, { duplicate: true }, { frameMissing: true },
      { radius: 80 }, { lost: true },
    ]) {
      const publisher = createShotLabR7Publisher(calibration);
      publisher.beginShot(1000);
      const stale = { ...frame, read: { ...frame.read, ...change } };
      expect(currentTapModel(stale, 1000)).toBeNull();
      expect(publisher.stepFrame(stale)).toMatchObject({ bar: null, fresh: false });
    }
    // Old callers with no epoch cannot certify a new production pose.
    expect(currentTapModel({ ...frame, r5Pose: { ...frame.r5Pose, epoch: undefined } }, 1000)).toBeNull();
  });

  it('does not treat a suppressed top-of-scale hold as a measurement', () => {
    const pub = createShotLabR7Publisher(calibration);
    pub.beginShot(1000);
    pub.stepFrame({ nowMs: 1000, read: read(4) });
    expect(pub.stepFrame({ nowMs: 1125, read: { ...read(4), fresh: false } }))
      .toMatchObject({ bar: 4, fresh: false, held: true });
    expect(pub.stepFrame({ nowMs: 1250, read: { ...read(10), needleDeg: 160 } }))
      .toMatchObject({ bar: 4, fresh: false, held: true });
  });
});
