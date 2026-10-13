import assert from 'assert';
import {
  BCG820_GRINDER_ID,
  ENCORE_ESP_GRINDER_ID,
  FELLOW_OPUS_GRINDER_ID,
  MAZZER_PHILOS_GRINDER_ID,
  ZERNO_Z1_GRINDER_ID,
  getPresetGrinderSpec,
} from './catalog.js';
import {
  adjustPresetGrind,
  parsePresetGrindValue,
  presetValueToNumeric,
} from './dial.js';
import { getPresetGrinderDefinition } from './index.js';
import { getRecommendationGrinderProfile } from '../grinderRegistry.js';

export function runPresetGrindersTests() {
  const bcg = getPresetGrinderSpec(BCG820_GRINDER_ID);
  assert.equal(parsePresetGrindValue(12, bcg), 12);
  assert.equal(adjustPresetGrind(12, -1, bcg), 11);
  assert.equal(adjustPresetGrind(12, 1, bcg), 13);

  const encore = getPresetGrinderSpec(ENCORE_ESP_GRINDER_ID);
  assert.equal(parsePresetGrindValue(15, encore), 15);
  assert.equal(adjustPresetGrind(15, -1, encore), 14);

  const opus = getPresetGrinderSpec(FELLOW_OPUS_GRINDER_ID);
  assert.equal(parsePresetGrindValue(1.5, opus), 1.5);
  assert.equal(adjustPresetGrind(1.5, -1, opus), 1.25);

  const philos = getPresetGrinderSpec(MAZZER_PHILOS_GRINDER_ID);
  assert.equal(adjustPresetGrind(20, -1, philos), 21);
  assert.ok(presetValueToNumeric(21, philos) > presetValueToNumeric(20, philos));

  const zerno = getPresetGrinderSpec(ZERNO_Z1_GRINDER_ID);
  assert.equal(parsePresetGrindValue(200, zerno), 200);
  assert.equal(adjustPresetGrind(200, -1, zerno), 195);

  const def = getPresetGrinderDefinition(BCG820_GRINDER_ID);
  assert.equal(def.controlType, 'presetStepped');
  assert.equal(getRecommendationGrinderProfile(BCG820_GRINDER_ID).sensitivity, 3.2);

  const eureka = getPresetGrinderDefinition('Eureka Mignon Specialità');
  assert.equal(eureka.referenceLearning, true);
  assert.equal(eureka.supportsQuantitativeRecommendations, false);

  console.log('Preset grinder tests passed.');
}
