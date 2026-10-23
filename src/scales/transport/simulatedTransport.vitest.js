import { describe, expect, it } from 'vitest';
import { createSimulatedTransport } from './simulatedTransport.js';

describe('createSimulatedTransport battery', () => {
  it('emits configured battery on connect and onBattery subscribe', async () => {
    const transport = createSimulatedTransport({ batteryPercent: 72 });
    const seen = [];
    const off = transport.onBattery((evt) => seen.push(evt.batteryPercent));
    await transport.connect();
    expect(seen).toEqual([72]);
    off();
    const late = [];
    transport.onBattery((evt) => late.push(evt.batteryPercent));
    expect(late).toEqual([72]);
    await transport.disconnect();
  });

  it('omits battery when not configured', async () => {
    const transport = createSimulatedTransport({});
    let called = false;
    transport.onBattery(() => {
      called = true;
    });
    await transport.connect();
    expect(called).toBe(false);
    await transport.disconnect();
  });
});
