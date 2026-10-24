import { describe, expect, it } from 'vitest';
import {
  formatWeighingTargetDoseLine,
  isWeighingChipEnabled,
  shouldAutoCloseWeighingView,
} from './weighingViewFormat.js';

describe('formatWeighingTargetDoseLine', () => {
  it('formats target and signed diff to one decimal', () => {
    expect(formatWeighingTargetDoseLine(18.2, 18)).toBe('18.0 g · +0.2');
    expect(formatWeighingTargetDoseLine(17.85, 18)).toBe('18.0 g · -0.1');
    expect(formatWeighingTargetDoseLine(0, 18)).toBe('18.0 g · -18.0');
  });

  it('returns null when recipe has no target dose', () => {
    expect(formatWeighingTargetDoseLine(12, '')).toBeNull();
    expect(formatWeighingTargetDoseLine(12, null)).toBeNull();
    expect(formatWeighingTargetDoseLine(12, undefined)).toBeNull();
  });
});

describe('isWeighingChipEnabled', () => {
  it('is enabled only when connected and timer idle', () => {
    expect(isWeighingChipEnabled(true, false)).toBe(true);
    expect(isWeighingChipEnabled(true, true)).toBe(false);
    expect(isWeighingChipEnabled(false, false)).toBe(false);
  });
});

describe('shouldAutoCloseWeighingView', () => {
  it('closes when shot starts or scale disconnects while open', () => {
    expect(shouldAutoCloseWeighingView(true, true, true)).toBe(true);
    expect(shouldAutoCloseWeighingView(true, false, false)).toBe(true);
    expect(shouldAutoCloseWeighingView(true, false, true)).toBe(false);
    expect(shouldAutoCloseWeighingView(false, true, false)).toBe(false);
  });
});
