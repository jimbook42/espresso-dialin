import { describe, expect, it, vi } from 'vitest';
import {
  createLogoTapTester,
  nextLogoTestCelebrationVariant,
  resetLogoTestCelebrationRun,
} from './logoTapTester.js';

describe('createLogoTapTester', () => {
  it('does not trigger before 7 taps', () => {
    const onTrigger = vi.fn();
    let t = 1000;
    const tester = createLogoTapTester({ now: () => t, onTrigger, windowMs: 3000, taps: 7 });
    for (let i = 0; i < 6; i += 1) {
      t += 100;
      tester.handleTap();
    }
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('triggers on 7th tap within window and resets', () => {
    const onTrigger = vi.fn();
    let t = 0;
    const tester = createLogoTapTester({ now: () => t, onTrigger, windowMs: 3000, taps: 7 });
    for (let i = 0; i < 7; i += 1) {
      t += 200;
      tester.handleTap();
    }
    expect(onTrigger).toHaveBeenCalledTimes(1);
    tester.handleTap();
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('does not accumulate taps spaced beyond window', () => {
    const onTrigger = vi.fn();
    let t = 0;
    const tester = createLogoTapTester({ now: () => t, onTrigger, windowMs: 3000, taps: 7 });
    for (let i = 0; i < 6; i += 1) {
      t += 500;
      tester.handleTap();
    }
    t += 4000;
    tester.handleTap();
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('allows passive single taps without blocking', () => {
    const onTrigger = vi.fn();
    const passThrough = vi.fn();
    const tester = createLogoTapTester({ onTrigger, taps: 7 });
    tester.handleTap();
    passThrough();
    expect(passThrough).toHaveBeenCalled();
  });
});

describe('nextLogoTestCelebrationVariant', () => {
  it('alternates suit and gold', () => {
    resetLogoTestCelebrationRun();
    expect(nextLogoTestCelebrationVariant()).toBe('suit');
    expect(nextLogoTestCelebrationVariant()).toBe('gold');
    expect(nextLogoTestCelebrationVariant()).toBe('suit');
    expect(nextLogoTestCelebrationVariant()).toBe('gold');
  });
});
