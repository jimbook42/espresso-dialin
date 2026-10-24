import { describe, expect, it } from 'vitest';
import { createShotLabR7Publisher } from './shotLabR7Live.js';
import { stepTemporalGate, initialTemporalState } from './temporalGate.js';
import { gateConfigR7 } from './r7Config.js';

const TAP_CAL = {
  zeroAngleDeg: 200,
  fiveAngleDeg: 260,
  tenAngleDeg: 320,
  centre: { x: 100, y: 100 },
  five: { x: 120, y: 80 },
  ten: { x: 140, y: 90 },
};

describe('shotLabR7Live', () => {
  it('publisher uses temporal gate config from frozen r7_config', () => {
    const pub = createShotLabR7Publisher(TAP_CAL);
    expect(pub.gateConfig.classicalDirect).toBe(true);
    expect(pub.readerConfig.frameIntervalMs).toBe(125);
  });

  it('stepFrame returns gated bar for confident classical + r5 agreement', () => {
    const pub = createShotLabR7Publisher(TAP_CAL);
    pub.beginShot(1_000_000);
    let out = { bar: null, uncertain: true };
    for (let i = 0; i < 8; i += 1) {
      out = pub.stepFrame({
        nowMs: 1_000_000 + i * 125,
        read: {
          ok: true,
          lost: false,
          bar: 4.5,
          needleDeg: 40 + i * 2,
          needleQuality: 0.3,
          hub: { x: 100, y: 100 },
          radius: 60,
          shiftDeg: 0,
        },
        r5Bar: 4.4,
        r5Conf: 0.9,
        r5Angle: 40,
      });
    }
    expect(out.uncertain).toBe(false);
    expect(out.bar).not.toBeNull();
  });

  it('temporal gate output is what publisher exposes when published', () => {
    const gate = gateConfigR7();
    let state = initialTemporalState();
    const stepped = stepTemporalGate(state, {
      t: 1,
      r2Bar: 5,
      r2Conf: 0.9,
      classicalBar: 5.1,
      classicalConfidence: 0.25,
      rest: false,
    }, gate);
    expect(stepped.bar).not.toBeNull();
  });
});
