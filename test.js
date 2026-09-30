import 'fake-indexeddb/auto';
import {
  beanIsDecaf,
  calculateEffectiveBeanAge,
  calculateRecommendation,
  classifyShotOutcome,
  db,
  decafContextNote,
  getAgeAdjustedRecommendation,
  getHistoricalRoastBaseline,
  getInitialGrindRecommendation,
  KNOWN_ISSUE_REASONS,
  knownIssueReasonLabel,
  recipeContextForShot,
  setteToNumeric,
  shotEligibleForLearning,
  shotIsSevereChoke,
  shotMatchesRecipeContext,
  shotResultImproved,
} from './src/utils/grinderLogic.js';
import { runBrewGuideTests } from './src/brewGuide/steps.test.js';
import { runBrewGuidanceTests } from './src/brewGuide/guidance.test.js';
import assert from 'assert';

async function runTests() {
  const recipe = {
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
    targetDoseG: 18,
    targetYieldG: 36,
    brewTemperatureC: 93,
    flairProfile: { preinfusionPressure: '2', peakPressure: '9', taperPressure: '6' },
  };

  const createShot = (time, taste, yieldG = 36, temp = 93, extra = {}) => ({
    grinderModel: 'Sette 270Wi',
    setteMacro: 13,
    setteMicro: 'E',
    actualTime: time,
    actualTimeS: time,
    actualDose: 18,
    actualDoseG: 18,
    actualYield: yieldG,
    actualYieldG: yieldG,
    tasteProfile: taste,
    brewTemperatureC: temp,
    flairProfile: { preinfusionPressure: '2', peakPressure: '9', taperPressure: '6' },
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
    timestamp: new Date().toISOString(),
    ...extra,
  });

  const runCalc = (current, history = [], extra = {}) =>
    calculateRecommendation({ ...current, grinderModel: 'Sette 270Wi', setteMacro: 13, setteMicro: 'E', wasPurged: true, actualDose: 18, ...extra }, recipe, history, true);

  // fast shot
  let rec = runCalc(createShot(20, 'sour'));
  assert.match(rec.reason, /GO \d MICRO STEP\(S\) FINER/);

  // slow shot
  rec = runCalc(createShot(35, 'bitter'));
  assert.match(rec.reason, /GO \d MICRO STEP\(S\) COARSER/);

  // in-range sour shot
  rec = runCalc(createShot(27, 'sour'));
  assert.match(rec.reason, /GO 1 STEP FINER/);
  assert(!rec.flairWaterTempAdvice);
  assert.equal(rec.shotOutcome.statusLabel, 'IN RANGE');

  // dialled in
  const dialled = classifyShotOutcome(createShot(28, 'good'), recipe);
  assert.equal(dialled.isDialledIn, true);
  assert.equal(dialled.statusLabel, 'DIALLED IN');

  // in-range sour is not dialled in
  const inRangeSour = classifyShotOutcome(createShot(29, 'sour'), recipe);
  assert.equal(inRangeSour.isDialledIn, false);
  assert.equal(inRangeSour.statusLabel, 'IN RANGE');

  // three qualifying sour shots (time in range, not dialled in)
  rec = runCalc(createShot(27, 'sour'), [createShot(27, 'sour'), createShot(28, 'very_sour')]);
  assert.match(rec.flairWaterTempAdvice, /increasing Flair temperature/);

  // three qualifying bitter shots
  rec = runCalc(createShot(27, 'bitter'), [createShot(27, 'bitter'), createShot(28, 'very_bitter')]);
  assert.match(rec.flairWaterTempAdvice, /decreasing Flair temperature/);

  // mixed history (sour, bitter, sour)
  rec = runCalc(createShot(27, 'sour'), [createShot(27, 'bitter'), createShot(28, 'sour')]);
  assert(!rec.flairWaterTempAdvice);

  // non-dialled-in fast sour shots don't count toward temp
  rec = runCalc(createShot(27, 'sour'), [createShot(27, 'sour'), createShot(20, 'sour')]);
  assert(!rec.flairWaterTempAdvice);

  // recommendation not followed but improved — no punitive warning
  const prev = createShot(35, 'sour', 36, 93, { setteMacro: 14, setteMicro: 'E' });
  rec = runCalc(createShot(29, 'good'), [prev], {
    actualTime: 29,
    actualYield: 36,
    tasteProfile: 'good',
    recommendationFollowed: false,
    previousShot: prev,
  });
  assert(!rec.warning || !/did not clearly improve/.test(rec.warning));

  // recommendation not followed and worse — warning
  rec = runCalc(createShot(41, 'sour'), [prev], {
    actualTime: 41,
    tasteProfile: 'sour',
    recommendationFollowed: false,
    previousShot: prev,
  });
  assert.match(rec.warning, /did not clearly improve/);

  // historical baseline learns from dialled-in shots even when recommendation not followed
  const beans = [{ id: 'b1', roastType: 'Medium' }];
  const recipes = [{ beanId: 'b1', targetTimeMinS: 25, targetTimeMaxS: 30, targetDoseG: 18, targetYieldG: 36 }];
  const shots = [
    createShot(28, 'good', 36, 93, {
      beanId: 'b1',
      recommendationFollowed: false,
      setteMacro: 12,
      setteMicro: 'D',
    }),
  ];
  const baseline = getHistoricalRoastBaseline('Sette 270Wi', 'Medium', recipes, shots, beans);
  assert.ok(baseline !== null);

  assert.ok(
    shotResultImproved(createShot(35, 'sour'), { actualTime: 29, actualYield: 36, tasteProfile: 'good' }, recipe)
  );

  runBrewGuideTests();
  runBrewGuidanceTests();
  runDecafRegressionTests();
  runKnownIssueLearningTests();
  runSevereDeviationTests();
  await runDecafPersistenceTests();
  await runKnownIssuePersistenceTests();
  await runLegacyShotDataTests();
  console.log('All tests passed!');
}

function runKnownIssueLearningTests() {
  const recipe = {
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
    targetDoseG: 18,
    targetYieldG: 36,
    brewTemperatureC: 93,
  };
  const mockDate = '2026-09-20T12:00:00.000Z';
  const bean = { id: 'b1', roastType: 'Medium', roastDate: '2026-09-01', storageType: 'bag' };
  const recipes = [{ beanId: 'b1', ...recipe }];
  const stableBeanAge = calculateEffectiveBeanAge(bean, mockDate).daysOld;

  const dialledShot = (macro, micro, timestamp, extra = {}) => ({
    id: `shot-${timestamp}`,
    beanId: 'b1',
    grinderModel: 'Sette 270Wi',
    setteMacro: macro,
    setteMicro: micro,
    actualTimeS: 28,
    actualYieldG: 36,
    actualDoseG: 18,
    tasteProfile: 'good',
    timestamp,
    recommendation: {
      recommendedSetting: { macro, micro },
      reason: 'KEEP GRIND — Balanced and in range.',
    },
    beanAgeDays: stableBeanAge,
    ...extra,
  });

  assert.equal(shotEligibleForLearning({}), true);
  assert.equal(shotEligibleForLearning({ excludeFromLearning: false }), true);
  assert.equal(shotEligibleForLearning({ excludeFromLearning: true }), false);

  const shotA = dialledShot(10, 'A', '2026-09-10T10:00:00.000Z');
  const shotB = dialledShot(15, 'F', '2026-09-11T10:00:00.000Z', {
    excludeFromLearning: true,
    knownIssueReason: 'puck_prep',
    recommendation: {
      recommendedSetting: { macro: 14, micro: 'A' },
      reason: 'GO 1 STEP COARSER — Shot is in range but tastes bitter.',
    },
  });

  const initArgs = ['Sette 270Wi', 'Medium', bean, recipes];
  const fromNoShots = getInitialGrindRecommendation(...initArgs, [], [bean], mockDate);
  const fromExcludedOnly = getInitialGrindRecommendation(...initArgs, [shotB], [bean], mockDate);
  const fromValid = getInitialGrindRecommendation(...initArgs, [shotA, shotB], [bean], mockDate);
  assert.deepEqual(fromExcludedOnly, fromNoShots);
  assert.notDeepEqual(fromExcludedOnly, { macro: 15, micro: 'F' });
  assert.deepEqual(fromValid, { macro: 10, micro: 'A' });

  const baselineWithExcluded = getHistoricalRoastBaseline('Sette 270Wi', 'Medium', recipes, [shotA, shotB], [bean]);
  const baselineValidOnly = getHistoricalRoastBaseline('Sette 270Wi', 'Medium', recipes, [shotA], [bean]);
  assert.deepEqual(baselineWithExcluded, baselineValidOnly);

  const historyForC = [shotA, shotB];
  const recAfterExcluded = calculateRecommendation(
    {
      grinderModel: 'Sette 270Wi',
      setteMacro: 10,
      setteMicro: 'A',
      wasPurged: true,
      actualTime: 20,
      actualYield: 36,
      actualDose: 18,
      tasteProfile: 'sour',
      previousShot: shotA,
    },
    recipe,
    historyForC,
    false
  );
  const recFromValidOnly = calculateRecommendation(
    {
      grinderModel: 'Sette 270Wi',
      setteMacro: 10,
      setteMicro: 'A',
      wasPurged: true,
      actualTime: 20,
      actualYield: 36,
      actualDose: 18,
      tasteProfile: 'sour',
      previousShot: shotA,
    },
    recipe,
    [shotA],
    false
  );
  assert.deepEqual(recAfterExcluded.recommendedSetting, recFromValidOnly.recommendedSetting);

  const sourInRange = (timestamp) => ({
    grinderModel: 'Sette 270Wi',
    actualTimeS: 27,
    actualYieldG: 36,
    actualDoseG: 18,
    tasteProfile: 'sour',
    brewTemperatureC: 93,
    timestamp,
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
  });
  const withExcludedHistory = calculateRecommendation(
    {
      grinderModel: 'Sette 270Wi',
      setteMacro: 13,
      setteMicro: 'E',
      wasPurged: true,
      actualTime: 27,
      actualYield: 36,
      actualDose: 18,
      tasteProfile: 'sour',
    },
    { ...recipe, flairProfile: { preinfusionPressure: '2', peakPressure: '9', taperPressure: '6' } },
    [
      sourInRange('2026-09-09T00:00:00.000Z'),
      { ...sourInRange('2026-09-10T00:00:00.000Z'), excludeFromLearning: true },
      sourInRange('2026-09-11T00:00:00.000Z'),
    ],
    true
  );
  const withoutExcluded = calculateRecommendation(
    {
      grinderModel: 'Sette 270Wi',
      setteMacro: 13,
      setteMicro: 'E',
      wasPurged: true,
      actualTime: 27,
      actualYield: 36,
      actualDose: 18,
      tasteProfile: 'sour',
    },
    { ...recipe, flairProfile: { preinfusionPressure: '2', peakPressure: '9', taperPressure: '6' } },
    [sourInRange('2026-09-09T00:00:00.000Z'), sourInRange('2026-09-11T00:00:00.000Z')],
    true
  );
  assert.equal(withExcludedHistory.flairWaterTempAdvice, withoutExcluded.flairWaterTempAdvice);

  const reIncluded = getInitialGrindRecommendation(
    ...initArgs,
    [{ ...shotB, excludeFromLearning: false }],
    [bean],
    mockDate
  );
  assert.deepEqual(reIncluded, { macro: 14, micro: 'A' });

  const { recommendation: _dropRec, ...shotBGrindOnly } = shotB;
  const reIncludedGrind = getInitialGrindRecommendation(
    ...initArgs,
    [{ ...shotBGrindOnly, excludeFromLearning: false }],
    [bean],
    mockDate
  );
  assert.deepEqual(reIncludedGrind, { macro: 15, micro: 'F' });
}

async function runKnownIssuePersistenceTests() {
  await db.open();
  await db.transaction('rw', db.beans, db.recipes, db.shots, async () => {
    await db.beans.clear();
    await db.recipes.clear();
    await db.shots.clear();
  });

  const beanId = 'persist-bean';
  await db.beans.add({
    id: beanId,
    name: 'Persist',
    roaster: 'Local',
    roastType: 'Medium',
    roastDate: '2026-01-01',
    storageType: 'bag',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  await db.recipes.add({
    id: 'persist-recipe',
    beanId,
    targetDoseG: 18,
    targetYieldG: 36,
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
  });

  const legacyShot = {
    id: 'legacy-learning-shot',
    beanId,
    timestamp: '2026-01-02T00:00:00.000Z',
    grinderModel: 'Sette 270Wi',
    setteMacro: 13,
    setteMicro: 'E',
    actualTimeS: 28,
    actualYieldG: 36,
    actualDoseG: 18,
    tasteProfile: 'good',
  };
  await db.shots.add(legacyShot);
  const loadedLegacy = await db.shots.get('legacy-learning-shot');
  assert.equal(shotEligibleForLearning(loadedLegacy), true);
  assert.equal(Object.hasOwn(loadedLegacy, 'excludeFromLearning'), false);

  await db.shots.add({
    id: 'excluded-shot',
    beanId,
    timestamp: '2026-01-03T00:00:00.000Z',
    grinderModel: 'Sette 270Wi',
    setteMacro: 14,
    setteMicro: 'A',
    actualTimeS: 22,
    actualYieldG: 30,
    actualDoseG: 18,
    tasteProfile: 'sour',
    excludeFromLearning: true,
    knownIssueReason: 'overheated',
  });
  const excluded = await db.shots.get('excluded-shot');
  assert.equal(excluded.excludeFromLearning, true);
  assert.equal(excluded.knownIssueReason, 'overheated');

  await db.shots.update('excluded-shot', { excludeFromLearning: false, knownIssueReason: undefined });
  assert.equal(shotEligibleForLearning(await db.shots.get('excluded-shot')), true);

  assert.equal(db.verno, 17);
  db.close();
}

/** Pre-feature roast baseline: every dialled-in shot of the roast, including ones later marked decaf. */
function preFeatureHistoricalRoastBaseline(grinderModel, roastType, recipes = [], allShots = [], beans = []) {
  const successfulShots = allShots.filter(s => {
    if (s.grinderModel !== grinderModel) return false;
    const bean = beans.find(b => b.id === s.beanId);
    if (!bean || bean.roastType !== roastType) return false;
    const recipe = recipes.find(r => r.beanId === s.beanId);
    if (!recipe) return false;
    const ctx = recipeContextForShot(s, recipe);
    return classifyShotOutcome(s, ctx).isDialledIn;
  }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (successfulShots.length === 0) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  successfulShots.forEach((s, idx) => {
    const weight = Math.pow(0.7, idx);
    const num = grinderModel === 'Sette 270Wi' ? setteToNumeric(s.setteMacro, s.setteMicro) : s.sunbeamSetting;
    weightedSum += num * weight;
    totalWeight += weight;
  });
  return Math.round(weightedSum / totalWeight);
}

/** Pre-feature initial grind. Same shot-feedback and age math, with the unsplit roast baseline. */
function preFeatureInitialGrind(grinderModel, roastType, activeBean, recipes = [], allShots = [], beans = [], mockDateOverride = null) {
  const beanShots = allShots.filter(s => s.beanId === activeBean?.id && s.grinderModel === grinderModel);
  const currentRecipe = recipes.find(r => r.beanId === activeBean?.id) || {};

  let bestShot = null;
  if (beanShots.length > 0) {
    const sortedBeanShots = [...beanShots].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const sameRecipeShots = sortedBeanShots.filter((s) => shotMatchesRecipeContext(s, currentRecipe, Boolean(currentRecipe.flairProfile)));
    const dialledInRecipeShots = sameRecipeShots.filter((s) =>
      classifyShotOutcome(s, recipeContextForShot(s, currentRecipe)).isDialledIn
    );
    if (dialledInRecipeShots.length > 0) bestShot = dialledInRecipeShots[0];
    else if (sameRecipeShots.length > 0) bestShot = sameRecipeShots[0];
    else bestShot = sortedBeanShots[0];
  }

  if (bestShot) {
    const adjustedRec = getAgeAdjustedRecommendation(bestShot, activeBean, mockDateOverride);
    if (adjustedRec && adjustedRec.recommendedSetting) {
      if (grinderModel === 'Sette 270Wi') {
        return { macro: adjustedRec.recommendedSetting.macro, micro: adjustedRec.recommendedSetting.micro };
      }
      return { setting: adjustedRec.recommendedSetting.setting };
    }
    if (grinderModel === 'Sette 270Wi') {
      return { macro: bestShot.setteMacro || 13, micro: bestShot.setteMicro || 'E' };
    }
    return { setting: bestShot.sunbeamSetting || 15 };
  }

  const ageData = calculateEffectiveBeanAge(activeBean, mockDateOverride);
  const baseline = preFeatureHistoricalRoastBaseline(grinderModel, roastType, recipes, allShots, beans);
  if (grinderModel === 'Sette 270Wi') {
    const baseNumeric = baseline !== null ? baseline : (roastType === 'Light' ? 15 * 9 + 2 : roastType === 'Dark' ? 12 * 9 + 5 : 13 * 9 + 4);
    const numeric = baseNumeric + ageData.recommendedOffsetSette;
    const clamped = Math.min(Math.max(Math.round(numeric), 0), (31 - 1) * 9 + 8);
    const micros = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    return { macro: Math.floor(clamped / 9) + 1, micro: micros[clamped % 9] };
  }
  const baseSetting = baseline !== null ? baseline : (roastType === 'Light' ? 17 : roastType === 'Dark' ? 13 : 15);
  return { setting: Math.min(Math.max(baseSetting + ageData.recommendedOffsetSunbeam, 1), 30) };
}

function runDecafRegressionTests() {
  const mockDate = '2026-09-20T12:00:00.000Z';
  const roastDate = '2026-09-01';
  const recipeFor = (beanId) => ({
    beanId,
    targetDoseG: 18,
    targetYieldG: 36,
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
  });

  const legacyBean = { id: 'legacy', roastType: 'Medium', roastDate, storageType: 'bag' };
  const regularBean = { ...legacyBean, id: 'regular', isDecaf: false };
  const decafBean = { ...legacyBean, id: 'decaf', isDecaf: true };
  const freshDecaf = { ...decafBean, id: 'fresh-decaf', roastDate: '2026-09-20' };
  const oldDecaf = { ...decafBean, id: 'old-decaf', roastDate: '2026-07-12' };

  assert.equal(beanIsDecaf(undefined), false);
  assert.equal(beanIsDecaf(legacyBean), false);
  assert.equal(beanIsDecaf(regularBean), false);
  assert.equal(beanIsDecaf({ isDecaf: 'true' }), false);
  assert.equal(beanIsDecaf(decafBean), true);
  assert.equal(decafContextNote(legacyBean), null);
  assert.equal(decafContextNote(regularBean, 'shots'), null);
  assert.match(decafContextNote(decafBean, 'roast-baseline'), /regular-coffee dial-ins/);
  assert.match(decafContextNote(decafBean, 'shots'), /logged shots/);
  assert.match(decafContextNote(decafBean, 'decaf-history'), /previous decaf shots/);
  assert.doesNotMatch(decafContextNote(decafBean, 'shots'), /always|fines|coarser|3–5|12–14/i);

  for (const bean of [legacyBean, regularBean, decafBean, freshDecaf, oldDecaf]) {
    const counterpart = { ...bean, isDecaf: bean.isDecaf === true ? undefined : false };
    assert.deepEqual(
      calculateEffectiveBeanAge(bean, mockDate),
      calculateEffectiveBeanAge({ ...bean, isDecaf: undefined }, mockDate)
    );
    assert.deepEqual(
      calculateEffectiveBeanAge(bean, mockDate),
      calculateEffectiveBeanAge({ ...counterpart, id: bean.id, isDecaf: false }, mockDate)
    );
  }

  const nonDecafCases = [
    ['legacy sette', 'Sette 270Wi', legacyBean, [], []],
    ['regular sette', 'Sette 270Wi', regularBean, [], []],
    ['legacy sunbeam', 'Sunbeam Barista Max', legacyBean, [], []],
    ['regular fresh', 'Sette 270Wi', { ...regularBean, roastDate: '2026-09-20' }, [], []],
    ['legacy old', 'Sunbeam Barista Max', { ...legacyBean, roastDate: '2026-07-12' }, [], []],
  ];

  for (const [label, grinder, bean, shots, extraBeans] of nonDecafCases) {
    const beans = [bean, ...extraBeans];
    const recipes = beans.map(b => recipeFor(b.id));
    const live = getInitialGrindRecommendation(grinder, bean.roastType, bean, recipes, shots, beans, mockDate);
    const previous = preFeatureInitialGrind(grinder, bean.roastType, bean, recipes, shots, beans, mockDate);
    assert.deepEqual(live, previous, label);
  }

  // With no learned history, decaf uses the same roast-class default as regular coffee.
  const noHistoryBeans = [legacyBean, regularBean, decafBean];
  const noHistoryRecipes = noHistoryBeans.map(b => recipeFor(b.id));
  const regularStart = getInitialGrindRecommendation('Sette 270Wi', 'Medium', regularBean, noHistoryRecipes, [], noHistoryBeans, mockDate);
  const legacyStart = getInitialGrindRecommendation('Sette 270Wi', 'Medium', legacyBean, noHistoryRecipes, [], noHistoryBeans, mockDate);
  const decafStart = getInitialGrindRecommendation('Sette 270Wi', 'Medium', decafBean, noHistoryRecipes, [], noHistoryBeans, mockDate);
  assert.deepEqual(decafStart, regularStart);
  assert.deepEqual(decafStart, legacyStart);
  assert.deepEqual(decafStart, preFeatureInitialGrind('Sette 270Wi', 'Medium', decafBean, noHistoryRecipes, [], noHistoryBeans, mockDate));

  const dialled = (beanId, macro, micro, setting, timestamp, grinder = 'Sette 270Wi') => ({
    id: `${beanId}-${timestamp}`,
    beanId,
    grinderModel: grinder,
    setteMacro: macro,
    setteMicro: micro,
    sunbeamSetting: setting,
    actualTimeS: 28,
    actualYieldG: 36,
    actualDoseG: 18,
    tasteProfile: 'good',
    timestamp,
  });

  const historyBeans = [
    { id: 'reg-shot', roastType: 'Medium', roastDate, storageType: 'bag', isDecaf: false },
    { id: 'decaf-shot', roastType: 'Medium', roastDate, storageType: 'bag', isDecaf: true },
    { id: 'new-regular', roastType: 'Medium', roastDate, storageType: 'bag' },
    { id: 'new-decaf', roastType: 'Medium', roastDate, storageType: 'bag', isDecaf: true },
  ];
  const historyRecipes = historyBeans.map(b => recipeFor(b.id));
  const historyShots = [
    dialled('reg-shot', 10, 'A', 15, '2026-09-10T00:00:00.000Z'),
    dialled('decaf-shot', 15, 'A', 20, '2026-09-18T00:00:00.000Z'),
  ];

  const newRegular = historyBeans.find(b => b.id === 'new-regular');
  const newDecaf = historyBeans.find(b => b.id === 'new-decaf');
  const liveRegular = getInitialGrindRecommendation('Sette 270Wi', 'Medium', newRegular, historyRecipes, historyShots, historyBeans, mockDate);
  const preRegular = preFeatureInitialGrind('Sette 270Wi', 'Medium', newRegular, historyRecipes, historyShots, historyBeans, mockDate);
  assert.deepEqual(liveRegular, { macro: 10, micro: 'A' });
  assert.notDeepEqual(liveRegular, preRegular);

  const regularOnlyBeans = historyBeans.filter(b => b.id !== 'decaf-shot');
  const regularOnlyShots = historyShots.filter(s => s.beanId !== 'decaf-shot');
  const regularOnlyRecipes = historyRecipes.filter(r => r.beanId !== 'decaf-shot');
  assert.deepEqual(
    liveRegular,
    preFeatureInitialGrind('Sette 270Wi', 'Medium', newRegular, regularOnlyRecipes, regularOnlyShots, regularOnlyBeans, mockDate)
  );

  const liveDecafStart = getInitialGrindRecommendation('Sette 270Wi', 'Medium', newDecaf, historyRecipes, historyShots, historyBeans, mockDate);
  assert.deepEqual(liveDecafStart, { macro: 15, micro: 'A' });
  assert.equal(
    getHistoricalRoastBaseline('Sette 270Wi', 'Medium', historyRecipes, historyShots, historyBeans, 'regular'),
    preFeatureHistoricalRoastBaseline('Sette 270Wi', 'Medium', regularOnlyRecipes, regularOnlyShots, regularOnlyBeans)
  );

  const sunbeamShots = [
    dialled('reg-shot', 10, 'A', 15, '2026-09-10T00:00:00.000Z', 'Sunbeam Barista Max'),
    dialled('decaf-shot', 15, 'A', 20, '2026-09-18T00:00:00.000Z', 'Sunbeam Barista Max'),
  ];
  assert.deepEqual(
    getInitialGrindRecommendation('Sunbeam Barista Max', 'Medium', newRegular, historyRecipes, sunbeamShots, historyBeans, mockDate),
    { setting: 15 }
  );
  assert.deepEqual(
    getInitialGrindRecommendation('Sunbeam Barista Max', 'Medium', newDecaf, historyRecipes, sunbeamShots, historyBeans, mockDate),
    { setting: 20 }
  );

  // Regular dial-ins are not a decaf prior. The start is the roast-class default plus age.
  const regularOnlyMedium = [
    dialled('reg-shot', 10, 'A', 20, '2026-09-18T00:00:00.000Z'),
  ];
  const priorBeans = [
    historyBeans.find(b => b.id === 'reg-shot'),
    newDecaf,
    { ...newRegular, id: 'fresh-regular', roastDate: '2026-09-20' },
    { ...newDecaf, id: 'fresh-decaf-prior', roastDate: '2026-09-20' },
  ];
  const priorRecipes = priorBeans.map(b => recipeFor(b.id));
  const decafPrior = getInitialGrindRecommendation('Sette 270Wi', 'Medium', newDecaf, priorRecipes, regularOnlyMedium, priorBeans, mockDate);
  const regularFromHistory = getInitialGrindRecommendation('Sette 270Wi', 'Medium', newRegular, priorRecipes, regularOnlyMedium, priorBeans, mockDate);
  assert.deepEqual(regularFromHistory, { macro: 10, micro: 'A' });
  assert.notDeepEqual(decafPrior, regularFromHistory);
  assert.deepEqual(decafPrior, decafStart);

  for (const roastType of ['Light', 'Medium', 'Dark']) {
    const plain = { id: `plain-${roastType}`, roastType, roastDate, storageType: 'bag' };
    const decafRoast = { id: `decaf-${roastType}`, roastType, roastDate, storageType: 'bag', isDecaf: true };
    const learned = { id: `learned-${roastType}`, roastType, roastDate, storageType: 'bag', isDecaf: false };
    const beansForRoast = [plain, decafRoast, learned];
    const recipesForRoast = beansForRoast.map(b => recipeFor(b.id));
    const learnedShot = [dialled(learned.id, 8, 'A', 8, '2026-09-18T00:00:00.000Z')];
    const plainStart = getInitialGrindRecommendation('Sette 270Wi', roastType, plain, recipesForRoast, [], beansForRoast, mockDate);
    const decafRoastStart = getInitialGrindRecommendation('Sette 270Wi', roastType, decafRoast, recipesForRoast, learnedShot, beansForRoast, mockDate);
    const learnedStart = getInitialGrindRecommendation('Sette 270Wi', roastType, { ...plain, id: 'new-' + roastType }, recipesForRoast.concat(recipeFor('new-' + roastType)), learnedShot, beansForRoast.concat({ ...plain, id: 'new-' + roastType }), mockDate);
    assert.deepEqual(decafRoastStart, plainStart, roastType);
    assert.notDeepEqual(learnedStart, plainStart, roastType);
  }

  const freshDecafPrior = priorBeans.find(b => b.id === 'fresh-decaf-prior');
  const freshRegular = priorBeans.find(b => b.id === 'fresh-regular');
  const freshDecafStart = getInitialGrindRecommendation('Sette 270Wi', 'Medium', freshDecafPrior, priorRecipes, regularOnlyMedium, priorBeans, mockDate);
  const freshRegularNoHistory = getInitialGrindRecommendation('Sette 270Wi', 'Medium', freshRegular, priorRecipes, [], priorBeans, mockDate);
  assert.deepEqual(freshDecafStart, freshRegularNoHistory);
  assert.notDeepEqual(freshDecafStart, decafPrior);
  assert.deepEqual(
    getInitialGrindRecommendation('Sunbeam Barista Max', 'Medium', freshDecafPrior, priorRecipes, [dialled('reg-shot', 10, 'A', 20, '2026-09-18T00:00:00.000Z', 'Sunbeam Barista Max')], priorBeans, mockDate),
    getInitialGrindRecommendation('Sunbeam Barista Max', 'Medium', freshRegular, priorRecipes, [], priorBeans, mockDate)
  );

  const lightDecaf = { id: 'light-decaf', roastType: 'Light', roastDate, storageType: 'bag', isDecaf: true };
  const crossRoastBeans = [lightDecaf, newDecaf];
  const crossRoastRecipes = crossRoastBeans.map(b => recipeFor(b.id));
  const crossRoastShots = [dialled('light-decaf', 18, 'C', 22, '2026-09-18T00:00:00.000Z')];
  assert.deepEqual(
    getInitialGrindRecommendation('Sette 270Wi', 'Medium', newDecaf, crossRoastRecipes, crossRoastShots, crossRoastBeans, mockDate),
    decafStart
  );

  const ownAndOther = getInitialGrindRecommendation(
    'Sette 270Wi',
    'Medium',
    decafBean,
    [recipeFor('decaf'), recipeFor('decaf-shot')],
    [
      dialled('decaf-shot', 15, 'A', 20, '2026-09-18T00:00:00.000Z'),
      {
        ...dialled('decaf', 11, 'C', 12, '2026-09-19T00:00:00.000Z'),
        beanAgeDays: calculateEffectiveBeanAge(decafBean, mockDate).daysOld,
        recommendation: { recommendedSetting: { macro: 11, micro: 'C' }, reason: 'KEEP GRIND — Balanced and in range.' },
      },
    ],
    [decafBean, historyBeans.find(b => b.id === 'decaf-shot')],
    mockDate
  );
  assert.deepEqual(ownAndOther, { macro: 11, micro: 'C' });

  const age = calculateEffectiveBeanAge(decafBean, mockDate).daysOld;
  const followedShot = {
    ...dialled('decaf', 13, 'E', 15, '2026-09-19T00:00:00.000Z'),
    beanAgeDays: age,
    recommendation: { recommendedSetting: { macro: 11, micro: 'C' }, reason: 'KEEP GRIND — Balanced and in range.' },
  };
  const afterFirst = getInitialGrindRecommendation(
    'Sette 270Wi',
    'Medium',
    decafBean,
    [recipeFor('decaf')],
    [followedShot],
    [decafBean],
    mockDate
  );
  assert.deepEqual(afterFirst, { macro: 11, micro: 'C' });

  const correctedShot = {
    ...followedShot,
    timestamp: '2026-09-20T00:00:00.000Z',
    recommendation: { recommendedSetting: { macro: 14, micro: 'A' }, reason: 'GO 1 STEP COARSER — Shot is in range but tastes bitter.' },
  };
  const afterFeedback = getInitialGrindRecommendation(
    'Sette 270Wi',
    'Medium',
    decafBean,
    [recipeFor('decaf')],
    [followedShot, correctedShot],
    [decafBean],
    mockDate
  );
  assert.deepEqual(afterFeedback, { macro: 14, micro: 'A' });
  assert.deepEqual(
    afterFeedback,
    getInitialGrindRecommendation(
      'Sette 270Wi',
      'Medium',
      regularBean,
      [recipeFor('regular')],
      [{ ...correctedShot, beanId: 'regular' }],
      [regularBean],
      mockDate
    )
  );

  const fast = calculateRecommendation({
    grinderModel: 'Sette 270Wi',
    setteMacro: 13,
    setteMicro: 'E',
    wasPurged: true,
    actualTime: 20,
    actualYield: 36,
    actualDose: 18,
    tasteProfile: 'sour',
  }, {
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
    targetDoseG: 18,
    targetYieldG: 36,
    brewTemperatureC: 93,
  }, [], false);
  const slow = calculateRecommendation({
    grinderModel: 'Sette 270Wi',
    setteMacro: 13,
    setteMicro: 'E',
    wasPurged: true,
    actualTime: 40,
    actualYield: 36,
    actualDose: 18,
    tasteProfile: 'bitter',
  }, {
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
    targetDoseG: 18,
    targetYieldG: 36,
    brewTemperatureC: 93,
  }, [], false);
  assert.deepEqual(fast.recommendedSetting, { macro: 12, micro: 'H' });
  assert.notDeepEqual(fast.recommendedSetting, slow.recommendedSetting);
  assert.deepEqual(Object.keys(fast).sort(), [
    'engineStats',
    'evidenceContext',
    'flairWaterTempAdvice',
    'reason',
    'recommendedSetting',
    'shotOutcome',
    'subRecommendation',
    'warning',
  ]);

  const sameAgeBean = { roastDate, roastType: 'Medium', storageType: 'bag' };
  const ageShot = {
    grinderModel: 'Sette 270Wi',
    beanAgeDays: 10,
    recommendation: { recommendedSetting: { macro: 13, micro: 'E' }, reason: 'KEEP GRIND — Balanced and in range.', warning: null },
  };
  assert.deepEqual(
    getAgeAdjustedRecommendation(ageShot, { ...sameAgeBean, isDecaf: true }, mockDate),
    getAgeAdjustedRecommendation(ageShot, { ...sameAgeBean }, mockDate)
  );
}

async function runDecafPersistenceTests() {
  assert.equal(db.verno, 17);

  const legacy = {
    id: 'legacy-bean',
    name: 'House',
    roaster: 'Local',
    roastType: 'Medium',
    roastDate: '2026-01-01',
    storageType: 'bag',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const legacyShot = {
    id: 'legacy-shot',
    beanId: 'legacy-bean',
    timestamp: '2026-01-05T00:00:00.000Z',
    grinderModel: 'Sette 270Wi',
    setteMacro: 13,
    setteMicro: 'E',
    sunbeamSetting: null,
    actualTimeS: 28,
    actualYieldG: 36,
    actualDoseG: 18,
    tasteProfile: 'good',
  };
  const legacyRecipe = {
    id: 'legacy-recipe',
    beanId: 'legacy-bean',
    targetDoseG: 18,
    targetYieldG: 36,
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
  };

  await db.open();
  await db.transaction('rw', db.beans, db.recipes, db.shots, async () => {
    await db.beans.clear();
    await db.recipes.clear();
    await db.shots.clear();
  });

  await db.beans.add(legacy);
  await db.shots.add(legacyShot);
  await db.recipes.add(legacyRecipe);

  const loadedLegacy = await db.beans.get('legacy-bean');
  assert.equal(Object.hasOwn(loadedLegacy, 'isDecaf'), false);
  assert.equal(beanIsDecaf(loadedLegacy), false);
  assert.equal(loadedLegacy.name, 'House');
  assert.equal(loadedLegacy.roastDate, '2026-01-01');

  await db.beans.add({
    id: 'regular-bean',
    name: 'Regular',
    roaster: 'Local',
    roastType: 'Light',
    roastDate: '2026-02-01',
    storageType: 'vacuum',
    isDecaf: false,
    createdAt: '2026-02-01T00:00:00.000Z',
  });
  await db.beans.add({
    id: 'decaf-bean',
    name: 'Decaf',
    roaster: 'Local',
    roastType: 'Dark',
    roastDate: '2026-02-02',
    storageType: 'bag',
    isDecaf: true,
    createdAt: '2026-02-02T00:00:00.000Z',
  });

  assert.equal((await db.beans.get('regular-bean')).isDecaf, false);
  assert.equal((await db.beans.get('decaf-bean')).isDecaf, true);

  await db.beans.update('regular-bean', { name: 'Regular edited' });
  const editedRegular = await db.beans.get('regular-bean');
  assert.equal(editedRegular.name, 'Regular edited');
  assert.equal(editedRegular.isDecaf, false);
  assert.equal(editedRegular.roastType, 'Light');

  await db.beans.update('decaf-bean', { isDecaf: false });
  assert.equal((await db.beans.get('decaf-bean')).isDecaf, false);
  assert.equal((await db.beans.get('decaf-bean')).name, 'Decaf');
  await db.beans.update('decaf-bean', { isDecaf: true });
  assert.equal((await db.beans.get('decaf-bean')).isDecaf, true);

  await db.beans.update('regular-bean', { isDecaf: true });
  assert.equal((await db.beans.get('regular-bean')).isDecaf, true);
  await db.beans.update('regular-bean', { isDecaf: false });
  assert.equal((await db.beans.get('regular-bean')).isDecaf, false);

  const untouchedLegacy = await db.beans.get('legacy-bean');
  assert.equal(Object.hasOwn(untouchedLegacy, 'isDecaf'), false);
  assert.equal(untouchedLegacy.name, 'House');

  const formSaved = { ...untouchedLegacy, isDecaf: beanIsDecaf(untouchedLegacy), name: 'House saved' };
  await db.beans.update(formSaved.id, formSaved);
  const afterFormSave = await db.beans.get('legacy-bean');
  assert.equal(afterFormSave.isDecaf, false);
  assert.equal(afterFormSave.name, 'House saved');
  assert.equal(afterFormSave.roastDate, '2026-01-01');
  assert.equal(afterFormSave.roaster, 'Local');

  assert.equal(await db.beans.count(), 3);
  assert.equal(await db.shots.count(), 1);
  assert.equal(await db.recipes.count(), 1);
  const storedShot = await db.shots.get('legacy-shot');
  assert.equal(storedShot.setteMacro, 13);
  assert.equal(storedShot.setteMicro, 'E');
  assert.equal(storedShot.tasteProfile, 'good');
  assert.equal(storedShot.actualTimeS, 28);
  assert.equal((await db.recipes.get('legacy-recipe')).targetYieldG, 36);
  assert.equal(db.verno, 17);

  db.close();
}

function runSevereDeviationTests() {
  const recipe = {
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
    targetDoseG: 18,
    targetYieldG: 36,
    brewTemperatureC: 93,
  };
  const outsideYieldWarning = /far outside the target time and yield/;
  const setteShot = (time, taste, yieldG, extra = {}) => ({
    grinderModel: 'Sette 270Wi',
    setteMacro: 13,
    setteMicro: 'E',
    wasPurged: true,
    actualTime: time,
    actualYield: yieldG,
    actualDose: 18,
    tasteProfile: taste,
    ...extra,
  });
  const sunbeamShot = (time, taste, yieldG) => ({
    grinderModel: 'Sunbeam Barista Max',
    sunbeamSetting: 15,
    wasPurged: true,
    actualTime: time,
    actualYield: yieldG,
    actualDose: 18,
    tasteProfile: taste,
  });

  assert.equal(KNOWN_ISSUE_REASONS.stopped_early, 'Shot stopped early');
  assert.equal(knownIssueReasonLabel('stopped_early'), 'Shot stopped early');

  const fast = calculateRecommendation(setteShot(20, 'sour', 36), recipe, [], false);
  assert.match(fast.reason, /GO \d+ MICRO STEP\(S\) FINER — Shot was \d+s off target midpoint/);
  assert.deepEqual(fast.recommendedSetting, { macro: 12, micro: 'H' });
  assert.equal(fast.shotOutcome.isSevereChoke, false);
  assert.equal(fast.shotOutcome.isDialledIn, false);
  assert.ok(!fast.warning || !outsideYieldWarning.test(fast.warning));
  assert.equal(shotEligibleForLearning({ actualTimeS: 20, actualYieldG: 36, tasteProfile: 'sour' }), true);

  const fastShort = calculateRecommendation(setteShot(20, 'sour', 30), recipe, [], false);
  assert.deepEqual(fastShort.recommendedSetting, fast.recommendedSetting);
  assert.match(fastShort.reason, /FINER/);
  assert.match(fastShort.warning, outsideYieldWarning);
  assert.equal(fastShort.shotOutcome.isSevereChoke, false);
  assert.equal(shotEligibleForLearning({ actualTimeS: 20, actualYieldG: 30, tasteProfile: 'sour' }), true);

  const fastNearYield = calculateRecommendation(setteShot(20, 'sour', 33), recipe, [], false);
  assert.deepEqual(fastNearYield.recommendedSetting, fast.recommendedSetting);
  assert.ok(!fastNearYield.warning || !outsideYieldWarning.test(fastNearYield.warning));

  const slow = calculateRecommendation(setteShot(40, 'bitter', 36), recipe, [], false);
  assert.match(slow.reason, /GO \d+ MICRO STEP\(S\) COARSER — Shot was \d+s off target midpoint/);
  assert.deepEqual(slow.recommendedSetting, { macro: 14, micro: 'F' });
  assert.equal(slow.shotOutcome.isSevereChoke, false);
  assert.ok(!slow.warning || !outsideYieldWarning.test(slow.warning));

  const slowBoundary = calculateRecommendation(setteShot(35, 'bitter', 36), recipe, [], false);
  assert.match(slowBoundary.reason, /off target midpoint/);
  assert.equal(slowBoundary.shotOutcome.isSevereChoke, false);

  const inRangeShort = calculateRecommendation(setteShot(28, 'good', 32.5), recipe, [], false);
  assert.equal(inRangeShort.reason, 'KEEP GRIND — Balanced and in range.');
  assert.match(inRangeShort.warning, /hit target time but under-yielded/);
  assert.ok(!outsideYieldWarning.test(inRangeShort.warning));
  assert.equal(inRangeShort.shotOutcome.isDialledIn, false);

  assert.equal(shotIsSevereChoke(60, 10, 25, 30, 36), true);
  assert.equal(shotIsSevereChoke(60, 10, 27, 32, 36), true);
  assert.equal(shotIsSevereChoke(60, 36, 25, 30, 36), false);
  assert.equal(shotIsSevereChoke(20, 10, 25, 30, 36), false);
  assert.equal(shotIsSevereChoke(35, 10, 25, 30, 36), true);
  assert.equal(shotIsSevereChoke(34, 10, 25, 30, 36), false);
  assert.equal(shotIsSevereChoke(40, 30, 25, 30, 36), false);

  const choke = calculateRecommendation(setteShot(60, 'sour', 10), recipe, [], false);
  const rawSlow = calculateRecommendation(setteShot(60, 'sour', 36), recipe, [], false);
  assert.equal(choke.shotOutcome.isSevereChoke, true);
  assert.equal(choke.shotOutcome.isDialledIn, false);
  assert.equal(choke.shotOutcome.statusLabel, null);
  assert.deepEqual(choke.recommendedSetting, slowBoundary.recommendedSetting);
  assert.deepEqual(choke.recommendedSetting, { macro: 14, micro: 'B' });
  assert.notDeepEqual(choke.recommendedSetting, rawSlow.recommendedSetting);
  assert.equal(setteToNumeric(choke.recommendedSetting.macro, choke.recommendedSetting.micro) - setteToNumeric(13, 'E'), 6);
  assert.notEqual(
    setteToNumeric(choke.recommendedSetting.macro, choke.recommendedSetting.micro) - setteToNumeric(13, 'E'),
    Math.round((60 - 27.5) / 1.25)
  );
  assert.notEqual(
    setteToNumeric(choke.recommendedSetting.macro, choke.recommendedSetting.micro) - setteToNumeric(13, 'E'),
    Math.round((((60 / 10) * 36) - 27.5) / 1.25)
  );
  assert.match(choke.reason, /Severe choke detected — shot produced very little yield over an extended time\. Go substantially coarser\./);
  assert.doesNotMatch(choke.reason, /extrapolat|CHOKED SHOT/i);
  assert.equal(Object.hasOwn(choke, 'extrapolatedTime'), false);
  assert.match(choke.reason, /COARSER/);
  assert.doesNotMatch(choke.reason, /FINER/);
  assert.ok(!choke.warning || !outsideYieldWarning.test(choke.warning));

  const yieldMissSlow = calculateRecommendation(setteShot(40, 'bitter', 30), recipe, [], false);
  assert.equal(yieldMissSlow.shotOutcome.isSevereChoke, false);
  assert.deepEqual(yieldMissSlow.recommendedSetting, slow.recommendedSetting);
  assert.match(yieldMissSlow.reason, /off target midpoint/);
  assert.match(yieldMissSlow.warning, outsideYieldWarning);
  assert.equal(shotEligibleForLearning({ actualTimeS: 40, actualYieldG: 30, tasteProfile: 'bitter' }), true);

  const sunFast = calculateRecommendation(sunbeamShot(20, 'sour', 36), recipe, [], false);
  const sunSlow = calculateRecommendation(sunbeamShot(40, 'bitter', 36), recipe, [], false);
  const sunChoke = calculateRecommendation(sunbeamShot(60, 'bitter', 10), recipe, [], false);
  const sunRaw = calculateRecommendation(sunbeamShot(60, 'bitter', 36), recipe, [], false);
  const sunBoundary = calculateRecommendation(sunbeamShot(35, 'bitter', 36), recipe, [], false);
  assert.deepEqual(sunFast.recommendedSetting, { setting: 13 });
  assert.deepEqual(sunSlow.recommendedSetting, { setting: 18 });
  assert.match(sunFast.reason, /off target midpoint/);
  assert.match(sunSlow.reason, /off target midpoint/);
  assert.deepEqual(sunChoke.recommendedSetting, { setting: 17 });
  assert.deepEqual(sunChoke.recommendedSetting, sunBoundary.recommendedSetting);
  assert.notDeepEqual(sunChoke.recommendedSetting, sunRaw.recommendedSetting);
  assert.match(sunChoke.reason, /SETTING\(S\) COARSER/);
  assert.match(sunChoke.reason, /Severe choke detected/);
  assert.doesNotMatch(JSON.stringify(sunChoke), /extrapolat/i);

  const sunInRange = calculateRecommendation(sunbeamShot(28, 'very_bitter', 36), recipe, [], false);
  assert.deepEqual(sunInRange.recommendedSetting, { setting: 16 });
  const setteInRange = calculateRecommendation(setteShot(28, 'very_bitter', 36), recipe, [], false);
  assert.deepEqual(setteInRange.recommendedSetting, { macro: 13, micro: 'G' });

  const mockDate = '2026-09-20T12:00:00.000Z';
  const bean = { id: 'b1', roastType: 'Medium', roastDate: '2026-09-01', storageType: 'bag' };
  const recipes = [{ beanId: 'b1', ...recipe }];
  const age = calculateEffectiveBeanAge(bean, mockDate).daysOld;
  const dialled = {
    id: 'dialled',
    beanId: 'b1',
    grinderModel: 'Sette 270Wi',
    setteMacro: 10,
    setteMicro: 'A',
    actualTimeS: 28,
    actualYieldG: 36,
    actualDoseG: 18,
    tasteProfile: 'good',
    timestamp: '2026-09-18T10:00:00.000Z',
    beanAgeDays: age,
    recommendationFollowed: true,
    recommendation: {
      recommendedSetting: { macro: 10, micro: 'A' },
      reason: 'KEEP GRIND — Balanced and in range.',
    },
  };
  const chokeRecord = {
    id: 'choke',
    beanId: 'b1',
    grinderModel: 'Sette 270Wi',
    setteMacro: 13,
    setteMicro: 'E',
    actualTimeS: 60,
    actualYieldG: 10,
    actualDoseG: 18,
    tasteProfile: 'sour',
    timestamp: '2026-09-19T10:00:00.000Z',
    beanAgeDays: age,
    recommendation: choke,
  };
  assert.equal(classifyShotOutcome(chokeRecord, recipe).isDialledIn, false);
  assert.equal(classifyShotOutcome(chokeRecord, recipe).isSevereChoke, true);
  assert.equal(getHistoricalRoastBaseline('Sette 270Wi', 'Medium', recipes, [chokeRecord], [bean]), null);
  assert.equal(getHistoricalRoastBaseline('Sette 270Wi', 'Medium', recipes, [dialled, chokeRecord], [bean]), setteToNumeric(10, 'A'));

  const newestFirst = [chokeRecord, dialled];
  const learningAfterChoke = newestFirst.find((s) => s.beanId === 'b1' && shotEligibleForLearning(s));
  assert.equal(learningAfterChoke.id, 'choke');
  assert.deepEqual(
    getAgeAdjustedRecommendation(learningAfterChoke, bean, mockDate).recommendedSetting,
    choke.recommendedSetting
  );

  const stopped = {
    ...chokeRecord,
    id: 'stopped',
    actualDoseG: 18.0,
    actualYieldG: 10,
    actualTimeS: 60,
    tasteProfile: 'bitter',
    setteMacro: 13,
    setteMicro: 'E',
    notes: 'aborted',
    recommendationFollowed: false,
    excludeFromLearning: true,
    knownIssueReason: 'stopped_early',
    recommendation: {
      recommendedSetting: { macro: 20, micro: 'I' },
      reason: 'should not be applied',
    },
  };
  const history = [stopped, dialled];
  assert.equal(history.length, 2);
  assert.equal(stopped.actualDoseG, 18);
  assert.equal(stopped.actualYieldG, 10);
  assert.equal(stopped.actualTimeS, 60);
  assert.equal(shotEligibleForLearning(stopped), false);
  const learningAfterStop = history.find((s) => s.beanId === 'b1' && shotEligibleForLearning(s));
  assert.equal(learningAfterStop.id, 'dialled');
  assert.deepEqual(
    getAgeAdjustedRecommendation(learningAfterStop, bean, mockDate).recommendedSetting,
    dialled.recommendation.recommendedSetting
  );
  assert.notDeepEqual(
    getAgeAdjustedRecommendation(learningAfterStop, bean, mockDate).recommendedSetting,
    stopped.recommendation.recommendedSetting
  );
  assert.deepEqual(
    getInitialGrindRecommendation('Sette 270Wi', 'Medium', bean, recipes, history, [bean], mockDate),
    getInitialGrindRecommendation('Sette 270Wi', 'Medium', bean, recipes, [dialled], [bean], mockDate)
  );
  assert.equal(
    getHistoricalRoastBaseline('Sette 270Wi', 'Medium', recipes, history, [bean]),
    getHistoricalRoastBaseline('Sette 270Wi', 'Medium', recipes, [dialled], [bean])
  );

  const followedReference = getAgeAdjustedRecommendation(learningAfterStop, bean, mockDate).recommendedSetting;
  assert.deepEqual(followedReference, { macro: 10, micro: 'A' });

  const afterStoppedHistory = calculateRecommendation(
    setteShot(22, 'sour', 36, { previousShot: learningAfterStop }),
    recipe,
    history,
    false
  );
  const afterDialledOnly = calculateRecommendation(
    setteShot(22, 'sour', 36, { previousShot: dialled }),
    recipe,
    [dialled],
    false
  );
  assert.deepEqual(afterStoppedHistory.recommendedSetting, afterDialledOnly.recommendedSetting);
  assert.equal(afterStoppedHistory.flairWaterTempAdvice, afterDialledOnly.flairWaterTempAdvice);

  const notBaseline = (overrides) => ({
    ...dialled,
    id: `nb-${overrides.tasteProfile || 'x'}-${overrides.actualTimeS}`,
    ...overrides,
  });
  const baselineShots = [
    notBaseline({ tasteProfile: 'sour', id: 'sour' }),
    notBaseline({ tasteProfile: 'bitter', id: 'bitter' }),
    notBaseline({ actualTimeS: 20, tasteProfile: 'good', id: 'fast' }),
    notBaseline({ actualYieldG: 30, tasteProfile: 'good', id: 'yield' }),
    notBaseline({ excludeFromLearning: true, knownIssueReason: 'puck_prep', id: 'issue' }),
    notBaseline({ excludeFromLearning: true, knownIssueReason: 'stopped_early', id: 'stopped-dialled' }),
  ];
  assert.equal(getHistoricalRoastBaseline('Sette 270Wi', 'Medium', recipes, baselineShots, [bean]), null);
  assert.equal(classifyShotOutcome(baselineShots.find((s) => s.id === 'sour'), recipe).isDialledIn, false);
  assert.equal(classifyShotOutcome(baselineShots.find((s) => s.id === 'bitter'), recipe).isDialledIn, false);
  assert.equal(classifyShotOutcome(baselineShots.find((s) => s.id === 'fast'), recipe).isDialledIn, false);
  assert.equal(classifyShotOutcome(baselineShots.find((s) => s.id === 'yield'), recipe).isDialledIn, false);

  const decafBean = { id: 'decaf', roastType: 'Medium', roastDate: '2026-09-01', storageType: 'bag', isDecaf: true };
  const decafStopped = {
    ...dialled,
    id: 'decaf-stopped',
    beanId: 'decaf',
    excludeFromLearning: true,
    knownIssueReason: 'stopped_early',
  };
  assert.equal(
    getHistoricalRoastBaseline('Sette 270Wi', 'Medium', [{ beanId: 'decaf', ...recipe }], [decafStopped], [decafBean], 'decaf'),
    null
  );
}

async function runLegacyShotDataTests() {
  assert.equal(db.verno, 17);
  await db.open();
  await db.transaction('rw', db.beans, db.recipes, db.shots, db.settings, async () => {
    await db.beans.clear();
    await db.recipes.clear();
    await db.shots.clear();
    await db.settings.clear();
  });

  const legacyBean = {
    id: 'legacy-bean',
    name: 'House',
    roaster: 'Local',
    roastType: 'Medium',
    roastDate: '2026-01-01',
    storageType: 'bag',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const legacyRecipe = {
    id: 'legacy-recipe',
    beanId: 'legacy-bean',
    targetDoseG: 18,
    targetYieldG: 36,
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
  };
  const legacyShot = {
    id: 'legacy-shot',
    beanId: 'legacy-bean',
    timestamp: '2026-01-05T00:00:00.000Z',
    grinderModel: 'Sette 270Wi',
    setteMacro: 12,
    setteMicro: 'C',
    actualTimeS: 28,
    actualYieldG: 36,
    actualDoseG: 18,
    tasteProfile: 'good',
  };
  const legacySettings = {
    id: 'global',
    grinderModel: 'Sette 270Wi',
    flairEnabled: false,
    darkMode: true,
  };

  await db.beans.add(legacyBean);
  await db.recipes.add(legacyRecipe);
  await db.shots.add(legacyShot);
  await db.settings.add(legacySettings);

  const loadedBean = await db.beans.get('legacy-bean');
  const loadedRecipe = await db.recipes.get('legacy-recipe');
  const loadedShot = await db.shots.get('legacy-shot');
  const loadedSettings = await db.settings.get('global');
  assert.equal(loadedBean.name, 'House');
  assert.equal(Object.hasOwn(loadedBean, 'isDecaf'), false);
  assert.equal(loadedRecipe.targetYieldG, 36);
  assert.equal(loadedShot.setteMacro, 12);
  assert.equal(loadedShot.setteMicro, 'C');
  assert.equal(loadedShot.tasteProfile, 'good');
  assert.equal(Object.hasOwn(loadedShot, 'excludeFromLearning'), false);
  assert.equal(shotEligibleForLearning(loadedShot), true);
  assert.equal(loadedSettings.grinderModel, 'Sette 270Wi');
  assert.equal(loadedSettings.darkMode, true);

  await db.shots.add({
    id: 'stopped-shot',
    beanId: 'legacy-bean',
    timestamp: '2026-01-06T00:00:00.000Z',
    grinderModel: 'Sette 270Wi',
    setteMacro: 13,
    setteMicro: 'E',
    actualDoseG: 18,
    actualYieldG: 10,
    actualTimeS: 60,
    tasteProfile: 'bitter',
    notes: 'stopped the shot',
    excludeFromLearning: true,
    knownIssueReason: 'stopped_early',
  });

  const keptLegacyShot = await db.shots.get('legacy-shot');
  const keptBean = await db.beans.get('legacy-bean');
  const keptRecipe = await db.recipes.get('legacy-recipe');
  const keptSettings = await db.settings.get('global');
  const stoppedShot = await db.shots.get('stopped-shot');
  assert.equal(keptLegacyShot.setteMacro, 12);
  assert.equal(keptLegacyShot.actualYieldG, 36);
  assert.equal(Object.hasOwn(keptLegacyShot, 'excludeFromLearning'), false);
  assert.equal(keptBean.name, 'House');
  assert.equal(keptBean.roastDate, '2026-01-01');
  assert.equal(keptRecipe.targetTimeMinS, 25);
  assert.equal(keptSettings.darkMode, true);
  assert.equal(keptSettings.flairEnabled, false);
  assert.equal(stoppedShot.actualDoseG, 18);
  assert.equal(stoppedShot.actualYieldG, 10);
  assert.equal(stoppedShot.actualTimeS, 60);
  assert.equal(stoppedShot.tasteProfile, 'bitter');
  assert.equal(stoppedShot.setteMacro, 13);
  assert.equal(stoppedShot.notes, 'stopped the shot');
  assert.equal(stoppedShot.excludeFromLearning, true);
  assert.equal(stoppedShot.knownIssueReason, 'stopped_early');
  assert.equal(shotEligibleForLearning(stoppedShot), false);
  assert.equal(await db.beans.count(), 1);
  assert.equal(await db.recipes.count(), 1);
  assert.equal(await db.shots.count(), 2);
  assert.equal(await db.settings.count(), 1);
  assert.equal(db.verno, 17);

  db.close();
}

runTests().catch((err) => {
  console.error(err);
  throw err;
});
