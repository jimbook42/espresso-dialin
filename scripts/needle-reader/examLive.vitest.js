import { describe, expect, it } from 'vitest';
import { restOffsetDeg, truthBar, truthBarForLabel } from './examLive.mjs';

describe('exam live label truth', () => {
  it('maps a tip between rest and 10 onto that span', () => {
    expect(truthBar(50, 0, 100)).toBeCloseTo(5, 5);
  });

  it('treats rest-phase frames as 0 and leaves other phases on the label span', () => {
    const rows = [
      { clip: 'a', phase: 'rest', labelZero: 10, labelNeedle: 16 },
      { clip: 'b', phase: 'rest', labelZero: 20, labelNeedle: 24 },
    ];
    const offset = restOffsetDeg(rows, 'a');
    expect(offset).toBeCloseTo(4, 5);
    expect(truthBarForLabel({ phase: 'rest', labelZero: 10, labelNeedle: 16, labelTen: 170 }, offset)).toBe(0);
    expect(truthBarForLabel({
      phase: 'peak',
      labelZero: 0,
      labelNeedle: 80,
      labelTen: 160,
    }, 0)).toBeCloseTo(5, 5);
  });
});