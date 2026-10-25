import { describe, expect, it } from 'vitest';
import {
  initialDialCrop,
  previewPointToVideoCrop,
  videoPointToPreviewCrop,
} from './labGaugeTapView.js';

describe('labGaugeTapView crop mapping', () => {
  const crop = { cx: 398, cy: 502, half: 130 };
  const box = { w: 342, h: 420 };

  it('round-trips video ↔ preview under crop zoom', () => {
    const video = { x: 398, y: 502 };
    const preview = videoPointToPreviewCrop(video.x, video.y, box.w, box.h, crop, false);
    expect(preview).not.toBeNull();
    const back = previewPointToVideoCrop(preview.x, preview.y, box.w, box.h, crop, false);
    expect(back.x).toBeCloseTo(video.x, 0);
    expect(back.y).toBeCloseTo(video.y, 0);
  });

  it('mirrors horizontal preview when front camera mirror is on', () => {
    const left = previewPointToVideoCrop(40, 200, box.w, box.h, crop, true);
    const right = previewPointToVideoCrop(box.w - 40, 200, box.w, box.h, crop, true);
    expect(left.x + right.x).toBeCloseTo(crop.cx * 2, 0);
  });

  it('zooms dial to a reasonable crop half from radius', () => {
    const c = initialDialCrop(1205, 1384, 398, 502, 90);
    expect(c.half).toBeGreaterThan(100);
    expect(c.half).toBeLessThan(280);
    expect(c.cx).toBe(398);
  });
});
