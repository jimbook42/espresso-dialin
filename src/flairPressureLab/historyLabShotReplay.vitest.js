import { describe, expect, it } from 'vitest';
import { shouldShowLabShotReplayPlay } from './historyLabShotReplay.js';

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
  });
});
