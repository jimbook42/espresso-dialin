import assert from 'assert';
import {
  adjustCustomGrind,
  buildCustomGrinderDefinition,
  customDialIndexToValue,
  customDialMaxIndex,
  customDialValueIndex,
  defaultCustomGrindValue,
  normalizeCustomGrinderProfile,
  parseCustomGrindValue,
} from './customGrinder.js';

function runCustomGrinderDialMathTests() {
  const profile = normalizeCustomGrinderProfile({
    name: 'Test Grinder',
    dialType: 'stepped',
    min: 1,
    max: 10,
    step: 1,
    lowerIsFiner: true,
  });
  assert.ok(profile);

  assert.equal(defaultCustomGrindValue(profile), 6);
  assert.equal(parseCustomGrindValue(7, profile), 7);
  assert.equal(parseCustomGrindValue(7.6, profile), 8);
  assert.equal(adjustCustomGrind(5, -1, profile), 4);
  assert.equal(adjustCustomGrind(5, 1, profile), 6);

  const higherIsFiner = { ...profile, lowerIsFiner: false };
  assert.equal(adjustCustomGrind(5, -1, higherIsFiner), 6);

  const stepless = normalizeCustomGrinderProfile({
    name: 'Stepless',
    dialType: 'stepless',
    min: 0,
    max: 5,
    step: 0.1,
    lowerIsFiner: true,
  });
  assert.equal(parseCustomGrindValue(1.04, stepless), 1);
  assert.equal(customDialMaxIndex(stepless), 50);
  assert.equal(customDialValueIndex(2.5, stepless), 25);
  assert.equal(customDialIndexToValue(25, stepless), 2.5);

  const def = buildCustomGrinderDefinition(profile);
  assert.equal(def.shotToNumeric({ customGrindValue: 3 }), 2);
  const rec = def.adjustSetting(-1, { customGrindValue: 5 });
  assert.equal(rec.customGrindValue, 4);
}

export function runCustomGrinderTests() {
  runCustomGrinderDialMathTests();
}
