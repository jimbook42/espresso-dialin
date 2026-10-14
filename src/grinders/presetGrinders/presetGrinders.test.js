import assert from 'assert';
import {
  BCG820_GRINDER_ID,
  ENCORE_ESP_GRINDER_ID,
  FELLOW_OPUS_GRINDER_ID,
  MAZZER_PHILOS_GRINDER_ID,
  PRESET_GRINDER_IDS,
  ZERNO_Z1_GRINDER_ID,
  getPresetGrinderSpec,
} from './catalog.js';
import {
  adjustPresetGrind,
  clampPresetGrind,
  defaultPresetGrindValue,
  parsePresetGrindValue,
} from './dial.js';
import {
  getPersistedPresetGrindValue,
  persistedPresetGrindSettingsPatch,
} from './presetGrindPersistence.js';
import { resolveGrindControlUiState } from '../grindControlUiState.js';
import { persistedSettingsPatchFromRecommendation } from '../grinderRegistry.js';
import { getPresetGrinderDefinition } from './index.js';
import {
  getRecommendationGrinderProfile,
  uiStateFromRecommendedSetting,
} from '../grinderRegistry.js';
import {
  calculateRecommendation,
  getInitialGrindRecommendation,
} from '../../utils/grinderLogic.js';

const RECIPE = {
  targetTimeMinS: 27,
  targetTimeMaxS: 32,
  targetDoseG: 18,
  targetYieldG: 36,
};
const BEAN = { id: 'bean-1', roastType: 'Medium' };

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
  assert.equal(adjustPresetGrind(20, -1, philos), 19);
  assert.equal(adjustPresetGrind(20, 1, philos), 21);

  const zerno = getPresetGrinderSpec(ZERNO_Z1_GRINDER_ID);
  assert.equal(parsePresetGrindValue(200, zerno), 200);
  assert.equal(adjustPresetGrind(200, -1, zerno), 195);

  const def = getPresetGrinderDefinition(BCG820_GRINDER_ID);
  assert.equal(def.controlType, 'presetStepped');
  assert.equal(getRecommendationGrinderProfile(BCG820_GRINDER_ID).sensitivity, 3.2);

  const eureka = getPresetGrinderDefinition('Eureka Mignon Specialità');
  assert.equal(eureka.referenceLearning, true);
  assert.equal(eureka.supportsQuantitativeRecommendations, false);

  const initialBcg = getInitialGrindRecommendation(
    BCG820_GRINDER_ID,
    'Medium',
    BEAN,
    [{ beanId: BEAN.id, ...RECIPE }],
    [],
    [BEAN]
  );
  assert.equal(initialBcg.customGrindValue, 12);
  assert.equal(
    getInitialGrindRecommendation(
      ENCORE_ESP_GRINDER_ID,
      'Medium',
      BEAN,
      [{ beanId: BEAN.id, ...RECIPE }],
      [],
      [BEAN]
    ).customGrindValue,
    15
  );
  assert.equal(
    getInitialGrindRecommendation(
      FELLOW_OPUS_GRINDER_ID,
      'Medium',
      BEAN,
      [{ beanId: BEAN.id, ...RECIPE }],
      [],
      [BEAN]
    ).customGrindValue,
    1.5
  );
  assert.equal(
    getInitialGrindRecommendation(
      MAZZER_PHILOS_GRINDER_ID,
      'Medium',
      BEAN,
      [{ beanId: BEAN.id, ...RECIPE }],
      [],
      [BEAN]
    ).customGrindValue,
    20
  );
  assert.equal(
    getInitialGrindRecommendation(
      ZERNO_Z1_GRINDER_ID,
      'Medium',
      BEAN,
      [{ beanId: BEAN.id, ...RECIPE }],
      [],
      [BEAN]
    ).customGrindValue,
    200
  );

  for (const grinderId of PRESET_GRINDER_IDS) {
    const spec = getPresetGrinderSpec(grinderId);
    const start = defaultPresetGrindValue(spec);
    const baseShot = {
      grinderModel: grinderId,
      customGrindValue: start,
      wasPurged: true,
      actualDose: 18,
      actualYield: 36,
      tasteProfile: 'balanced',
      setteMacro: null,
      setteMicro: null,
      sunbeamSetting: null,
      nicheZeroSetting: null,
    };
    const fast = calculateRecommendation({ ...baseShot, actualTime: 12 }, RECIPE, []);
    const slow = calculateRecommendation({ ...baseShot, actualTime: 45 }, RECIPE, []);
    const fastVal = fast.recommendedSetting.customGrindValue;
    const slowVal = slow.recommendedSetting.customGrindValue;
    assert.ok(
      fastVal < start,
      `${grinderId}: fast shot should recommend finer (lower dial), got ${fastVal} from ${start}`
    );
    assert.ok(
      slowVal > start,
      `${grinderId}: slow shot should recommend coarser (higher dial), got ${slowVal} from ${start}`
    );
  }

  const applyUi = uiStateFromRecommendedSetting(BCG820_GRINDER_ID, { customGrindValue: 11 });
  assert.equal(applyUi.customGrindValue, 11);

  for (const grinderId of PRESET_GRINDER_IDS) {
    const spec = getPresetGrinderSpec(grinderId);
    assert.equal(clampPresetGrind(spec.min - 50, spec), spec.min);
    assert.equal(clampPresetGrind(spec.max + 50, spec), spec.max);
    const atMin = adjustPresetGrind(spec.min, -5, spec);
    assert.equal(atMin, spec.min);
    const atMax = adjustPresetGrind(spec.max, 5, spec);
    assert.equal(atMax, spec.max);
  }

  const opusFast = calculateRecommendation(
    {
      grinderModel: FELLOW_OPUS_GRINDER_ID,
      customGrindValue: 1,
      wasPurged: true,
      actualDose: 18,
      actualYield: 36,
      tasteProfile: 'balanced',
    },
    RECIPE,
    []
  );
  assert.ok(opusFast.recommendedSetting.customGrindValue >= 1);

  const bean = { id: 'bean-persist', roastType: 'Medium' };
  const shotAt195 = {
    beanId: bean.id,
    grinderModel: ZERNO_Z1_GRINDER_ID,
    customGrindValue: 195,
    timestamp: '2026-10-01T12:00:00.000Z',
    excludeFromLearning: false,
  };

  for (const grinderId of PRESET_GRINDER_IDS) {
    const spec = getPresetGrinderSpec(grinderId);
    const applied = adjustPresetGrind(spec.defaultSetting, 2, spec);
    const logged = adjustPresetGrind(spec.defaultSetting, -1, spec);
    assert.notEqual(applied, logged);

    let settings = { id: 'global', grinderModel: grinderId };
    settings = {
      ...settings,
      ...persistedPresetGrindSettingsPatch(grinderId, applied, settings),
    };
    assert.equal(getPersistedPresetGrindValue(settings, grinderId), applied);

    const otherId = grinderId === BCG820_GRINDER_ID ? ENCORE_ESP_GRINDER_ID : BCG820_GRINDER_ID;
    const otherSpec = getPresetGrinderSpec(otherId);
    const otherVal = defaultPresetGrindValue(otherSpec);
    settings = {
      ...settings,
      grinderModel: otherId,
      ...persistedPresetGrindSettingsPatch(otherId, otherVal, settings),
    };
    assert.equal(getPersistedPresetGrindValue(settings, otherId), otherVal);
    assert.equal(getPersistedPresetGrindValue(settings, grinderId), applied);

    const patch = persistedSettingsPatchFromRecommendation(
      grinderId,
      { customGrindValue: applied },
      settings
    );
    settings = { ...settings, ...patch };

    const uiAfterApply = resolveGrindControlUiState({
      grinderModel: grinderId,
      shots: [{ ...shotAt195, grinderModel: grinderId, customGrindValue: logged }],
      activeBean: bean,
      recipes: [{ beanId: bean.id, ...RECIPE }],
      beans: [bean],
      mockDate: null,
      flairEnabled: false,
      settings,
    });
    assert.equal(
      uiAfterApply.customGrindValue,
      applied,
      `${grinderId}: persisted apply should beat last logged shot`
    );

    const uiAfterSwitch = resolveGrindControlUiState({
      grinderModel: grinderId,
      shots: [],
      activeBean: bean,
      recipes: [],
      beans: [bean],
      mockDate: null,
      flairEnabled: false,
      settings,
    });
    assert.equal(uiAfterSwitch.customGrindValue, applied, `${grinderId}: reload/switch restore`);
  }

  console.log('Preset grinder tests passed.');
}
