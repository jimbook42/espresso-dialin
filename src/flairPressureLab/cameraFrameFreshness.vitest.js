import { describe, expect, it } from 'vitest';
import { isRepeatedGaugeFrame } from './cameraFrameFreshness.js';

const frame = () => ({ width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4).fill(120) });
const cal = { hub: { x: 100, y: 100 }, radius: 20 };

describe('camera pixel freshness', () => {
  it('recognizes a repeated gauge image even when the driver gives it another frame ID', () => {
    const image = frame(), copy = frame();
    expect(isRepeatedGaugeFrame(copy, image, cal)).toBe(true);
    expect(isRepeatedGaugeFrame(image, null, cal)).toBe(false);
  });

  it('retains every pixel change around the gauge, without a motion threshold', () => {
    const image = frame(), changed = frame();
    changed.data[(100 * 200 + 101) * 4 + 1] += 1;
    expect(isRepeatedGaugeFrame(changed, image, cal)).toBe(false);
  });

  it('ignores unrelated background changes and treats resolution changes as new frames', () => {
    const image = frame(), background = frame();
    background.data[0] += 1;
    expect(isRepeatedGaugeFrame(background, image, cal)).toBe(true);
    expect(isRepeatedGaugeFrame({ ...image, width: 100 }, image, cal)).toBe(false);
  });
});
