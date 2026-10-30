import { describe, expect, it } from 'vitest';
import { decodeTipLogits } from './examModels.mjs';

function peaked(bin) {
  const logits = new Float32Array(360);
  logits.fill(-8);
  logits[bin] = 6;
  logits[(bin + 359) % 360] = 3;
  logits[(bin + 1) % 360] = 3;
  return logits;
}

describe('decodeTipLogits', () => {
  it('soft-argmax sits on the peak and keeps the ±5° mass', () => {
    const decoded = decodeTipLogits(peaked(90), new Float32Array([Math.cos(Math.PI), Math.sin(Math.PI)]));
    expect(decoded.angle).toBeCloseTo(90, 0);
    expect(decoded.conf).toBeGreaterThan(0.5);
  });

  it('cuts confidence when the aux head is more than 25° off the tip', () => {
    const agreed = decodeTipLogits(peaked(90), new Float32Array([Math.cos(Math.PI), Math.sin(Math.PI)]));
    const opposed = decodeTipLogits(peaked(90), new Float32Array([1, 0]));
    expect(opposed.conf).toBeCloseTo(agreed.conf * 0.25, 5);
  });
});
