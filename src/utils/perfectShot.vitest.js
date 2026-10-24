import { describe, expect, it } from 'vitest';
import {
  isPerfectShot,
  pickCameo,
  PERFECT_SHOT_CELEBRATION_MS,
  PERFECT_SHOT_RECOMMENDATION_SCROLL_DELAY_MS,
} from './perfectShot.js';
import { BALANCED_TASTE_PROFILE } from './tasteProfile.js';

describe('isPerfectShot', () => {
  const base = {
    yieldG: 36,
    targetYieldG: 36,
    timeS: 28,
    timeMinS: 26,
    timeMaxS: 30,
    taste: BALANCED_TASTE_PROFILE,
  };

  it('accepts exact targets', () => {
    expect(isPerfectShot(base)).toBe(true);
  });

  it('accepts yield exactly 0.1 g off', () => {
    expect(isPerfectShot({ ...base, yieldG: 36.1 })).toBe(true);
    expect(isPerfectShot({ ...base, yieldG: 35.9 })).toBe(true);
  });

  it('rejects yield 0.11 g off', () => {
    expect(isPerfectShot({ ...base, yieldG: 36.11 })).toBe(false);
  });

  it('accepts time exactly 0.5 s off window midpoint', () => {
    expect(isPerfectShot({ ...base, timeS: 28.5 })).toBe(true);
    expect(isPerfectShot({ ...base, timeS: 27.5 })).toBe(true);
  });

  it('rejects time 0.51 s off midpoint', () => {
    expect(isPerfectShot({ ...base, timeS: 28.51 })).toBe(false);
  });

  it('uses midpoint for odd windows (25-30 → 27.5)', () => {
    const odd = { ...base, timeMinS: 25, timeMaxS: 30, timeS: 27.5 };
    expect(isPerfectShot(odd)).toBe(true);
    expect(isPerfectShot({ ...odd, timeS: 28.01 })).toBe(false);
  });

  it('requires balanced taste', () => {
    expect(isPerfectShot({ ...base, taste: 'sour' })).toBe(false);
    expect(isPerfectShot({ ...base, taste: undefined })).toBe(false);
  });

  it('accepts legacy good taste as balanced', () => {
    expect(isPerfectShot({ ...base, taste: 'good' })).toBe(true);
  });

  it('rejects missing target yield or time window', () => {
    expect(isPerfectShot({ ...base, targetYieldG: undefined })).toBe(false);
    expect(isPerfectShot({ ...base, timeMinS: undefined })).toBe(false);
  });

  it('rejects NaN inputs', () => {
    expect(isPerfectShot({ ...base, yieldG: NaN })).toBe(false);
  });
});

describe('celebration timing constants', () => {
  it('celebration lasts 4 seconds', () => {
    expect(PERFECT_SHOT_CELEBRATION_MS).toBe(4000);
  });

  it('recommendation scroll delay stays at prior ~1480 ms', () => {
    expect(PERFECT_SHOT_RECOMMENDATION_SCROLL_DELAY_MS).toBe(1480);
  });
});

describe('pickCameo', () => {
  it('returns gold below 0.05', () => {
    expect(pickCameo(() => 0)).toBe('gold');
    expect(pickCameo(() => 0.049)).toBe('gold');
  });

  it('returns suit at and above 0.05', () => {
    expect(pickCameo(() => 0.05)).toBe('suit');
    expect(pickCameo(() => 0.99)).toBe('suit');
  });
});
