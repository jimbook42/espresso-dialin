import { describe, expect, it } from 'vitest';
import { shouldShowLabShotReplayPlay } from './historyLabShotReplay.js';
import {
  labPressureCurveExportDocument,
  labReplayExportFilenames,
} from './labShotReplayExport.js';

describe('shouldShowLabShotReplayPlay', () => {
  it('shows only on newest shot when replay id matches', () => {
    expect(
      shouldShowLabShotReplayPlay({
        shotId: 'newest',
        newestShotId: 'newest',
        labReplayShotId: 'newest',
      }),
    ).toBe(true);
    expect(
      shouldShowLabShotReplayPlay({
        shotId: 'older',
        newestShotId: 'newest',
        labReplayShotId: 'newest',
      }),
    ).toBe(false);
    expect(
      shouldShowLabShotReplayPlay({
        shotId: 'newest',
        newestShotId: 'newest',
        labReplayShotId: 'other',
      }),
    ).toBe(false);
    expect(
      shouldShowLabShotReplayPlay({
        shotId: 'newest',
        newestShotId: 'newest',
        labReplayShotId: null,
      }),
    ).toBe(false);
  });
});

describe('labPressureCurveExportDocument', () => {
  it('keeps shot id and timestamped bar points only', () => {
    expect(
      labPressureCurveExportDocument({
        id: 'shot-1',
        tasteProfile: 'balanced',
        labPressureCurve: [
          { tS: 0, bar: 0, confident: true },
          { tS: 1.25, bar: 6.2 },
          { tS: 2, bar: null },
        ],
      }),
    ).toEqual({
      shotId: 'shot-1',
      labPressureCurve: [
        { tS: 0, bar: 0 },
        { tS: 1.25, bar: 6.2 },
      ],
    });
  });

  it('exports an empty curve when the shot has no pressure samples', () => {
    expect(labPressureCurveExportDocument({ id: 'shot-2' })).toEqual({
      shotId: 'shot-2',
      labPressureCurve: [],
    });
  });

  it('names the video from the replay mime type', () => {
    expect(labReplayExportFilenames('shot-1', 'video/mp4')).toEqual({
      video: 'lab-replay-shot-1.mp4',
      pressure: 'lab-replay-shot-1-pressure.json',
    });
    expect(labReplayExportFilenames('shot-1', 'video/webm;codecs=vp8').video).toBe(
      'lab-replay-shot-1.webm',
    );
  });
});
