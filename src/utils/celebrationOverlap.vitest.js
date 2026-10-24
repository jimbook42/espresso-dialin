import { describe, expect, it } from 'vitest';
import {
  brewRatioOneDecimal,
  formatPerfectShotRatioLabel,
  rectsIntersect,
} from './celebrationOverlap.js';

describe('rectsIntersect', () => {
  it('detects overlap', () => {
    expect(
      rectsIntersect(
        { top: 0, left: 0, right: 10, bottom: 10 },
        { top: 5, left: 5, right: 15, bottom: 15 },
      ),
    ).toBe(true);
  });

  it('rejects edge-touch only', () => {
    expect(
      rectsIntersect(
        { top: 0, left: 0, right: 10, bottom: 10 },
        { top: 10, left: 0, right: 20, bottom: 20 },
      ),
    ).toBe(false);
  });
});

describe('brewRatioOneDecimal', () => {
  it('formats 18:36 as 2.0', () => {
    expect(brewRatioOneDecimal(18, 36)).toBe('2.0');
  });
});

describe('formatPerfectShotRatioLabel', () => {
  it('appends on target suffix', () => {
    expect(formatPerfectShotRatioLabel('2.0')).toBe('1:2.0 · on target');
  });
});
