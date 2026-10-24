import { describe, expect, it } from 'vitest';
import { formatScaleConnectionLabel, normalizeBatteryPercent } from './scaleBattery.js';

describe('scaleBattery', () => {
  it('normalizeBatteryPercent accepts 0–100 only', () => {
    expect(normalizeBatteryPercent(72)).toBe(72);
    expect(normalizeBatteryPercent(0)).toBe(0);
    expect(normalizeBatteryPercent(100)).toBe(100);
    expect(normalizeBatteryPercent(-1)).toBeNull();
    expect(normalizeBatteryPercent(101)).toBeNull();
    expect(normalizeBatteryPercent(null)).toBeNull();
    expect(normalizeBatteryPercent(undefined)).toBeNull();
    expect(normalizeBatteryPercent(NaN)).toBeNull();
  });

  it('formatScaleConnectionLabel shows percent when known', () => {
    expect(formatScaleConnectionLabel(72)).toBe('Scale 72%');
    expect(formatScaleConnectionLabel(72.4)).toBe('Scale 72%');
    expect(formatScaleConnectionLabel(null)).toBe('Scale on');
  });
});
