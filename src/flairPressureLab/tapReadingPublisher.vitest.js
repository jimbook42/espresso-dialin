import { describe, expect, it } from 'vitest';
import { createShotLabR7Publisher } from './shotLabR7Live.js';
import { currentTapModel, TAP_DISPLAY_HOLD_MS, TAP_MODEL_MAX_AGE_MS } from './tapReadingPublisher.js';

const calibration = { hub: { x: 100, y: 100 }, zeroAngleDeg: 0, fiveAngleDeg: 75, tenAngleDeg: 160 };
const read = (bar = 5) => ({ ok: bar != null, lost: false, fresh: bar != null, bar,
  needleDeg: bar == null ? null : 75, needleQuality: 0.8, tenDeg: 160,
  hub: { x: 100, y: 100 }, radius: 60, shiftDeg: 0 });
const modelFrame = () => ({ nowMs: 1125, read: read(null), r5Registered: true,
  r5Corroborated: true, r5Bar: 5, r5Angle: 75, r5Conf: 0.9, r5CapturedAtMs: 1000,
  r5Pose: { hub: { x: 100, y: 100 }, radius: 60, shiftDeg: 0 } });

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

  it('publishes a corroborated model observation once at its capture time', () => {
    const pub = createShotLabR7Publisher(calibration);
    pub.beginShot(1000);
    expect(pub.stepFrame(modelFrame())).toMatchObject({ bar: 5, fresh: true, measuredAtMs: 1000, reason: 'model-fresh' });
    expect(pub.stepFrame({ ...modelFrame(), nowMs: 1250 })).toMatchObject({ bar: 5, fresh: false, held: true });
    pub.beginShot(2000);
    expect(pub.stepFrame({ ...modelFrame(), nowMs: 2000 }).bar).toBeNull();
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
