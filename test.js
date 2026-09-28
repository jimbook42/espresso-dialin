import {
  calculateRecommendation,
  classifyShotOutcome,
  getHistoricalRoastBaseline,
  shotResultImproved,
} from './src/utils/grinderLogic.js';
import assert from 'assert';

function runTests() {
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

  console.log('All tests passed!');
}

runTests();
