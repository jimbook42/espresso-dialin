import { describe, expect, it } from 'vitest';
import {
  NICHE_ZERO_GRINDER_ID,
  SETTE_GRINDER_ID,
  SUNBEAM_GRINDER_ID,
  uiStateFromRecommendedSetting,
} from '../grinders/grinderRegistry.js';
import { EUREKA_SPECIALITA_GRINDER_ID } from '../grinders/presetGrinders/catalog.js';
import {
  getAgeAdjustedRecommendation,
  getDialRecommendation,
  recomputeReferenceLearningRecommendationFromLastShot,
} from './grinderLogic.js';
import { formatGrindRecommendationSummary } from './grindRecommendationDisplay.js';

const mockDate = new Date(2026, 10, 24, 12);
const bean = { id: 'bean', roastDate: '2026-11-04', roastType: 'Medium' };
const recipe = { targetDoseG: 18, targetYieldG: 36, targetTimeMinS: 27, targetTimeMaxS: 32 };
const keepReason = 'KEEP GRIND — Balanced and in range.';
const shot = {
  ...recipe,
  id: 'shot', beanId: bean.id, grinderModel: SETTE_GRINDER_ID, beanAgeDays: 10,
  setteMacro: 8, setteMicro: 'A', actualTimeS: 30, actualDoseG: 18, actualYieldG: 36,
  tasteProfile: 'balanced',
  recommendation: { recommendedSetting: { macro: 9, micro: 'D' }, reason: 'GO COARSER — Old result.' },
};

function recommend(source = shot, overrides = {}) {
  return getDialRecommendation({
    lastLoggedShot: source,
    lastLearningShot: source,
    activeBean: bean,
    activeRecipe: recipe,
    beanShotsForGrinder: [source],
    grinderModel: source.grinderModel,
    mockDate,
    ...overrides,
  });
}

describe('Dial recommendation bean ageing', () => {
  it.each([
    [-4, { macro: 8, micro: 'C' }, 'coarser'],
    [-3, { macro: 8, micro: 'B' }, 'coarser'],
    [-2, { macro: 8, micro: 'B' }, 'coarser'],
    [-1, { macro: 8, micro: 'A' }, null],
    [0, { macro: 8, micro: 'A' }, null],
    [4, { macro: 8, micro: 'A' }, null],
    [5, { macro: 7, micro: 'I' }, 'finer'],
    [9, { macro: 7, micro: 'I' }, 'finer'],
    [10, { macro: 7, micro: 'H' }, 'finer'],
  ])('uses the live Sette result at an effective age delta of %i days', (delta, setting, direction) => {
    const rec = recommend({ ...shot, beanAgeDays: 20 - delta });
    expect(rec.recommendedSetting).toEqual(setting);
    const summary = formatGrindRecommendationSummary(SETTE_GRINDER_ID, rec);
    if (direction) {
      expect(rec.ageWarning).toContain(`shifted ${direction}`);
      expect(summary).toBe(
        `Grind ${direction} · Adjusted for bean ${delta > 0 ? 'ageing' : 'freshness'}. · Target setting: ${setting.macro}-${setting.micro}`
      );
    } else {
      expect(rec.ageWarning).toBeNull();
      expect(summary).toBe('Keep the same grind · Balanced and in range. · Target setting: 8-A');
    }
  });

  it('works without a saved recommendation and applies two micro steps to the live target once', () => {
    const rec = recommend({ ...shot, recommendation: undefined, tasteProfile: 'bitter' });
    expect(rec.originalReason).toContain('COARSER');
    expect(rec.recommendedSetting).toEqual({ macro: 7, micro: 'I' });
    expect(uiStateFromRecommendedSetting(SETTE_GRINDER_ID, rec.recommendedSetting)).toEqual({
      setteMacro: 7, setteMicro: 'I',
    });
    expect(rec.reason).toBe('GRIND FINER — Adjusted for bean ageing.');
  });

  it('explains a net hold when the age offset cancels the live move', () => {
    const rec = recommend({ ...shot, beanAgeDays: 15, tasteProfile: 'bitter' });
    expect(rec.recommendedSetting).toEqual({ macro: 8, micro: 'A' });
    expect(rec.grindSettingHeld).toBe(true);
    expect(rec.ageWarning).toContain('shot-based recommendation was shifted finer');
    expect(formatGrindRecommendationSummary(SETTE_GRINDER_ID, rec)).toContain('Keep the same grind · Adjusted for bean ageing.');
  });

  it('uses effective age for frozen, thawed and vacuum-stored beans', () => {
    const frozen = { ...bean, storageType: 'frozen', freezeDate: '2026-11-14' };
    expect(recommend(shot, { activeBean: frozen }).ageWarning).toBeNull();
    const fresher = recommend({ ...shot, beanAgeDays: 14 }, { activeBean: frozen });
    expect(fresher.recommendedSetting).toEqual({ macro: 8, micro: 'C' });
    expect(fresher.ageWarning).toContain('4 days fresher');
    const thawed = { ...frozen, thawDate: '2026-11-19' };
    expect(recommend(shot, { activeBean: thawed }).recommendedSetting).toEqual({ macro: 7, micro: 'I' });
    expect(recommend(shot, { activeBean: { ...thawed, postThawStorage: 'vacuum' } }).ageWarning).toBeNull();
  });

  it('requires a known baseline bean age and roast date', () => {
    expect(recommend({ ...shot, beanAgeDays: undefined }).ageWarning).toBeNull();
    expect(recommend({ ...shot, beanAgeDays: null }).ageWarning).toBeNull();
    expect(recommend(shot, { activeBean: { ...bean, roastDate: '' } }).ageWarning).toBeNull();
  });

  it('uses the previous recipe’s saved setting until a shot matches the new recipe', () => {
    const newRecipe = { ...recipe, targetYieldG: 42 };
    const previous = recommend(shot, { activeRecipe: newRecipe });
    expect(previous.previousRecipeDisclaimer).toContain('previous recipe');
    expect(previous.recommendedSetting).toEqual({ macro: 9, micro: 'B' });
    expect(formatGrindRecommendationSummary(SETTE_GRINDER_ID, previous)).toContain('Grind coarser');

    const currentShot = { ...shot, ...newRecipe, id: 'current', actualYieldG: 42, beanAgeDays: 20 };
    const current = recommend(currentShot, { activeRecipe: newRecipe, beanShotsForGrinder: [currentShot, shot] });
    expect(current.previousRecipeDisclaimer).toBeUndefined();
    expect(current.ageWarning).toBeNull();
    expect(current.recommendedSetting).toEqual({ macro: 8, micro: 'A' });
    const switchedBack = recommend(currentShot, { beanShotsForGrinder: [currentShot, shot] });
    expect(switchedBack.previousRecipeDisclaimer).toBeUndefined();
    expect(switchedBack.recommendedSetting).toEqual({ macro: 7, micro: 'H' });
  });

  it('uses the saved recommendation when a recipe is unavailable', () => {
    const rec = recommend(shot, { activeRecipe: null });
    expect(rec.recommendedSetting).toEqual({ macro: 9, micro: 'B' });
    expect(rec.ageWarning).toContain('10 days older');
  });

  it('omits the warning at the grinder limit and allows a partial change to the limit', () => {
    const finest = recommend({ ...shot, setteMacro: 1 });
    expect(finest.recommendedSetting).toEqual({ macro: 1, micro: 'A' });
    expect(finest.ageWarning).toBeNull();
    const nearFinest = recommend({ ...shot, setteMacro: 1, setteMicro: 'B' });
    expect(nearFinest.recommendedSetting).toEqual({ macro: 1, micro: 'A' });
    expect(nearFinest.ageWarning).toContain('shifted finer');
    expect(formatGrindRecommendationSummary(SETTE_GRINDER_ID, nearFinest)).toContain('finest setting on your dial');
  });

  it.each([
    { reason: 'KEEP GRIND — Dial is at its limit.', grindSettingHeld: true },
    { reason: 'KEEP GRIND — Shot time was off target but grind step is capped until more comparable shots are logged.' },
    { reason: 'LIKELY OUTLIER — Damped movement.' },
    { reason: keepReason, outlierGrindHeld: true },
    { reason: keepReason, engineStats: { severeChoke: true } },
  ])('respects the protected saved recommendation $reason', (rec) => {
    const recommendation = { ...rec, recommendedSetting: { macro: 8, micro: 'A' } };
    expect(getAgeAdjustedRecommendation({ ...shot, recommendation }, bean, mockDate)).toMatchObject({
      ...recommendation, ageWarning: null,
    });
  });

  it('respects a live outlier’s damped recommendation', () => {
    const outlier = { ...shot, actualTimeS: 84, actualYieldG: 36 };
    const sameAge = recommend({ ...outlier, beanAgeDays: 20 });
    expect(sameAge.reason).toMatch(/likely outlier/i);
    expect(recommend(outlier)).toEqual(sameAge);
  });

  it('requires at least ten older days for an age shift on the Sunbeam', () => {
    const sunbeam = { ...shot, grinderModel: SUNBEAM_GRINDER_ID, sunbeamSetting: 15 };
    expect(recommend({ ...sunbeam, beanAgeDays: 11 })).toMatchObject({
      recommendedSetting: { setting: 15 }, ageWarning: null,
    });
    expect(recommend(sunbeam)).toMatchObject({
      recommendedSetting: { setting: 14 }, ageWarning: expect.stringContaining('shifted finer'),
    });
  });

  it('uses the configured grind direction for custom adjustments', () => {
    const customGrinder = { name: 'Custom', min: 1, max: 20, step: 1, lowerIsFiner: false };
    const custom = { ...shot, grinderModel: customGrinder.name, customGrindValue: 12 };
    const rec = recommend(custom, { settings: { customGrinder } });
    expect(rec.recommendedSetting).toEqual({ customGrindValue: 13 });
    expect(rec.reason).toContain('GRIND FINER');
  });

  it.each([
    [NICHE_ZERO_GRINDER_ID, { nicheZeroSetting: 18 }],
    [EUREKA_SPECIALITA_GRINDER_ID, { customGrindValue: 2 }],
  ])('keeps the live reference-learning result on %s without claiming an age shift', (grinderModel, grind) => {
    const source = { ...shot, ...grind, grinderModel };
    const rec = recommend(source);
    const live = recomputeReferenceLearningRecommendationFromLastShot(source, recipe, [source]);
    expect(rec.recommendedSetting).toEqual(live.recommendedSetting);
    expect(rec.reason).toBe(live.reason);
    expect(rec.ageWarning).toBeNull();
  });

  it('leaves the saved recommendation for unknown grinders without claiming a shift', () => {
    const recommendation = { recommendedSetting: { customGrindValue: 12 }, reason: keepReason };
    expect(recommend({ ...shot, grinderModel: 'Unknown', recommendation })).toMatchObject({
      ...recommendation, ageWarning: null,
    });
  });
});
