import { describe, expect, it } from 'vitest';
import { classifyReplayGaugeFrame } from './replayGaugeSemantics.js';

describe('replayGaugeSemantics', () => {
  const region = { nx: 0.5, ny: 0.5, nr: 0.28 };
  const w = 406;
  const h = 720;

  it('marks guide-default centre before reference', () => {
    const out = classifyReplayGaugeFrame({
      gauge: { cx: 203, cy: 360, radius: 113.68, confidence: 0.25, rawCx: 240, rawCy: 350 },
      videoWidth: w,
      videoHeight: h,
      region,
      referenceCaptured: false,
      likeness: 0.1,
    });
    expect(out.centreFromGuide).toBe(true);
    expect(out.gaugeFound).toBe(false);
  });

  it('treats applied pose at guide seed as guide-default even after reference', () => {
    const out = classifyReplayGaugeFrame({
      gauge: { cx: 203, cy: 360, radius: 113.68, confidence: 0.5, rawCx: 203, rawCy: 360 },
      videoWidth: w,
      videoHeight: h,
      region,
      referenceCaptured: true,
      likeness: 0.5,
    });
    expect(out.centreFromGuide).toBe(true);
    expect(out.gaugeFound).toBe(false);
  });

  it('accepts detected rim away from guide seed', () => {
    const out = classifyReplayGaugeFrame({
      gauge: { cx: 240, cy: 350, radius: 55, confidence: 0.5, rawCx: 238, rawCy: 348 },
      videoWidth: w,
      videoHeight: h,
      region,
      referenceCaptured: false,
      likeness: 0.2,
    });
    expect(out.gaugeFound).toBe(true);
    expect(out.centreFromGuide).toBe(false);
  });
});
