import { describe, expect, it } from 'vitest';
import { formatScaleLiveWeightLabel } from './ScaleTimerControls.jsx';
import { formatScaleConnectionLabel } from '../scales/scaleBattery.js';

describe('formatScaleLiveWeightLabel', () => {
  it('formats to one decimal place with g suffix', () => {
    expect(formatScaleLiveWeightLabel(18)).toBe('18.0 g');
    expect(formatScaleLiveWeightLabel(18.04)).toBe('18.0 g');
    expect(formatScaleLiveWeightLabel(0)).toBe('0.0 g');
  });

  it('handles non-finite values as zero', () => {
    expect(formatScaleLiveWeightLabel(NaN)).toBe('0.0 g');
  });
});

describe('formatScaleConnectionLabel (render path)', () => {
  it('matches connected UI copy for known and unknown battery', () => {
    expect(formatScaleConnectionLabel(72)).toBe('Scale 72%');
    expect(formatScaleConnectionLabel(undefined)).toBe('Scale on');
  });
});
