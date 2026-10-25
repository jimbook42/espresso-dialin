import { describe, expect, it } from 'vitest';
import {
  initialDialCrop,
  loupeCircleFillRatio,
  paintLoupeFromSource,
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

describe('loupeCircleFillRatio', () => {
  it('measures opaque pixels inside the loupe circle', () => {
    const loupeSize = 80;
    const data = new Uint8ClampedArray(loupeSize * loupeSize * 4);
    for (let y = 0; y < loupeSize; y += 1) {
      for (let x = 0; x < loupeSize; x += 1) {
        const o = (y * loupeSize + x) * 4;
        const inside = Math.hypot(x - loupeSize / 2, y - loupeSize / 2) <= loupeSize / 2 - 2;
        data[o + 3] = inside ? 255 : 0;
      }
    }
    const ctx = {
      getImageData: () => ({ data, width: loupeSize, height: loupeSize }),
    };
    expect(loupeCircleFillRatio(ctx, loupeSize)).toBeGreaterThan(0.98);
    for (let y = 0; y < loupeSize; y += 1) {
      for (let x = 0; x < loupeSize; x += 1) {
        if (Math.hypot(x - loupeSize / 2, y - loupeSize / 2) <= loupeSize / 2 - 2) {
          data[(y * loupeSize + x) * 4 + 3] = 0;
        }
      }
    }
    expect(loupeCircleFillRatio(ctx, loupeSize)).toBeLessThan(0.02);
  });
});

describe('paintLoupeFromSource', () => {
  it('is exported for the setup sheet and screenshot pixel checks', () => {
    expect(typeof paintLoupeFromSource).toBe('function');
  });
});
