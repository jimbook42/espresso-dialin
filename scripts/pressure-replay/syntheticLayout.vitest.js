import { describe, expect, it } from 'vitest';
import {
  DIAMETER_MAX_PX,
  DIAMETER_MIN_PX,
  SYNTHETIC_HEIGHT,
  SYNTHETIC_WIDTH,
  planSmallGaugeVariant,
  scoringClip,
} from './syntheticLayout.js';

const source = {
  id: '20261015_225219',
  expectedBar: 0,
  expectedPeakBar: null,
  tolerance: 0.5,
};

function plan() {
  return planSmallGaugeVariant({
    clipId: source.id,
    frameWidth: 406,
    frameHeight: 720,
    dialCx: 232,
    dialCy: 349,
    dialRadius: 51,
  });
}

describe('small-gauge synthetic layout', () => {
  it('is seeded and keeps the dial inside 120–180 px', () => {
    const first = plan();
    const second = plan();
    expect(first).toEqual(second);
    expect(first.compositing.diameter).toBeGreaterThanOrEqual(DIAMETER_MIN_PX);
    expect(first.compositing.diameter).toBeLessThanOrEqual(DIAMETER_MAX_PX);
    const centreX = first.compositing.originX + (232 - first.compositing.cropX) * (first.compositing.diameter / 102);
    const centreY = first.compositing.originY + (349 - first.compositing.cropY) * (first.compositing.diameter / 102);
    expect(centreX).toBeGreaterThan(0);
    expect(centreX).toBeLessThan(SYNTHETIC_WIDTH);
    expect(centreY).toBeGreaterThan(0);
    expect(centreY).toBeLessThan(SYNTHETIC_HEIGHT);
    const midX = SYNTHETIC_WIDTH / 2;
    const midY = SYNTHETIC_HEIGHT / 2;
    expect(Math.hypot(centreX - midX, centreY - midY)).toBeGreaterThan(40);
  });

  it('gives scoring only the expected bar, not the placement', () => {
    const row = scoringClip(source, plan());
    expect(row.expectedBar).toBe(0);
    expect(row.file).toBe('20261015_225219-small.mp4');
    expect(row).not.toHaveProperty('cx');
    expect(row).not.toHaveProperty('cy');
    expect(row).not.toHaveProperty('radius');
    expect(row).not.toHaveProperty('scoringCentre');
    expect(row).not.toHaveProperty('originX');
    expect(JSON.stringify(row)).not.toMatch(/cropX|hotspot|occluder|pinch/);
  });
});