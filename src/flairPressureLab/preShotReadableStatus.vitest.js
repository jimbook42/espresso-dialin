import { describe, expect, it } from 'vitest';
import { PRE_SHOT_DIAL_FOUND_LABEL, PRE_SHOT_DIAL_NOT_FOUND_LABEL } from './preShotDialCheck.js';
import {
  CALIBRATION_LEVER_HINT,
  PRE_SHOT_GAUGE_NOT_READABLE_LABEL,
  PRE_SHOT_READABLE_WINDOW_MS,
  createPreShotReadableWindow,
  isRecordedSampleConfident,
  preShotDialDisplayStatus,
  preShotDialStatusView,
} from './preShotReadableStatus.js';

const LOST = { bar: null, fresh: false, reason: 'pose-lost' };
const CONFIDENT = { bar: 7, fresh: true, reason: 'tap-fresh' };

function viewAt(readable, poseStatus, nowMs) {
  const snap = readable.snapshot(nowMs);
  return preShotDialStatusView(preShotDialDisplayStatus({
    poseStatus,
    nowMs,
    lastConfidentMs: snap.lastConfidentMs,
    confidentAt: snap.confidentAt,
    rejections: snap.rejections,
  }));
}

describe('pre-shot readable status', () => {
  it('uses the recorded-sample confidence gate', () => {
    expect(isRecordedSampleConfident({ bar: 7, fresh: true })).toBe(true);
    expect(isRecordedSampleConfident({ bar: 0, fresh: true })).toBe(true);
    expect(isRecordedSampleConfident({ bar: 7, fresh: false })).toBe(false);
    expect(isRecordedSampleConfident({ bar: null, fresh: true })).toBe(false);
  });

  it('locked and a recent confident reading gives green', () => {
    const readable = createPreShotReadableWindow();
    readable.note(CONFIDENT, 5000);
    expect(viewAt(readable, 'found', 5000 + PRE_SHOT_READABLE_WINDOW_MS)).toEqual({
      tone: 'green',
      label: PRE_SHOT_DIAL_FOUND_LABEL,
    });
    expect(preShotDialStatusView(preShotDialDisplayStatus({
      poseStatus: 'not_found',
      nowMs: 5000,
      lastConfidentMs: 5000,
    }))).toEqual({ tone: 'amber', label: PRE_SHOT_DIAL_NOT_FOUND_LABEL });
    expect(preShotDialStatusView(preShotDialDisplayStatus({ poseStatus: 'checking', nowMs: 0 }))).toEqual({
      tone: 'hidden',
      label: null,
    });
  });

  it('locked with no recent confident reading gives amber with the recalibrate message', () => {
    const readable = createPreShotReadableWindow();
    readable.note(CONFIDENT, 0);
    expect(viewAt(readable, 'found', PRE_SHOT_READABLE_WINDOW_MS + 1)).toEqual({
      tone: 'amber',
      label: PRE_SHOT_GAUGE_NOT_READABLE_LABEL,
    });
    expect(viewAt(createPreShotReadableWindow(), 'found', 1000)).toEqual({
      tone: 'amber',
      label: PRE_SHOT_GAUGE_NOT_READABLE_LABEL,
    });
  });

  it('pose-lost-dominated gives amber even when a confident reading is still in the window', () => {
    const readable = createPreShotReadableWindow();
    readable.note(CONFIDENT, 1000);
    readable.note(LOST, 1100);
    readable.note({ bar: null, fresh: false, reason: 'held:pose-lost' }, 1200);
    readable.note(LOST, 1250);
    expect(viewAt(readable, 'found', 1300)).toEqual({
      tone: 'amber',
      label: PRE_SHOT_GAUGE_NOT_READABLE_LABEL,
    });

    const mixed = createPreShotReadableWindow();
    mixed.note(CONFIDENT, 1000);
    mixed.note(LOST, 1100);
    mixed.note({ bar: null, fresh: false, reason: 'needle-missing' }, 1200);
    expect(viewAt(mixed, 'found', 1300).tone).toBe('green');
  });

  it('one pose-lost rejection among confident readings stays found', () => {
    const readable = createPreShotReadableWindow();
    readable.note(CONFIDENT, 1000);
    readable.note(CONFIDENT, 1100);
    readable.note(LOST, 1200);
    readable.note(CONFIDENT, 1300);
    expect(viewAt(readable, 'found', 1400)).toEqual({
      tone: 'green',
      label: PRE_SHOT_DIAL_FOUND_LABEL,
    });
  });

  it('three or more pose-lost rejections that are the majority show the recalibrate message', () => {
    const readable = createPreShotReadableWindow();
    readable.note(CONFIDENT, 1000);
    readable.note(LOST, 1100);
    readable.note(LOST, 1200);
    readable.note(LOST, 1300);
    expect(viewAt(readable, 'found', 1400)).toEqual({
      tone: 'amber',
      label: PRE_SHOT_GAUGE_NOT_READABLE_LABEL,
    });
  });

  it('three or more pose-lost rejections that are still a minority stay found', () => {
    const readable = createPreShotReadableWindow();
    readable.note(CONFIDENT, 1000);
    readable.note(CONFIDENT, 1050);
    readable.note(CONFIDENT, 1100);
    readable.note(CONFIDENT, 1150);
    readable.note(LOST, 1200);
    readable.note(LOST, 1250);
    readable.note(LOST, 1300);
    expect(viewAt(readable, 'found', 1400)).toEqual({
      tone: 'green',
      label: PRE_SHOT_DIAL_FOUND_LABEL,
    });
  });

  it('returns to green when confident readings resume', () => {
    const readable = createPreShotReadableWindow();
    readable.note(LOST, 0);
    readable.note(LOST, 400);
    readable.note(LOST, 800);
    expect(viewAt(readable, 'found', 800)).toEqual({
      tone: 'amber',
      label: PRE_SHOT_GAUGE_NOT_READABLE_LABEL,
    });
    readable.note(CONFIDENT, 2400);
    readable.note(CONFIDENT, 2700);
    expect(viewAt(readable, 'found', 2700)).toEqual({
      tone: 'green',
      label: PRE_SHOT_DIAL_FOUND_LABEL,
    });
  });

  it('keeps the calibration lever hint wording', () => {
    expect(CALIBRATION_LEVER_HINT).toBe("Set the lever where it'll be when you press Start.");
  });
});
