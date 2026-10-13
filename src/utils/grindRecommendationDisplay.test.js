import assert from 'assert';
import { calculateRecommendation } from './grinderLogic.js';
import { formatGrindRecommendationSummary } from './grindRecommendationDisplay.js';
import { KNOWN_ISSUE_OUTLIER_HINT } from './recommendationTuning.js';

export function runGrindRecommendationDisplayTests() {
  const rec = {
    recommendedSetting: { macro: 14, micro: 'A' },
    reason: 'GO 2 MICRO STEP(S) FINER — Shot was 4s off target midpoint.',
  };
  const summary = formatGrindRecommendationSummary('Sette 270Wi', rec);
  assert.match(summary, /Grind finer/i);
  assert.match(summary, /4s off target/i);
  assert.match(summary, /14-A/);

  const keep = formatGrindRecommendationSummary('Sette 270Wi', {
    recommendedSetting: { macro: 13, micro: 'E' },
    reason: 'KEEP GRIND — Balanced and in range.',
  });
  assert.match(keep, /Keep the same grind/i);
  assert.match(keep, /13-E/);

  const customSettings = {
    grinderModel: 'DF64',
    customGrinder: {
      name: 'DF64',
      dialType: 'stepped',
      min: 1,
      max: 20,
      step: 1,
      lowerIsFiner: true,
    },
  };
  const customRec = calculateRecommendation(
    {
      grinderModel: 'DF64',
      customGrindValue: 11,
      wasPurged: true,
      actualTime: 12,
      actualYield: 36,
      tasteProfile: 'sour',
    },
    { targetTimeMinS: 25, targetTimeMaxS: 30, targetDoseG: 18, targetYieldG: 36 },
    [],
    false,
    { settings: customSettings }
  );
  const customSummary = formatGrindRecommendationSummary('DF64', customRec, customSettings);
  assert.match(customSummary, /Estimated/i);
  assert.match(customSummary, /Target setting: 9/);
  assert.doesNotMatch(customSummary, /Target setting: 15/);

  const outlierHold = formatGrindRecommendationSummary('Sette 270Wi', {
    recommendedSetting: { macro: 13, micro: 'E' },
    reason:
      'LIKELY OUTLIER — Shot time (45s) is unusually slow. Holding to a small grind change. GO 2 MICRO STEP(S) FINER — Shot was 15s off target midpoint.',
    warning: KNOWN_ISSUE_OUTLIER_HINT,
  });
  assert.match(outlierHold, /Grind setting held/i);
  assert.match(outlierHold, /known issue/i);
  assert.doesNotMatch(outlierHold, /Grind finer/i);
  assert.doesNotMatch(outlierHold, /If channeling, puck prep/i);

  console.log('Grind recommendation display tests passed.');
}
