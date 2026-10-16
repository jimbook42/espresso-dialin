import { describe, expect, it } from 'vitest';
import { loadPressureReplayManifest, selectClips } from './manifest.js';
import { compareReplayRuns, isHighConfidence, isValidReading, summarizeClipFrames } from './summary.js';

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

  it('summarises template conflict and quality flags without using them as a zero', () => {
    const frames = [
      { timeS: 0, gaugeFound: true, bar: null, tracking: 'CALIBRATING', confidence: 0.4, conflictDeg: 4, flags: 'CALIBRATING|blur' },
      { timeS: 1, gaugeFound: true, bar: null, tracking: 'CALIBRATING', confidence: 0.4, conflictDeg: 12, flags: 'CALIBRATING|glare' },
      { timeS: 2, gaugeFound: true, bar: 0.1, tracking: 'TRACKING', confidence: 0.4, conflictDeg: 2, flags: 'TRACKING' },
    ];
    const summary = summarizeClipFrames(frames, clip);
    expect(summary.conflictDegMedian).toBe(4);
    expect(summary.conflictDegMax).toBe(12);
    expect(summary.blurPct).toBeCloseTo(100 / 3, 5);
    expect(summary.glarePct).toBeCloseTo(100 / 3, 5);
    expect(summary.confidentButWrongPct).toBe(0);
  });

  it('treats two replays as the same run inside a small tolerance', () => {
    const left = [
      { timeS: 0.125, bar: 0.1, centreX: 230, centreY: 350 },
      { timeS: 0.25, bar: 0.12, centreX: 231, centreY: 351 },
    ];
    const right = [
      { timeS: 0.13, bar: 0.14, centreX: 232, centreY: 350 },
      { timeS: 0.26, bar: 0.1, centreX: 231, centreY: 352 },
    ];
    expect(compareReplayRuns(left, right).identical).toBe(true);
    const drifted = [
      { timeS: 0.125, bar: 1.4, centreX: 230, centreY: 350 },
      { timeS: 0.25, bar: 0.1, centreX: 260, centreY: 400 },
    ];
    const diff = compareReplayRuns(left, drifted);
    expect(diff.identical).toBe(false);
    expect(diff.barMismatch).toBeGreaterThan(0);
  });
});
