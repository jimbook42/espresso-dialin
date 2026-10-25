import { describe, expect, it } from 'vitest';
import { dialPoseMismatchWarning, hubDistancePx } from './shotStartDialPoseCheck.js';

describe('shotStartDialPoseCheck', () => {
  const calHub = { x: 100, y: 100 };
  const calRadius = 80;

  it('flags missing or lost pose', () => {
    expect(dialPoseMismatchWarning({ poseLost: true, calibratedHub: calHub, calibratedRadius: calRadius }))
      .toBe(true);
    expect(dialPoseMismatchWarning({ trackedHub: null, calibratedHub: calHub, calibratedRadius: calRadius }))
      .toBe(true);
  });

  it('allows hub near calibration', () => {
    expect(
      dialPoseMismatchWarning({
        trackedHub: { x: 110, y: 105 },
        calibratedHub: calHub,
        calibratedRadius: calRadius,
      }),
    ).toBe(false);
  });

  it('flags hub farther than 0.6× calibrated radius', () => {
    const far = { x: calHub.x + calRadius * 0.7, y: calHub.y };
    expect(hubDistancePx(far, calHub)).toBeGreaterThan(0.6 * calRadius);
    expect(
      dialPoseMismatchWarning({
        trackedHub: far,
        calibratedHub: calHub,
        calibratedRadius: calRadius,
      }),
    ).toBe(true);
  });
});
