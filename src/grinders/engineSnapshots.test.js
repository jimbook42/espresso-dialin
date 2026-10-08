import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  adjustSette,
  adjustSunbeam,
  calculateEffectiveBeanAge,
  calculateRecommendation,
  classifyShotOutcome,
  getAgeAdjustedRecommendation,
  getHistoricalRoastBaseline,
  getIdealFreezeWindow,
  getInitialGrindRecommendation,
  getRecommendationEvidenceContext,
  getShotEngineStats,
  numericToSette,
  setteToNumeric,
  shotEligibleForLearning,
  shotIsSevereChoke,
  shotMatchesRecipeContext,
  shotResultImproved,
} from '../utils/grinderLogic.js';
import {
  BASE_RECIPE,
  createSetteShot,
  createSunbeamShot,
  FLAIR_RECIPE,
  LEGACY_BEAN,
  LEGACY_RECIPE,
  LEGACY_SHOT,
  MOCK_NOW,
  recipeForBean,
  storedDialledShot,
  STOPPED_SHOT,
} from './fixtures.js';
import { verifyOrRecordSnapshotSuite } from './snapshotHarness.js';

const SETTE = 'Sette 270Wi';
const SUNBEAM = 'Sunbeam Barista Max';

function pinCalculateRecommendation(shotData, recipe, recentShots = [], flairEnabled = false) {
  const rec = calculateRecommendation(shotData, recipe, recentShots, flairEnabled);
  return {
    recommendedSetting: rec.recommendedSetting,
    reason: rec.reason,
    warning: rec.warning,
    subRecommendation: rec.subRecommendation,
    flairWaterTempAdvice: rec.flairWaterTempAdvice,
    evidenceContext: rec.evidenceContext,
    shotOutcome: rec.shotOutcome,
    engineStats: rec.engineStats,
  };
}

function buildAllCases() {
  const cases = {};
  const counts = {};

  const add = (group, id, value) => {
    const key = `${group}/${id}`;
    cases[key] = value;
    counts[group] = (counts[group] || 0) + 1;
  };

  // --- setteToNumeric / numericToSette / adjustSette / adjustSunbeam ---
  for (const macro of [1, 13, 31]) {
    for (const micro of ['A', 'E', 'I']) {
      add('setteToNumeric', `macro${macro}_micro${micro}`, setteToNumeric(macro, micro));
    }
  }
  add('setteToNumeric', 'invalid_micro_defaults_E', setteToNumeric(13, 'Z'));
  for (const num of [0, 4, 116, 278, 300, -5]) {
    add('numericToSette', `num_${num}`, numericToSette(num));
  }
  const setteShiftCases = [
    [1, 'A', -1],
    [1, 'A', 0],
    [31, 'I', 1],
    [13, 'E', 4],
    [13, 'E', -4],
    [13, 'E', 10],
    [13, 'E', -10],
  ];
  for (const [m, mic, sh] of setteShiftCases) {
    add('adjustSette', `${m}_${mic}_shift${sh}`, adjustSette(m, mic, sh));
  }
  for (const [cur, sh] of [[1, -5], [1, 0], [30, 5], [15, 3], [15, -20]]) {
    add('adjustSunbeam', `cur${cur}_shift${sh}`, adjustSunbeam(cur, sh));
  }

  // --- shotIsSevereChoke ---
  const chokeGrid = [
    [60, 10, true],
    [60, 18, true],
    [60, 36, false],
    [20, 10, false],
    [35, 10, true],
    [34, 10, false],
    [40, 30, false],
    [25, 17, false],
  ];
  for (const [t, y, exp] of chokeGrid) {
    add('shotIsSevereChoke', `t${t}_y${y}`, shotIsSevereChoke(t, y, 25, 30, 36));
    assert.equal(shotIsSevereChoke(t, y, 25, 30, 36), exp);
  }

  // --- shotEligibleForLearning ---
  add('shotEligibleForLearning', 'empty', shotEligibleForLearning({}));
  add('shotEligibleForLearning', 'false_flag', shotEligibleForLearning({ excludeFromLearning: false }));
  add('shotEligibleForLearning', 'true_flag', shotEligibleForLearning({ excludeFromLearning: true }));
  add('shotEligibleForLearning', 'legacy_shot', shotEligibleForLearning(LEGACY_SHOT));
  add('shotEligibleForLearning', 'stopped_shot', shotEligibleForLearning(STOPPED_SHOT));

  // --- classifyShotOutcome ---
  const tastes = ['sour', 'very_sour', 'bitter', 'very_bitter', 'good', 'balanced'];
  for (const taste of tastes) {
    add('classifyShotOutcome', `in_range_${taste}`, classifyShotOutcome(createSetteShot(27, taste), BASE_RECIPE));
    add('classifyShotOutcome', `fast_${taste}`, classifyShotOutcome(createSetteShot(20, taste), BASE_RECIPE));
  }
  add('classifyShotOutcome', 'in_range_under_yield', classifyShotOutcome(createSetteShot(28, 'good', 32), BASE_RECIPE));
  add('classifyShotOutcome', 'severe_choke', classifyShotOutcome(createSetteShot(60, 'sour', 10), BASE_RECIPE));
  add('classifyShotOutcome', 'legacy_shot', classifyShotOutcome(LEGACY_SHOT, LEGACY_RECIPE));

  // --- shotMatchesRecipeContext ---
  const doseYieldShot = { actualDoseG: 18, actualYieldG: 36, flairProfile: FLAIR_RECIPE.flairProfile };
  add('shotMatchesRecipeContext', 'match_plain', shotMatchesRecipeContext(doseYieldShot, BASE_RECIPE, false));
  add('shotMatchesRecipeContext', 'flair_off_ignores_profile', shotMatchesRecipeContext(doseYieldShot, FLAIR_RECIPE, false));
  add('shotMatchesRecipeContext', 'flair_on_match', shotMatchesRecipeContext(doseYieldShot, FLAIR_RECIPE, true));
  add(
    'shotMatchesRecipeContext',
    'flair_on_mismatch_peak',
    shotMatchesRecipeContext(
      { ...doseYieldShot, flairProfile: { ...FLAIR_RECIPE.flairProfile, peakPressure: '8' } },
      FLAIR_RECIPE,
      true
    )
  );
  add('shotMatchesRecipeContext', 'dose_mismatch', shotMatchesRecipeContext({ actualDoseG: 16, actualYieldG: 36 }, BASE_RECIPE, false));

  // --- getRecommendationEvidenceContext ---
  const histShot = (ts, taste = 'sour') => ({
    timestamp: ts,
    actualDoseG: 18,
    actualYieldG: 36,
    actualTimeS: 27,
    tasteProfile: taste,
    brewTemperatureC: 93,
  });
  add('getRecommendationEvidenceContext', 'none', getRecommendationEvidenceContext([], BASE_RECIPE, false));
  add(
    'getRecommendationEvidenceContext',
    'one',
    getRecommendationEvidenceContext([histShot('2026-09-10T00:00:00.000Z')], BASE_RECIPE, false)
  );
  add(
    'getRecommendationEvidenceContext',
    'three',
    getRecommendationEvidenceContext(
      [histShot('2026-09-11T00:00:00.000Z'), histShot('2026-09-10T00:00:00.000Z'), histShot('2026-09-09T00:00:00.000Z')],
      BASE_RECIPE,
      false
    )
  );
  add(
    'getRecommendationEvidenceContext',
    'excluded_ignored',
    getRecommendationEvidenceContext(
      [{ ...histShot('2026-09-10T00:00:00.000Z'), excludeFromLearning: true }, histShot('2026-09-09T00:00:00.000Z')],
      BASE_RECIPE,
      false
    )
  );

  // --- getIdealFreezeWindow ---
  for (const roast of ['Light', 'Medium', 'Dark', 'Other']) {
    add('getIdealFreezeWindow', roast, getIdealFreezeWindow(roast));
  }

  // --- calculateEffectiveBeanAge ---
  const ageBeans = {
    bag_fresh: { roastDate: '2026-09-18', storageType: 'bag', roastType: 'Medium' },
    bag_19d: { roastDate: '2026-09-01', storageType: 'bag', roastType: 'Medium' },
    vacuum_19d: { roastDate: '2026-09-01', storageType: 'vacuum', roastType: 'Medium' },
    frozen_no_freeze_date: { roastDate: '2026-09-01', storageType: 'frozen', roastType: 'Medium' },
    frozen_paused: {
      roastDate: '2026-06-01',
      storageType: 'frozen',
      freezeDate: '2026-06-15',
      roastType: 'Medium',
    },
    thawed_bag: {
      roastDate: '2026-06-01',
      storageType: 'frozen',
      freezeDate: '2026-06-15',
      thawDate: '2026-09-10',
      postThawStorage: 'bag',
      roastType: 'Medium',
    },
    thawed_vacuum: {
      roastDate: '2026-06-01',
      storageType: 'frozen',
      freezeDate: '2026-06-15',
      thawDate: '2026-09-10',
      postThawStorage: 'vacuum',
      roastType: 'Medium',
    },
    no_roast_date: {},
  };
  for (const [name, bean] of Object.entries(ageBeans)) {
    add('calculateEffectiveBeanAge', name, calculateEffectiveBeanAge(bean, MOCK_NOW));
  }

  // --- getHistoricalRoastBaseline ---
  const beanMed = { id: 'bm', roastType: 'Medium', roastDate: '2026-09-01', storageType: 'bag' };
  const beanDecaf = { ...beanMed, id: 'bd', isDecaf: true };
  const beans = [beanMed, beanDecaf];
  const recipes = beans.map(recipeForBean);
  const dialled = (beanId, macro, micro, ts, grinder = SETTE) =>
    storedDialledShot({ beanId, macro, micro, timestamp: ts, grinder });
  add('getHistoricalRoastBaseline', 'no_history', getHistoricalRoastBaseline(SETTE, 'Medium', recipes, [], beans));
  for (const roast of ['Light', 'Medium', 'Dark']) {
    const b = { id: `b-${roast}`, roastType: roast, roastDate: '2026-09-01', storageType: 'bag' };
    const r = [recipeForBean(b)];
    const shot = storedDialledShot({ beanId: b.id, macro: 12, micro: 'D', timestamp: '2026-09-15T00:00:00.000Z' });
    add(`getHistoricalRoastBaseline`, `roast_${roast}`, getHistoricalRoastBaseline(SETTE, roast, r, [shot], [b]));
  }
  const recencyShots = [
    dialled('bm', 10, 'A', '2026-09-10T00:00:00.000Z'),
    dialled('bm', 20, 'I', '2026-09-18T00:00:00.000Z'),
  ];
  add(
    'getHistoricalRoastBaseline',
    'recency_weighting',
    getHistoricalRoastBaseline(SETTE, 'Medium', recipes, recencyShots, [beanMed])
  );
  add(
    'getHistoricalRoastBaseline',
    'decaf_pool',
    getHistoricalRoastBaseline(SETTE, 'Medium', recipes, [dialled('bd', 14, 'F', '2026-09-18T00:00:00.000Z')], beans, 'decaf')
  );
  add(
    'getHistoricalRoastBaseline',
    'decaf_excluded_from_regular',
    getHistoricalRoastBaseline(SETTE, 'Medium', recipes, [dialled('bd', 14, 'F', '2026-09-18T00:00:00.000Z')], beans, 'regular')
  );
  add(
    'getHistoricalRoastBaseline',
    'not_dialled_in_null',
    getHistoricalRoastBaseline(
      SETTE,
      'Medium',
      recipes,
      [{ ...createSetteShot(27, 'sour'), beanId: 'bm', id: 'sour-only' }],
      [beanMed]
    )
  );
  add(
    'getHistoricalRoastBaseline',
    'sunbeam',
    getHistoricalRoastBaseline(SUNBEAM, 'Medium', recipes, [dialled('bm', 10, 'A', '2026-09-10T00:00:00.000Z', SUNBEAM)], [beanMed])
  );

  // --- getAgeAdjustedRecommendation ---
  const ageShotBase = storedDialledShot({ beanAgeDays: 19 });
  const bean19 = { roastDate: '2026-09-01', storageType: 'bag', roastType: 'Medium' };
  add('getAgeAdjustedRecommendation', 'same_age', getAgeAdjustedRecommendation(ageShotBase, bean19, MOCK_NOW));
  add(
    'getAgeAdjustedRecommendation',
    'fresher_by_5',
    getAgeAdjustedRecommendation({ ...ageShotBase, beanAgeDays: 24 }, bean19, MOCK_NOW)
  );
  add(
    'getAgeAdjustedRecommendation',
    'fresher_by_3',
    getAgeAdjustedRecommendation({ ...ageShotBase, beanAgeDays: 22 }, bean19, MOCK_NOW)
  );
  add(
    'getAgeAdjustedRecommendation',
    'older_by_12',
    getAgeAdjustedRecommendation({ ...ageShotBase, beanAgeDays: 7 }, bean19, MOCK_NOW)
  );
  add(
    'getAgeAdjustedRecommendation',
    'older_by_6',
    getAgeAdjustedRecommendation({ ...ageShotBase, beanAgeDays: 13 }, bean19, MOCK_NOW)
  );
  add('getAgeAdjustedRecommendation', 'no_recommendation', getAgeAdjustedRecommendation(LEGACY_SHOT, bean19, MOCK_NOW));
  add(
    'getAgeAdjustedRecommendation',
    'sunbeam_shift',
    getAgeAdjustedRecommendation(
      storedDialledShot({ grinder: SUNBEAM, setting: 15, beanAgeDays: 24 }),
      bean19,
      MOCK_NOW
    )
  );

  // --- getInitialGrindRecommendation ---
  const initBean = { id: 'init', roastType: 'Medium', roastDate: '2026-09-01', storageType: 'bag' };
  const initDecaf = { ...initBean, id: 'init-decaf', isDecaf: true };
  const initRecipes = [recipeForBean(initBean), recipeForBean(initDecaf)];
  add(
    'getInitialGrindRecommendation',
    'sette_no_history',
    getInitialGrindRecommendation(SETTE, 'Medium', initBean, initRecipes, [], [initBean], MOCK_NOW)
  );
  add(
    'getInitialGrindRecommendation',
    'decaf_no_history_matches_regular',
    getInitialGrindRecommendation(SETTE, 'Medium', initDecaf, initRecipes, [], [initBean, initDecaf], MOCK_NOW)
  );
  const regShot = dialled('init', 10, 'A', '2026-09-10T00:00:00.000Z');
  const decafShot = dialled('init-decaf', 15, 'F', '2026-09-11T00:00:00.000Z');
  add(
    'getInitialGrindRecommendation',
    'decaf_from_own_shot',
    getInitialGrindRecommendation(SETTE, 'Medium', initDecaf, initRecipes, [regShot, decafShot], [initBean, initDecaf], MOCK_NOW)
  );
  add(
    'getInitialGrindRecommendation',
    'regular_ignores_decaf_pool',
    getInitialGrindRecommendation(SETTE, 'Medium', initBean, initRecipes, [regShot, decafShot], [initBean, initDecaf], MOCK_NOW)
  );
  add(
    'getInitialGrindRecommendation',
    'grinder_switch_sette',
    getInitialGrindRecommendation(SETTE, 'Medium', initBean, initRecipes, [regShot], [initBean], MOCK_NOW)
  );
  add(
    'getInitialGrindRecommendation',
    'grinder_switch_sunbeam',
    getInitialGrindRecommendation(
      SUNBEAM,
      'Medium',
      initBean,
      initRecipes,
      [dialled('init', 10, 'A', '2026-09-10T00:00:00.000Z', SUNBEAM)],
      [initBean],
      MOCK_NOW
    )
  );
  add(
    'getInitialGrindRecommendation',
    'excluded_shot_ignored',
    getInitialGrindRecommendation(
      SETTE,
      'Medium',
      initBean,
      initRecipes,
      [{ ...decafShot, beanId: 'init', excludeFromLearning: true }],
      [initBean],
      MOCK_NOW
    )
  );

  // --- shotResultImproved ---
  const prevSlow = createSetteShot(35, 'sour');
  add(
    'shotResultImproved',
    'dialled_in',
    shotResultImproved(prevSlow, { actualTime: 28, actualYield: 36, tasteProfile: 'good' }, BASE_RECIPE)
  );
  add(
    'shotResultImproved',
    'worse_time',
    shotResultImproved(prevSlow, { actualTime: 41, actualYield: 36, tasteProfile: 'sour' }, BASE_RECIPE)
  );
  add('shotResultImproved', 'no_previous', shotResultImproved(null, { actualTime: 28, actualYield: 36, tasteProfile: 'good' }, BASE_RECIPE));

  // --- getShotEngineStats ---
  const withEngine = {
    ...LEGACY_SHOT,
    recommendation: pinCalculateRecommendation(createSetteShot(20, 'sour'), BASE_RECIPE, [], false),
  };
  add('getShotEngineStats', 'with_engine_stats', getShotEngineStats(withEngine, BASE_RECIPE));
  add('getShotEngineStats', 'legacy_no_rec', getShotEngineStats(LEGACY_SHOT, LEGACY_RECIPE));
  add('getShotEngineStats', 'legacy_no_grinder_model', getShotEngineStats({ ...LEGACY_SHOT, grinderModel: undefined }, LEGACY_RECIPE));
  add('getShotEngineStats', 'legacy_null_grinder', getShotEngineStats({ ...LEGACY_SHOT, grinderModel: null }, LEGACY_RECIPE));
  add('getShotEngineStats', 'legacy_empty_grinder', getShotEngineStats({ ...LEGACY_SHOT, grinderModel: '' }, LEGACY_RECIPE));
  add('getShotEngineStats', 'unknown_grinder', getShotEngineStats({ ...LEGACY_SHOT, grinderModel: 'Mystery' }, LEGACY_RECIPE));

  // --- calculateRecommendation matrix ---
  const runCalcSette = (shot, recipe = BASE_RECIPE, history = [], flair = false) =>
    pinCalculateRecommendation(shot, recipe, history, flair);
  const runCalcSunbeam = (shot, recipe = BASE_RECIPE, history = [], flair = false) =>
    pinCalculateRecommendation(shot, recipe, history, flair);

  const timeCases = [
    ['fast_near', 24, 'sour'],
    ['fast_far', 18, 'sour'],
    ['slow_near', 31, 'bitter'],
    ['slow_far', 38, 'bitter'],
    ['edge_min', 25, 'sour'],
    ['edge_max', 30, 'bitter'],
    ['midpoint', 27.5, 'sour'],
  ];
  for (const [label, time, taste] of timeCases) {
    add(`calculateRecommendation/sette`, label, runCalcSette(createSetteShot(time, taste)));
    add(`calculateRecommendation/sunbeam`, label, runCalcSunbeam(createSunbeamShot(time, taste)));
  }

  // rounding / min one-step (Sette sensitivity 1.25, midpoint 27.5)
  for (const time of [26.25, 26.75, 28.75]) {
    add(`calculateRecommendation/sette`, `rounding_t${String(time).replace('.', '_')}`, runCalcSette(createSetteShot(time, 'sour')));
  }

  const inRangeTastes = [
    ['sour', 'sour'],
    ['very_sour', 'very_sour'],
    ['bitter', 'bitter'],
    ['very_bitter', 'very_bitter'],
    ['balanced', 'balanced'],
    ['good', 'good'],
  ];
  for (const [label, taste] of inRangeTastes) {
    add(`calculateRecommendation/sette`, `in_range_${label}`, runCalcSette(createSetteShot(27, taste)));
    add(`calculateRecommendation/sunbeam`, `in_range_${label}`, runCalcSunbeam(createSunbeamShot(27, taste)));
  }

  add(`calculateRecommendation/sette`, 'severe_choke', runCalcSette(createSetteShot(60, 'sour', 10)));
  add(`calculateRecommendation/sunbeam`, 'severe_choke', runCalcSunbeam(createSunbeamShot(60, 'bitter', 10)));

  const yieldCases = [
    ['in_range_under', 28, 'good', 32],
    ['in_range_over', 28, 'good', 40],
    ['out_fast_under', 20, 'sour', 30],
    ['out_slow_under', 40, 'bitter', 30],
  ];
  for (const [label, time, taste, y] of yieldCases) {
    add(`calculateRecommendation/sette`, `yield_${label}`, runCalcSette(createSetteShot(time, taste, y)));
  }

  // Flair temp advice
  const sourHist = (ts) => ({
    ...createSetteShot(27, 'sour'),
    timestamp: ts,
    actualTimeS: 27,
    brewTemperatureC: 93,
  });
  const bitterHistFlair = (ts) => ({
    ...createSetteShot(27, 'bitter'),
    timestamp: ts,
    actualTimeS: 27,
    brewTemperatureC: 93,
  });
  add(
    `calculateRecommendation/sette`,
    'flair_three_sour',
    runCalcSette(createSetteShot(27, 'sour'), FLAIR_RECIPE, [sourHist('2026-09-09T00:00:00.000Z'), sourHist('2026-09-10T00:00:00.000Z')], true)
  );
  add(
    `calculateRecommendation/sette`,
    'flair_three_bitter',
    runCalcSette(
      createSetteShot(27, 'bitter'),
      FLAIR_RECIPE,
      [bitterHistFlair('2026-09-09T00:00:00.000Z'), bitterHistFlair('2026-09-10T00:00:00.000Z')],
      true
    )
  );
  add(
    `calculateRecommendation/sette`,
    'flair_mixed_history',
    runCalcSette(
      createSetteShot(27, 'sour'),
      FLAIR_RECIPE,
      [sourHist('2026-09-09T00:00:00.000Z'), { ...sourHist('2026-09-10T00:00:00.000Z'), tasteProfile: 'bitter' }],
      true
    )
  );
  add(
    `calculateRecommendation/sette`,
    'flair_off_no_advice',
    runCalcSette(createSetteShot(27, 'sour'), FLAIR_RECIPE, [sourHist('2026-09-09T00:00:00.000Z'), sourHist('2026-09-10T00:00:00.000Z')], false)
  );

  // unpurged / recommendation not followed
  const prev = createSetteShot(35, 'sour', 36, { setteMacro: 14, setteMicro: 'E' });
  add(
    `calculateRecommendation/sette`,
    'unpurged_warning',
    runCalcSette(
      { ...createSetteShot(27, 'sour'), setteMacro: 14, setteMicro: 'F', wasPurged: false, lastShotGrind: { setteMacro: 13, setteMicro: 'E' } },
      BASE_RECIPE
    )
  );
  add(
    `calculateRecommendation/sette`,
    'not_followed_improved',
    runCalcSette(createSetteShot(29, 'good'), BASE_RECIPE, [prev], false)
  );
  add(
    `calculateRecommendation/sette`,
    'not_followed_worse',
    runCalcSette(
      { ...createSetteShot(41, 'sour'), recommendationFollowed: false, previousShot: prev },
      BASE_RECIPE,
      [prev],
      false
    )
  );

  // grinder model legacy / unknown (Sunbeam code path in calculateRecommendation)
  for (const gm of [undefined, null, '', 'Unknown Grinder']) {
    const label = gm === undefined ? 'undefined' : gm === null ? 'null' : gm === '' ? 'empty' : 'unknown_string';
    const shot = {
      ...createSunbeamShot(27, 'sour'),
      grinderModel: gm,
      sunbeamSetting: 15,
      setteMacro: 13,
      setteMicro: 'E',
    };
    add(`calculateRecommendation/legacy_grinder`, label, runCalcSette(shot, BASE_RECIPE));
    add(`getShotEngineStats/legacy_grinder`, label, getShotEngineStats({ ...LEGACY_SHOT, grinderModel: gm }, BASE_RECIPE));
  }

  // subRecommendation ratio advisory
  const bitterHist = [
    { actualTimeS: 27, tasteProfile: 'bitter', timestamp: '2026-09-09T00:00:00.000Z' },
  ];
  add(
    `calculateRecommendation/sette`,
    'ratio_advisory_bitter',
    runCalcSette(createSetteShot(27, 'bitter'), BASE_RECIPE, bitterHist)
  );

  return { cases, counts };
}

export function runEngineSnapshotTests() {
  const originalNow = Date.now;
  const fixedNow = new Date(MOCK_NOW).getTime();
  Date.now = () => fixedNow;

  try {
    const { cases, counts } = buildAllCases();
    const result = verifyOrRecordSnapshotSuite(cases);
    if (result.mode === 'record') {
      console.log(`Engine snapshots RECORDED (${result.caseCount} cases)`);
    } else {
      console.log(`Engine snapshots verified (${result.caseCount} cases)`);
    }
    return counts;
  } finally {
    Date.now = originalNow;
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  runEngineSnapshotTests();
  console.log('Engine snapshot tests passed.');
}
