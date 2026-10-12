import assert from 'assert';
import {
  NICHE_ZERO_GRINDER_ID,
  NICHE_ZERO_DEFAULT_SETTING,
  parseNicheZeroSetting,
  formatNicheZeroSetting,
} from './nicheZero.js';
import {
  estimateSecondsPerMark,
  recommendNicheZeroFromEvidence,
  NICHE_LEARNING_MIN_OBSERVATIONS,
} from './nicheZeroLearning.js';
import {
  getGrinderDefinitionById,
  getRecommendationGrinderProfile,
  GRINDER_SETUP_OPTIONS,
  isNicheZeroGrinderModel,
  grinderSupportsQuantitativeRecommendations,
} from './grinderRegistry.js';
import {
  calculateRecommendation,
  getInitialGrindRecommendation,
  filterShotsForGrinderLearning,
  shotMatchesRecipeContext,
} from '../utils/grinderLogic.js';

const BASE_RECIPE = { targetTimeMinS: 27, targetTimeMaxS: 32, targetYieldG: 36, targetDoseG: 18 };
const BEAN = { id: 'b1', roastType: 'Medium', roastDate: '2026-09-01' };

function nicheShot(overrides = {}) {
  return {
    grinderModel: NICHE_ZERO_GRINDER_ID,
    beanId: 'b1',
    timestamp: '2026-09-20T12:00:00.000Z',
    actualDoseG: 18,
    actualYieldG: 36,
    actualTimeS: 30,
    nicheZeroSetting: 15,
    excludeFromLearning: false,
    ...overrides,
  };
}

export function runNicheZeroTests() {
  assert.equal(NICHE_ZERO_GRINDER_ID, 'Niche Zero');
  assert.equal(parseNicheZeroSetting('14.5'), 14.5);
  assert.equal(parseNicheZeroSetting(51), null);
  assert.equal(formatNicheZeroSetting(15), '15');

  const def = getGrinderDefinitionById(NICHE_ZERO_GRINDER_ID);
  assert.ok(def);
  assert.equal(def.controlType, 'nicheZero');
  assert.equal(def.supportsQuantitativeRecommendations, false);
  assert.equal(isNicheZeroGrinderModel(NICHE_ZERO_GRINDER_ID), true);
  assert.equal(GRINDER_SETUP_OPTIONS.some((o) => o.id === NICHE_ZERO_GRINDER_ID), true);

  assert.equal(getRecommendationGrinderProfile('Unknown Grinder').sensitivity, 4.5);
  assert.equal(getRecommendationGrinderProfile(NICHE_ZERO_GRINDER_ID).supportsQuantitativeRecommendations, false);
  assert.equal(grinderSupportsQuantitativeRecommendations(NICHE_ZERO_GRINDER_ID), false);

  const noHistory = getInitialGrindRecommendation(
    NICHE_ZERO_GRINDER_ID,
    'Medium',
    BEAN,
    [{ beanId: 'b1', ...BASE_RECIPE }],
    [],
    [BEAN],
    '2026-09-20T12:00:00.000Z'
  );
  assert.equal(noHistory.nicheZeroSetting, NICHE_ZERO_DEFAULT_SETTING);
  assert.equal(noHistory.initialSource, 'app-default');

  const recInsufficient = calculateRecommendation(
    {
      grinderModel: NICHE_ZERO_GRINDER_ID,
      nicheZeroSetting: 15,
      setteMacro: null,
      setteMicro: null,
      sunbeamSetting: null,
      wasPurged: true,
      actualTime: 24,
      actualDose: 18,
      actualYield: 36,
      tasteProfile: 'sour',
    },
    BASE_RECIPE,
    [nicheShot({ actualTimeS: 24, nicheZeroSetting: 15 })]
  );
  assert.equal(recInsufficient.nicheEvidenceMode, 'qualitative-fallback');
  assert.match(recInsufficient.reason, /comparable|numeric|Log more/i);

  const history = [
    nicheShot({ timestamp: '2026-09-18T12:00:00.000Z', nicheZeroSetting: 14, actualTimeS: 34 }),
    nicheShot({ timestamp: '2026-09-19T12:00:00.000Z', nicheZeroSetting: 15, actualTimeS: 30 }),
    nicheShot({ timestamp: '2026-09-20T11:00:00.000Z', nicheZeroSetting: 16, actualTimeS: 26 }),
  ];
  const recEmpirical = calculateRecommendation(
    {
      grinderModel: NICHE_ZERO_GRINDER_ID,
      nicheZeroSetting: 15,
      wasPurged: true,
      actualTime: 30,
      actualDose: 18,
      actualYield: 36,
      tasteProfile: 'sour',
    },
    BASE_RECIPE,
    history
  );
  assert.equal(recEmpirical.nicheEvidenceMode, 'empirical');
  assert.ok(recEmpirical.recommendedSetting.nicheZeroSetting < 15);
  assert.ok(recEmpirical.engineStats.shift < 0);
  assert.match(recEmpirical.reason, /Set dial to/);

  const contaminated = calculateRecommendation(
    {
      grinderModel: NICHE_ZERO_GRINDER_ID,
      nicheZeroSetting: 15,
      wasPurged: true,
      actualTime: 24,
      actualDose: 18,
      actualYield: 36,
      tasteProfile: 'sour',
    },
    BASE_RECIPE,
    [
      ...history,
      nicheShot({
        grinderModel: 'Sette 270Wi',
        setteMacro: 10,
        setteMicro: 'E',
        nicheZeroSetting: null,
        actualTimeS: 20,
      }),
    ]
  );
  assert.equal(contaminated.nicheEvidenceMode, 'empirical');

  const slopes = estimateSecondsPerMark([
    { dial: 14, timeS: 34, weight: 1 },
    { dial: 15, timeS: 30, weight: 1 },
    { dial: 16, timeS: 26, weight: 1 },
  ]);
  assert.ok(slopes.secondsPerMark < 0);

  const contradictory = estimateSecondsPerMark([
    { dial: 14, timeS: 26, weight: 1 },
    { dial: 15, timeS: 30, weight: 1 },
    { dial: 16, timeS: 26, weight: 1 },
  ]);
  assert.equal(contradictory.secondsPerMark, null);
  assert.equal(contradictory.contradictory, true);

  const recipeEdited = shotMatchesRecipeContext(
    { actualDoseG: 18, actualYieldG: 36, targetTimeMinS: 25, targetTimeMaxS: 30 },
    BASE_RECIPE,
    false
  );
  assert.equal(recipeEdited, false);

  const legacyTime = shotMatchesRecipeContext({ actualDoseG: 18, actualYieldG: 36 }, BASE_RECIPE, false);
  assert.equal(legacyTime, true);

  const filtered = filterShotsForGrinderLearning(
    [
      nicheShot(),
      { beanId: 'b1', grinderModel: 'Sette 270Wi', excludeFromLearning: false },
      { beanId: 'b2', grinderModel: NICHE_ZERO_GRINDER_ID, excludeFromLearning: false },
    ],
    { beanId: 'b1', grinderModel: NICHE_ZERO_GRINDER_ID }
  );
  assert.equal(filtered.length, 1);

  const setteRec = calculateRecommendation(
    {
      grinderModel: 'Sette 270Wi',
      setteMacro: 13,
      setteMicro: 'E',
      wasPurged: true,
      actualTime: 24,
      actualDose: 18,
      actualYield: 36,
      tasteProfile: 'sour',
    },
    BASE_RECIPE
  );
  assert.match(setteRec.reason, /FINER/i);

  const boundary = recommendNicheZeroFromEvidence({
    currentDial: 49,
    actualTime: 50,
    targetMin: 27,
    targetMax: 32,
    tasteProfile: 'bitter',
    severeChoke: false,
    isTimeInRange: false,
    comparableShots: history.map((s) => ({ ...s, actualTimeS: 50 })),
  });
  assert.equal(boundary.ok, false);

  console.log('Niche Zero tests passed.');
}
