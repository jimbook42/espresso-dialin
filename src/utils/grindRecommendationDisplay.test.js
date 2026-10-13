import assert from 'assert';
import { calculateRecommendation } from './grinderLogic.js';
import { formatGrindRecommendationSummary } from './grindRecommendationDisplay.js';
import { countChannelingMentions, KNOWN_ISSUE_OUTLIER_HINT } from './recommendationTuning.js';

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

  const outlierHold = formatGrindRecommendationSummary(
    'Sette 270Wi',
    {
      recommendedSetting: { macro: 13, micro: 'E' },
      reason:
        'LIKELY OUTLIER — Shot time (45s) is unusually slow. Holding grind unchanged. KEEP GRIND — Balanced and in range.',
      warning: KNOWN_ISSUE_OUTLIER_HINT,
      grindSettingHeld: true,
    },
    null,
    { setteMacro: 13, setteMicro: 'E' }
  );
  assert.match(outlierHold, /Grind setting held/i);
  assert.match(outlierHold, /current grind setting/i);
  assert.doesNotMatch(outlierHold, /Grind finer/i);
  assert.doesNotMatch(outlierHold, /channeling/i);

  const recipe = {
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
    targetDoseG: 18,
    targetYieldG: 36,
  };
  const setteHistory = [
    {
      grinderModel: 'Sette 270Wi',
      setteMacro: 13,
      setteMicro: 'E',
      actualTimeS: 28,
      actualYieldG: 36,
      tasteProfile: 'balanced',
      targetTimeMinS: 25,
      targetTimeMaxS: 30,
      timestamp: '2026-01-01T00:00:00.000Z',
    },
  ];
  const moveRec = calculateRecommendation(
    {
      grinderModel: 'Sette 270Wi',
      setteMacro: 13,
      setteMicro: 'E',
      wasPurged: true,
      actualTime: 45,
      actualYield: 36,
      tasteProfile: 'bitter',
    },
    recipe,
    setteHistory
  );
  assert.equal(moveRec.grindSettingHeld, false);
  assert.ok(Math.abs(moveRec.engineStats.shift) > 0, '45s outlier should still move grind');
  const moveSummary = formatGrindRecommendationSummary(
    'Sette 270Wi',
    moveRec,
    null,
    { setteMacro: 13, setteMicro: 'E' }
  );
  assert.doesNotMatch(moveSummary, /Grind setting held/i);

  const holdRec = calculateRecommendation(
    {
      grinderModel: 'Sette 270Wi',
      setteMacro: 13,
      setteMicro: 'E',
      wasPurged: true,
      actualTime: 8,
      actualYield: 36,
      tasteProfile: 'balanced',
    },
    recipe,
    setteHistory
  );
  assert.equal(holdRec.grindSettingHeld, true);
  const holdSummary = formatGrindRecommendationSummary(
    'Sette 270Wi',
    holdRec,
    null,
    { setteMacro: 13, setteMicro: 'E' }
  );
  assert.match(holdSummary, /Grind setting held/i);
  assert.equal(
    countChannelingMentions(holdSummary, holdRec.warning, holdRec.nicheLearningNote),
    1
  );

  const nicheHistory = [
    {
      grinderModel: 'Niche Zero',
      nicheZeroSetting: 15,
      actualTimeS: 28,
      actualYieldG: 36,
      tasteProfile: 'balanced',
      targetTimeMinS: 25,
      targetTimeMaxS: 30,
      timestamp: '2026-01-02T00:00:00.000Z',
    },
    {
      grinderModel: 'Niche Zero',
      nicheZeroSetting: 15,
      actualTimeS: 27,
      actualYieldG: 36,
      tasteProfile: 'balanced',
      targetTimeMinS: 25,
      targetTimeMaxS: 30,
      timestamp: '2026-01-01T00:00:00.000Z',
    },
  ];
  const nicheHoldRec = calculateRecommendation(
    {
      grinderModel: 'Niche Zero',
      nicheZeroSetting: 15,
      wasPurged: true,
      actualTime: 8,
      actualYield: 36,
      tasteProfile: 'balanced',
    },
    recipe,
    nicheHistory
  );
  assert.equal(nicheHoldRec.outlierGrindHeld, true);
  assert.equal(nicheHoldRec.nicheLearningNote, null);
  const nicheHoldSummary = formatGrindRecommendationSummary(
    'Niche Zero',
    nicheHoldRec,
    null,
    { nicheZeroSetting: 15 }
  );
  assert.equal(
    countChannelingMentions(nicheHoldSummary, nicheHoldRec.warning, nicheHoldRec.nicheLearningNote),
    1
  );

  console.log('Grind recommendation display tests passed.');
}
