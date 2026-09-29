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
  recipeContextForShot,
  setteToNumeric,
  shotMatchesRecipeContext,
  shotResultImproved,
} from './src/utils/grinderLogic.js';
import { runBrewGuideTests } from './src/brewGuide/steps.test.js';
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
  runDecafRegressionTests();
  await runDecafPersistenceTests();
  console.log('All tests passed!');
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
  assert.match(decafContextNote(decafBean, 'roast-baseline'), /usual roast baseline/);
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

  // Decaf with no decaf history uses the same starting grind as regular coffee.
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

runTests().catch((err) => {
  console.error(err);
  throw err;
});
