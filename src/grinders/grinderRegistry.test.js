import assert from 'assert';
import {
  SETTE_GRINDER_ID,
  SUNBEAM_GRINDER_ID,
  adjustSette,
  adjustSunbeam,
  getGrinderDefinitionById,
  getRecommendationGrinderProfile,
  getShotStatsGrinderProfile,
  isSetteGrinderModel,
  resolveShotStatsGrinderModel,
  setteToNumeric,
} from './grinderRegistry.js';

function testSetteDefinition() {
  const def = getGrinderDefinitionById(SETTE_GRINDER_ID);
  assert.ok(def);
  assert.equal(def.id, SETTE_GRINDER_ID);
  assert.equal(def.sensitivity, 1.25);
  assert.equal(def.macroMin, 1);
  assert.equal(def.macroMax, 31);
  assert.deepEqual(def.microLetters, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
  assert.equal(def.numericMin, 0);
  assert.equal(def.numericMax, 278);
  assert.equal(setteToNumeric(13, 'E'), 112);
  assert.deepEqual(adjustSette(13, 'E', -2), { macro: 13, micro: 'C' });
}

function testSunbeamDefinition() {
  const def = getGrinderDefinitionById(SUNBEAM_GRINDER_ID);
  assert.ok(def);
  assert.equal(def.id, SUNBEAM_GRINDER_ID);
  assert.equal(def.sensitivity, 4.5);
  assert.equal(def.dialMin, 1);
  assert.equal(def.dialMax, 30);
  assert.equal(adjustSunbeam(15, 1), 16);
  assert.equal(adjustSunbeam(30, 5), 30);
}

function testCompatibility() {
  assert.equal(getGrinderDefinitionById('Mystery Grinder'), null);
  assert.equal(getGrinderDefinitionById(''), null);

  assert.equal(isSetteGrinderModel(SETTE_GRINDER_ID), true);
  assert.equal(isSetteGrinderModel(SUNBEAM_GRINDER_ID), false);
  assert.equal(isSetteGrinderModel('Unknown'), false);
  assert.equal(isSetteGrinderModel(null), false);
  assert.equal(isSetteGrinderModel(undefined), false);
  assert.equal(isSetteGrinderModel(''), false);

  assert.equal(getRecommendationGrinderProfile(SETTE_GRINDER_ID).sensitivity, 1.25);
  assert.equal(getRecommendationGrinderProfile(SUNBEAM_GRINDER_ID).sensitivity, 4.5);
  assert.equal(getRecommendationGrinderProfile('Unknown Grinder').sensitivity, 4.5);
  assert.equal(getRecommendationGrinderProfile(null).sensitivity, 4.5);
  assert.equal(getRecommendationGrinderProfile(undefined).sensitivity, 4.5);
  assert.equal(getRecommendationGrinderProfile('').sensitivity, 4.5);

  assert.equal(resolveShotStatsGrinderModel(undefined), SETTE_GRINDER_ID);
  assert.equal(resolveShotStatsGrinderModel(null), SETTE_GRINDER_ID);
  assert.equal(resolveShotStatsGrinderModel(''), SETTE_GRINDER_ID);
  assert.equal(resolveShotStatsGrinderModel('Mystery'), 'Mystery');

  assert.equal(getShotStatsGrinderProfile(resolveShotStatsGrinderModel(null)).sensitivity, 1.25);
  assert.equal(getShotStatsGrinderProfile(resolveShotStatsGrinderModel('')).sensitivity, 1.25);
  assert.equal(getShotStatsGrinderProfile('Mystery').sensitivity, 4.5);
}

testSetteDefinition();
testSunbeamDefinition();
testCompatibility();
console.log('grinderRegistry tests passed.');
