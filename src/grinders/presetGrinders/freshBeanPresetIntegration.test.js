import assert from 'assert';
import {
  BCG820_GRINDER_ID,
  EUREKA_ZERO_65_SPEEDY_GRINDER_ID,
  PRESET_GRINDER_IDS,
  getPresetGrinderSpec,
} from './catalog.js';
import { defaultPresetGrindValue } from './dial.js';
import { persistedPresetGrindSettingsPatch } from './presetGrindPersistence.js';
import { resolveGrindControlUiStateWithPending } from '../pendingGrindSession.js';

const RECIPE = {
  targetTimeMinS: 27,
  targetTimeMaxS: 32,
  targetDoseG: 18,
  targetYieldG: 36,
};

/**
 * QA repro: log on Zero 65 Speedy (2→4), fresh bean, cycle presets — each must use
 * its own default or its own presetGrindByModel entry, never global lastPresetGrindValue.
 */
export function runFreshBeanPresetIntegrationTests() {
  const beanA = { id: 'bean-a', roastType: 'Medium' };
  const freshBean = { id: 'fresh-bean-c', roastType: 'Medium' };
  const recipes = [
    { beanId: beanA.id, ...RECIPE },
    { beanId: freshBean.id, ...RECIPE },
  ];
  const beans = [beanA, freshBean];

  const loggedSpeedyShot = {
    beanId: beanA.id,
    grinderModel: EUREKA_ZERO_65_SPEEDY_GRINDER_ID,
    customGrindValue: 4,
    actualTimeS: 45,
    actualYieldG: 36,
    tasteProfile: 'balanced',
    targetTimeMinS: 27,
    targetTimeMaxS: 32,
    timestamp: '2026-10-14T12:00:00.000Z',
    excludeFromLearning: false,
  };

  let settings = {
    id: 'global',
    grinderModel: EUREKA_ZERO_65_SPEEDY_GRINDER_ID,
    lastPresetGrindValue: 4,
    lastCustomGrindValue: 4,
  };
  settings = {
    ...settings,
    ...persistedPresetGrindSettingsPatch(EUREKA_ZERO_65_SPEEDY_GRINDER_ID, 4, settings),
  };
  assert.equal(settings.presetGrindByModel[EUREKA_ZERO_65_SPEEDY_GRINDER_ID], 4);
  assert.equal(settings.lastPresetGrindValue, null);

  const pollutedOnlyGlobals = {
    id: 'global',
    grinderModel: BCG820_GRINDER_ID,
    lastPresetGrindValue: 4,
    lastCustomGrindValue: 4,
  };

  for (const grinderId of PRESET_GRINDER_IDS) {
    const spec = getPresetGrinderSpec(grinderId);
    const expectedDefault = defaultPresetGrindValue(spec);
    const uiPolluted = resolveGrindControlUiStateWithPending({
      pendingGrindByKey: {},
      grinderModel: grinderId,
      shots: [],
      activeBean: freshBean,
      recipes,
      beans,
      mockDate: null,
      flairEnabled: false,
      settings: pollutedOnlyGlobals,
    });
    assert.equal(
      uiPolluted.customGrindValue,
      expectedDefault,
      `${grinderId}: must ignore global lastPresetGrindValue on fresh bean`
    );

    const expectedAfterLog =
      grinderId === EUREKA_ZERO_65_SPEEDY_GRINDER_ID ? 4 : expectedDefault;
    const uiAfterLog = resolveGrindControlUiStateWithPending({
      pendingGrindByKey: {},
      grinderModel: grinderId,
      shots: [loggedSpeedyShot],
      activeBean: freshBean,
      recipes,
      beans,
      mockDate: null,
      flairEnabled: false,
      settings,
    });
    assert.equal(
      uiAfterLog.customGrindValue,
      expectedAfterLog,
      `${grinderId}: after Speedy log, fresh bean dial must be default or own map entry only`
    );
  }

  const pendingLeak = {
    [`${freshBean.id}::${BCG820_GRINDER_ID}`]: { customGrindValue: 20 },
  };
  const uiEncore = resolveGrindControlUiStateWithPending({
    pendingGrindByKey: pendingLeak,
    grinderModel: 'Baratza Encore ESP',
    shots: [],
    activeBean: freshBean,
    recipes,
    beans,
    mockDate: null,
    flairEnabled: false,
    settings: pollutedOnlyGlobals,
  });
  assert.equal(
    uiEncore.customGrindValue,
    defaultPresetGrindValue(getPresetGrinderSpec('Baratza Encore ESP')),
    'pending grind must be keyed per grinder, not bleed to Encore'
  );

  console.log('Fresh bean preset integration tests passed.');
}
