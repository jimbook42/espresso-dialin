import { describe, expect, it } from 'vitest';
import { classifyReplayGaugeFrame } from './replayGaugeSemantics.js';

describe('replayGaugeSemantics', () => {
  it('requires rim confidence and registration', () => {
    const out = classifyReplayGaugeFrame({
      gauge: { cx: 240, cy: 350, radius: 55, confidence: 0.25 },
      referenceCaptured: true,
    });
    expect(out.gaugeFound).toBe(false);
    expect(out.centreFromGuide).toBe(false);
  });

  it('accepts detected rim after dial registration', () => {
    const out = classifyReplayGaugeFrame({
      gauge: { cx: 240, cy: 350, radius: 55, confidence: 0.5 },
      referenceCaptured: true,
    });
    expect(out.gaugeFound).toBe(true);
    expect(out.centreFromGuide).toBe(false);
  });

  it('rejects unregistered dial even with rim score', () => {
    const out = classifyReplayGaugeFrame({
      gauge: { cx: 203, cy: 360, radius: 113, confidence: 0.55 },
      referenceCaptured: false,
    });
    expect(out.gaugeFound).toBe(false);
  });
});
