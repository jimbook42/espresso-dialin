import { describe, expect, it } from 'vitest';
import { resolveRecommendationFollowedForSave } from './recommendationFollowed.js';
import { DF64_GEN2_GRINDER_ID } from '../grinders/presetGrinders/catalog.js';

describe('resolveRecommendationFollowedForSave', () => {
  it('matches on-screen 9b rec even when last learning shot stored a different rec', () => {
    const displayed = {
      recommendedSetting: { customGrindValue: 9.5 },
    };
    const followed = resolveRecommendationFollowedForSave({
      displayedRecommendation: displayed,
      grinderModel: DF64_GEN2_GRINDER_ID,
      savedGrind: { customGrindValue: 9.5 },
      settings: { df64Gen2ZeroOffset: 0 },
    });
    expect(followed).toBe(true);
  });

  it('returns null when the dial-in screen shows no recommendation', () => {
    expect(
      resolveRecommendationFollowedForSave({
        displayedRecommendation: null,
        grinderModel: DF64_GEN2_GRINDER_ID,
        savedGrind: { customGrindValue: 9 },
      })
    ).toBe(null);
  });

  it('returns false when grind differs from displayed rec (manual adjust)', () => {
    const followed = resolveRecommendationFollowedForSave({
      displayedRecommendation: { recommendedSetting: { customGrindValue: 10 } },
      grinderModel: DF64_GEN2_GRINDER_ID,
      savedGrind: { customGrindValue: 9 },
      settings: { df64Gen2ZeroOffset: 0 },
    });
    expect(followed).toBe(false);
  });

  it('uses displayed rec after a deleted test shot would change lastLearningShot', () => {
    const followed = resolveRecommendationFollowedForSave({
      displayedRecommendation: { recommendedSetting: { macro: 12, micro: 'C' } },
      grinderModel: 'Sette 270Wi',
      savedGrind: { setteMacro: 12, setteMicro: 'C' },
    });
    expect(followed).toBe(true);
  });
});
