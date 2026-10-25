import { describe, expect, it } from 'vitest';
import { objectCoverMap, previewPointToVideo } from './geometry.js';

/** Isaac phone preview: ~400×459 content in a tall box (mirrored front camera). */
const ISAAC_VIDEO = { w: 400, h: 459 };
const PHONE_BOXES = [
  { w: 342, h: 380 },
  { w: 360, h: 520 },
  { w: 390, h: 640 },
];

describe('previewPointToVideo object-cover round trip', () => {
  for (const mirrored of [true, false]) {
    it(`returns fractions in [0,1] for 1280×720 in 300×400 mirrored=${mirrored}`, () => {
      const back = previewPointToVideo(150, 200, 1280, 720, 300, 400, mirrored);
      expect(back).not.toBeNull();
      expect(back.nx).toBeGreaterThan(0);
      expect(back.nx).toBeLessThan(1);
      expect(back.ny).toBeGreaterThan(0);
      expect(back.ny).toBeLessThan(1);
    });
  }

  it('round-trips centre under object-cover for Isaac-like aspect ratios', () => {
    for (const box of PHONE_BOXES) {
      const map = objectCoverMap(ISAAC_VIDEO.w, ISAAC_VIDEO.h, box.w, box.h);
      expect(map).not.toBeNull();
      const cx = map.offsetX + (ISAAC_VIDEO.w / 2) * map.scale;
      const cy = map.offsetY + (ISAAC_VIDEO.h / 2) * map.scale;
      const back = previewPointToVideo(cx, cy, ISAAC_VIDEO.w, ISAAC_VIDEO.h, box.w, box.h, true);
      expect(back.nx).toBeCloseTo(0.5, 2);
      expect(back.ny).toBeCloseTo(0.5, 2);
    }
  });

  it('mirrors horizontal preview position back to sensor fractions', () => {
    const box = { w: 360, h: 640 };
    const left = previewPointToVideo(40, 320, ISAAC_VIDEO.w, ISAAC_VIDEO.h, box.w, box.h, true);
    const right = previewPointToVideo(box.w - 40, 320, ISAAC_VIDEO.w, ISAAC_VIDEO.h, box.w, box.h, true);
    expect(left.nx + right.nx).toBeCloseTo(1, 1);
  });
});
