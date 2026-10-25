import { describe, expect, it } from 'vitest';
import {
  nextTapPhaseAfterConfirm,
  phaseAfterRedo,
  pointerToVideoPoint,
} from './labGaugeTapPlacement.js';

describe('labGaugeTapPlacement', () => {
  it('advances centre → five → ten → calibration', () => {
    expect(nextTapPhaseAfterConfirm('centre')).toBe('five');
    expect(nextTapPhaseAfterConfirm('five')).toBe('ten');
    expect(nextTapPhaseAfterConfirm('ten')).toBe('runCalibration');
  });

  it('redo walks back through committed taps', () => {
    expect(phaseAfterRedo('review', { centre: {}, five: {}, ten: {} })).toBe('ten');
    expect(phaseAfterRedo('ten', { centre: {}, five: {}, ten: null })).toBe('ten');
    expect(phaseAfterRedo('five', { centre: {}, five: null, ten: null })).toBe('five');
  });

  it('maps pointer through a mirrored object-cover box', () => {
    const videoSize = { w: 400, h: 459 };
    const frameRect = { left: 10, top: 20, width: 360, height: 640 };
    const pt = pointerToVideoPoint(
      frameRect.left + frameRect.width / 2,
      frameRect.top + frameRect.height / 2,
      frameRect,
      videoSize,
      true,
    );
    expect(pt.x).toBeCloseTo(200, 0);
    expect(pt.y).toBeCloseTo(229.5, 0);
  });
});
