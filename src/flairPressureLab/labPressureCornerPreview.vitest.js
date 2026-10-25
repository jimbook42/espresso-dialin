import { describe, expect, it } from 'vitest';
import {
  blendCropToFullFrame,
  CORNER_PREVIEW_BOX,
  CORNER_PREVIEW_STYLE_MIN_WRITE_MS,
  cornerPreviewCropFactor,
  cornerPreviewCropFromPose,
  cornerPreviewStyleWriteKey,
  cornerPreviewVideoStyle,
  dialCropFromPose,
  shouldWriteCornerPreviewStyle,
  smoothDialCrop,
} from './labPressureCornerPreview.js';

const VIDEO = { videoW: 1280, videoH: 720 };
const BOX = { boxW: 80, boxH: 112 };

describe('dialCropFromPose', () => {
  it('centres on hub with ~2.6× radius half', () => {
    const crop = dialCropFromPose(640, 360, 90, VIDEO.videoW, VIDEO.videoH);
    expect(crop.cx).toBe(640);
    expect(crop.cy).toBe(360);
    expect(crop.half).toBeCloseTo(90 * 2.6, 0);
  });

  it('clamps near edges without showing outside the frame', () => {
    const crop = dialCropFromPose(40, 30, 100, VIDEO.videoW, VIDEO.videoH);
    expect(crop.cx).toBeGreaterThanOrEqual(crop.half);
    expect(crop.cy).toBeGreaterThanOrEqual(crop.half);
    expect(crop.cx + crop.half).toBeLessThanOrEqual(VIDEO.videoW);
    expect(crop.cy + crop.half).toBeLessThanOrEqual(VIDEO.videoH);
  });

  it('returns null when pose radius missing', () => {
    expect(dialCropFromPose(100, 100, 0, VIDEO.videoW, VIDEO.videoH)).toBeNull();
  });
});

describe('cornerPreviewVideoStyle', () => {
  it('uses centred full frame when crop is null', () => {
    const style = cornerPreviewVideoStyle({
      ...VIDEO,
      ...BOX,
      crop: null,
    });
    expect(style.objectPosition).toBe('50% 50%');
    expect(style.transform ?? '').not.toMatch(/scale\([2-9]/);
  });

  it('zooms when crop is tight on the dial', () => {
    const crop = dialCropFromPose(900, 400, 85, VIDEO.videoW, VIDEO.videoH);
    const style = cornerPreviewVideoStyle({
      ...VIDEO,
      ...BOX,
      crop,
      mirrored: false,
    });
    expect(style.transform).toMatch(/scale\(/);
    const zoom = Number(style.transform.match(/scale\(([\d.]+)\)/)?.[1]);
    expect(zoom).toBeGreaterThan(1.2);
  });

  it('flips object-position x when mirrored', () => {
    const crop = { cx: 320, cy: 360, half: 120 };
    const plain = cornerPreviewVideoStyle({ ...VIDEO, ...BOX, crop, mirrored: false });
    const mirrored = cornerPreviewVideoStyle({ ...VIDEO, ...BOX, crop, mirrored: true });
    expect(plain.objectPosition).not.toBe(mirrored.objectPosition);
    expect(mirrored.transform).toContain('scaleX(-1)');
  });
});

describe('smoothDialCrop', () => {
  it('converges without overshooting a constant target', () => {
    const target = { cx: 500, cy: 400, half: 200 };
    let state = { cx: 100, cy: 100, half: 300 };
    for (let i = 0; i < 40; i += 1) {
      state = smoothDialCrop(state, target, 0.4);
    }
    expect(state.cx).toBeCloseTo(target.cx, 0);
    expect(state.cy).toBeCloseTo(target.cy, 0);
    expect(state.half).toBeCloseTo(target.half, 0);
    expect(state.cx).toBeLessThanOrEqual(target.cx + 1);
    expect(state.half).toBeGreaterThanOrEqual(target.half - 1);
  });
});

describe('cornerPreviewCropFactor', () => {
  it('eases to full frame when pose is stale', () => {
    const now = 10_000;
    const pose = { atMs: now - 1500, lost: false, uncertain: false };
    expect(cornerPreviewCropFactor(pose, now)).toBeGreaterThan(0);
    expect(cornerPreviewCropFactor(pose, now)).toBeLessThan(1);
    expect(cornerPreviewCropFactor({ atMs: now - 2500 }, now)).toBe(1);
  });

  it('returns full frame when pose missing', () => {
    expect(cornerPreviewCropFactor(null, Date.now())).toBe(1);
  });
});

describe('cornerPreviewCropFromPose', () => {
  it('returns null for full-frame factor', () => {
    const now = 20_000;
    const pose = {
      hubX: 640,
      hubY: 360,
      radius: 90,
      lost: false,
      uncertain: false,
      atMs: now - 3000,
    };
    expect(cornerPreviewCropFromPose(pose, VIDEO.videoW, VIDEO.videoH, now)).toBeNull();
  });

  it('blends toward centre when uncertain', () => {
    const now = 15_000;
    const pose = {
      hubX: 900,
      hubY: 200,
      radius: 80,
      lost: true,
      uncertain: true,
      atMs: now - 400,
    };
    const crop = cornerPreviewCropFromPose(pose, VIDEO.videoW, VIDEO.videoH, now);
    expect(crop).not.toBeNull();
    const tight = dialCropFromPose(pose.hubX, pose.hubY, pose.radius, VIDEO.videoW, VIDEO.videoH);
    expect(crop.half).toBeGreaterThan(tight.half * 0.85);
  });
});

describe('blendCropToFullFrame', () => {
  it('reaches frame centre at factor 1', () => {
    const crop = { cx: 200, cy: 150, half: 100 };
    const full = blendCropToFullFrame(crop, VIDEO.videoW, VIDEO.videoH, 1);
    expect(full.cx).toBeCloseTo(VIDEO.videoW / 2, 0);
    expect(full.cy).toBeCloseTo(VIDEO.videoH / 2, 0);
  });
});

describe('corner preview box and DOM style helpers', () => {
  it('keeps the on-screen preview box at 80×112 px', () => {
    expect(CORNER_PREVIEW_BOX.w).toBe(80);
    expect(CORNER_PREVIEW_BOX.h).toBe(112);
  });

  it('skips writes when the rounded style key is unchanged', () => {
    const style = cornerPreviewVideoStyle({
      ...VIDEO,
      ...BOX,
      crop: { cx: 640, cy: 360, half: 90 },
    });
    const key = cornerPreviewStyleWriteKey(style);
    expect(shouldWriteCornerPreviewStyle(key, key, 1000, 0)).toBe(false);
    expect(cornerPreviewStyleWriteKey({ ...style, transform: style.transform })).toBe(key);
  });

  it('throttles writes to at most ~15/s when the key changes', () => {
    const t0 = 10_000;
    expect(shouldWriteCornerPreviewStyle('a', '', t0, 0)).toBe(true);
    expect(shouldWriteCornerPreviewStyle('b', 'a', t0 + 10, t0)).toBe(false);
    expect(
      shouldWriteCornerPreviewStyle('b', 'a', t0 + CORNER_PREVIEW_STYLE_MIN_WRITE_MS, t0),
    ).toBe(true);
  });

});
