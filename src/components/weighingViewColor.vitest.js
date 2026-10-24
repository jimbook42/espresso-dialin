import { describe, expect, it } from 'vitest';
import {
  resolveWeighingColorState,
  weighingWeightColorForState,
  WEIGHING_HIT_TOLERANCE_G,
} from './weighingViewColor.js';

describe('resolveWeighingColorState', () => {
  it('returns off when target feedback disabled or no target dose', () => {
    expect(resolveWeighingColorState(10, 18, false).state).toBe('off');
    expect(resolveWeighingColorState(10, '', true).state).toBe('off');
  });

  it('classifies hit within tolerance', () => {
    const { state } = resolveWeighingColorState(18.05, 18, true);
    expect(state).toBe('hit');
    expect(resolveWeighingColorState(17.95, 18, true).state).toBe('hit');
    expect(WEIGHING_HIT_TOLERANCE_G).toBe(0.1);
  });

  it('classifies over above tolerance', () => {
    expect(resolveWeighingColorState(18.5, 18, true).state).toBe('over');
  });

  it('classifies near when close under target', () => {
    expect(resolveWeighingColorState(17, 18, true).state).toBe('near');
  });

  it('classifies below when far under target', () => {
    expect(resolveWeighingColorState(5, 18, true).state).toBe('below');
  });
});

describe('weighingWeightColorForState', () => {
  it('returns null for off and distinct colors for feedback states', () => {
    expect(weighingWeightColorForState('off')).toBeNull();
    expect(weighingWeightColorForState('over')).toBe('#c97868');
    expect(weighingWeightColorForState('hit')).toBe('#9cb088');
    expect(weighingWeightColorForState('below', 0)).toMatch(/^rgb\(/);
  });
});
