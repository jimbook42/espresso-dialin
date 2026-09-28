import { calculateRecommendation } from './src/utils/grinderLogic.js';
import assert from 'assert';

function runTests() {
  const recipe = {
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
    targetDoseG: 18,
    targetYieldG: 36,
    brewTemperatureC: 93,
    flairProfile: { preinfusionPressure: '2', peakPressure: '9', taperPressure: '6' }
  };

  const createShot = (time, taste, yieldG = 36, temp = 93) => ({
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
    flairProfile: { preinfusionPressure: '2', peakPressure: '9', taperPressure: '6' }
  });

  const runCalc = (current, history = []) => calculateRecommendation(current, recipe, history, true);

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

  // in-range bitter shot
  rec = runCalc(createShot(27, 'bitter'));
  assert.match(rec.reason, /GO 1 STEP COARSER/);

  // one qualifying sour shot (current)
  rec = runCalc(createShot(27, 'sour'));
  assert(!rec.flairWaterTempAdvice);

  // two qualifying sour shots (1 history + current)
  rec = runCalc(createShot(27, 'sour'), [createShot(27, 'sour')]);
  assert(!rec.flairWaterTempAdvice);

  // three qualifying sour shots (2 history + current)
  rec = runCalc(createShot(27, 'sour'), [createShot(27, 'sour'), createShot(28, 'very_sour')]);
  assert.match(rec.flairWaterTempAdvice, /Increase brew water/);

  // three qualifying bitter shots
  rec = runCalc(createShot(27, 'bitter'), [createShot(27, 'bitter'), createShot(28, 'very_bitter')]);
  assert.match(rec.flairWaterTempAdvice, /Decrease brew water/);

  // mixed history (sour, bitter, sour)
  rec = runCalc(createShot(27, 'sour'), [createShot(27, 'bitter'), createShot(28, 'sour')]);
  assert(!rec.flairWaterTempAdvice);

  // different flair profile (not comparable)
  const diffFlairShot = createShot(27, 'sour');
  diffFlairShot.flairProfile.peakPressure = '8'; // different peak
  rec = runCalc(createShot(27, 'sour'), [createShot(27, 'sour'), diffFlairShot]);
  assert(!rec.flairWaterTempAdvice); // only 2 comparable shots now

  // non-dialled-in sour shots don't count
  const fastSourShot = createShot(20, 'sour');
  rec = runCalc(createShot(27, 'sour'), [createShot(27, 'sour'), fastSourShot]);
  assert(!rec.flairWaterTempAdvice); // only 2 comparable shots

  console.log("All tests passed!");
}

runTests();
