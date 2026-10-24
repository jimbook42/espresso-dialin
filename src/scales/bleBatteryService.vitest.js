import { describe, expect, it } from 'vitest';
import { parseBleBatteryLevelPercent } from './bleBatteryService.js';

describe('parseBleBatteryLevelPercent', () => {
  it('reads standard GATT battery byte', () => {
    expect(parseBleBatteryLevelPercent(new Uint8Array([72]))).toBe(72);
    expect(parseBleBatteryLevelPercent(new DataView(new Uint8Array([0]).buffer))).toBe(0);
    expect(parseBleBatteryLevelPercent(new Uint8Array([101]))).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseBleBatteryLevelPercent(null)).toBeNull();
    expect(parseBleBatteryLevelPercent(new Uint8Array([]))).toBeNull();
  });
});
