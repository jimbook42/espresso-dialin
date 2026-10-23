import { describe, expect, it } from 'vitest';
import { createScaleSession } from './scaleSession.js';

describe('createScaleSession battery', () => {
  it('forwards normalized battery from transport onBattery', () => {
    const batterySubs = [];
    const transport = {
      onWeight: () => () => {},
      onTimer: () => () => {},
      onBattery: (handler) => {
        batterySubs.push(handler);
        return () => {};
      },
    };
    let received = null;
    createScaleSession(transport, {
      onBatteryPercent: (pct) => {
        received = pct;
      },
    });
    batterySubs[0]({ batteryPercent: 85 });
    expect(received).toBe(85);
  });

  it('drops invalid battery values', () => {
    const batterySubs = [];
    const transport = {
      onWeight: () => () => {},
      onTimer: () => () => {},
      onBattery: (handler) => {
        batterySubs.push(handler);
        return () => {};
      },
    };
    let received = null;
    createScaleSession(transport, {
      onBatteryPercent: (pct) => {
        received = pct;
      },
    });
    batterySubs[0]({ batteryPercent: 150 });
    expect(received).toBeNull();
  });
});
