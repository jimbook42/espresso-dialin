import { describe, expect, it } from 'vitest';
import { parseBookooWeightNotification } from './protocols/bookooMini.js';
import { hexToBytes, parseTimemoreNotification } from './protocols/timemoreFramed.js';
import { normalizeBatteryPercent } from './scaleBattery.js';

describe('scale battery protocol → UI value', () => {
  it('Timemore battery notification yields a displayable percent', () => {
    const batteryNotify = hexToBytes('a5 5a 01 05 00 02 00 4b 6f 5c');
    const events = parseTimemoreNotification(batteryNotify);
    const batteryEvt = events.find((e) => e.kind === 'battery');
    expect(batteryEvt).toBeDefined();
    expect(normalizeBatteryPercent(batteryEvt?.batteryPercent)).toBe(75);
  });

  it('Bookoo weight frame battery byte yields a displayable percent', () => {
    const frame = new Uint8Array(20).fill(0);
    frame[0] = 0x03;
    frame[1] = 0x0b;
    frame[8] = 0x00;
    frame[9] = 0x00;
    frame[13] = 0x48;
    frame[19] = frame.slice(0, 19).reduce((a, b) => a ^ b, 0);
    const parsed = parseBookooWeightNotification(frame);
    expect(parsed.ok).toBe(true);
    expect(normalizeBatteryPercent(parsed.batteryPercent)).toBe(72);
  });
});
