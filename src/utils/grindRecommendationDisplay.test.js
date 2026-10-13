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

  const nicheKeep = formatGrindRecommendationSummary('Niche Zero', {
    recommendedSetting: { nicheZeroSetting: 15 },
    reason: 'KEEP GRIND — Balanced and in range.',
  });
  assert.match(nicheKeep, /Keep the same grind/i);
  assert.doesNotMatch(nicheKeep, /far off that pattern/i);
  assert.doesNotMatch(nicheKeep, /keeping your current dial/i);

  const nicheInRangeContradictory = formatGrindRecommendationSummary('Niche Zero', {
    recommendedSetting: { nicheZeroSetting: 15 },
    reason: 'KEEP GRIND — Balanced and in range.',
    nicheLearningNote: null,
  });
  assert.match(nicheInRangeContradictory, /Keep the same grind/i);
  assert.doesNotMatch(nicheInRangeContradictory, /pattern is clearer/i);

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
  const moveSummary = formatGrindRecommendationSummary('Sette 270Wi', moveRec);
  assert.doesNotMatch(moveSummary, /Grind setting held/i);
  assert.match(moveSummary, /Grind coarser/i);

  const fastRec = calculateRecommendation(
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
  assert.equal(fastRec.outlierGrindHeld, false);
  assert.ok(Math.abs(fastRec.engineStats.shift) >= 2, '8s outlier should move grind ~2-3 units');
  const fastSummary = formatGrindRecommendationSummary('Sette 270Wi', fastRec);
  assert.doesNotMatch(fastSummary, /Grind setting held/i);
  assert.match(fastSummary, /Grind finer/i);
  assert.ok(
    (fastRec.warning || '').includes(KNOWN_ISSUE_OUTLIER_HINT),
    'known-issue hint stays on the card warning, not in place of direction'
  );

  const nicheInRangeRec = calculateRecommendation(
    {
      grinderModel: 'Niche Zero',
      nicheZeroSetting: 15,
      wasPurged: true,
      actualTime: 28,
      actualYield: 36,
      tasteProfile: 'balanced',
    },
    recipe,
    [
      {
        grinderModel: 'Niche Zero',
        nicheZeroSetting: 14.5,
        actualTimeS: 35,
        actualYieldG: 36,
        tasteProfile: 'balanced',
        targetTimeMinS: 25,
        targetTimeMaxS: 30,
        timestamp: '2026-01-03T00:00:00.000Z',
      },
      {
        grinderModel: 'Niche Zero',
        nicheZeroSetting: 15.5,
        actualTimeS: 22,
        actualYieldG: 36,
        tasteProfile: 'balanced',
        targetTimeMinS: 25,
        targetTimeMaxS: 30,
        timestamp: '2026-01-02T00:00:00.000Z',
      },
    ]
  );
  const nicheInRangeSummary = formatGrindRecommendationSummary('Niche Zero', nicheInRangeRec);
  assert.match(nicheInRangeSummary, /Keep the same grind/i);
  assert.doesNotMatch(nicheInRangeSummary, /far off that pattern/i);
  assert.doesNotMatch(nicheInRangeSummary, /pattern is clearer/i);

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
  const nicheMoveRec = calculateRecommendation(
    {
      grinderModel: 'Niche Zero',
      nicheZeroSetting: 15,
      wasPurged: true,
      actualTime: 12,
      actualYield: 36,
      tasteProfile: 'balanced',
    },
    recipe,
    nicheHistory
  );
  assert.equal(nicheMoveRec.outlierGrindHeld, false);
  assert.ok(Math.abs(nicheMoveRec.engineStats.shift) > 0, 'Niche 12s after stable history should move grind');

  const nicheMoveRecDial = calculateRecommendation(
    {
      grinderModel: 'Niche Zero',
      nicheZeroSetting: 12,
      wasPurged: true,
      actualTime: 8,
      actualYield: 36,
      tasteProfile: 'balanced',
    },
    recipe,
    nicheHistory
  );
  assert.equal(nicheMoveRecDial.grindSettingHeld, false);
  assert.notEqual(nicheMoveRecDial.engineStats.shift, 0);
  const nicheMoveAfterApply = formatGrindRecommendationSummary('Niche Zero', nicheMoveRecDial);
  assert.doesNotMatch(nicheMoveAfterApply, /Grind setting held/i);
  assert.match(nicheMoveAfterApply, /Grind finer/i);

  console.log('Grind recommendation display tests passed.');
}
