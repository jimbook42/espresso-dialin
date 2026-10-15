import { describe, expect, it } from 'vitest';
import { loadPressureReplayManifest, selectClips } from './manifest.js';
import { isHighConfidence, isValidReading, summarizeClipFrames } from './summary.js';

describe('pressure replay manifest', () => {
  it('loads all six clips with expected metadata', () => {
    const manifest = loadPressureReplayManifest();
    expect(manifest.clips).toHaveLength(6);
    expect(manifest.clips[0].expectedBar).toBe(0);
    expect(manifest.clips[0].tolerance).toBe(0.5);
  });

  it('selects a single clip by id', () => {
    const manifest = loadPressureReplayManifest();
    const one = selectClips(manifest, '20261015_225240');
    expect(one).toHaveLength(1);
    expect(one[0].file).toContain('225240');
  });
});

describe('pressure replay summary math', () => {
  const clip = { expectedBar: 0, tolerance: 0.5 };

  it('computes time to first valid reading and no-reading rate', () => {
    const frames = [
      { timeS: 0, gaugeFound: false, centreFromGuide: true, bar: null, tracking: 'CALIBRATING', confidence: 0.05 },
      { timeS: 0.5, gaugeFound: true, centreFromGuide: false, bar: 0.1, tracking: 'TRACKING', confidence: 0.25 },
      { timeS: 1, gaugeFound: false, centreFromGuide: false, bar: null, tracking: 'LOST', confidence: null },
    ];
    const summary = summarizeClipFrames(frames, clip);
    expect(summary.timeToFirstValidReadingS).toBe(0.5);
    expect(summary.noReadingRatePct).toBeCloseTo((2 / 3) * 100, 5);
  });

  it('flags confident-but-wrong separately from low confidence', () => {
    const frames = [
      { timeS: 0, gaugeFound: true, centreFromGuide: false, bar: 2, tracking: 'TRACKING', confidence: 0.3 },
      { timeS: 1, gaugeFound: true, centreFromGuide: false, bar: 0, tracking: 'UNCERTAIN', confidence: 0.1 },
    ];
    expect(isHighConfidence(frames[0])).toBe(true);
    expect(isValidReading(frames[1])).toBe(true);
    const summary = summarizeClipFrames(frames, clip);
    expect(summary.confidentButWrongPct).toBe(50);
    expect(summary.lowConfidencePct).toBe(50);
  });
});
