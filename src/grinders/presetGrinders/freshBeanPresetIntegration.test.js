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
import { patchGrindUiForBeanGrinder } from '../grindDialByBean.js';

const RECIPE = {
  targetTimeMinS: 27,
  targetTimeMaxS: 32,
  targetDoseG: 18,
  targetYieldG: 36,
};

export function runFreshBeanPresetIntegrationTests() {
  const beanA = { id: 'bean-a1', roastType: 'Medium' };
  const freshBean = { id: 'fresh-bean-b2', roastType: 'Medium' };
  const recipes = [
    { beanId: beanA.id, ...RECIPE },
    { beanId: freshBean.id, ...RECIPE },
  ];
  const beans = [beanA, freshBean];

  let settings = { id: 'global', grinderModel: EUREKA_ZERO_65_SPEEDY_GRINDER_ID };
  settings = {
    ...settings,
    ...persistedPresetGrindSettingsPatch(EUREKA_ZERO_65_SPEEDY_GRINDER_ID, 4, settings, beanA.id),
  };
  settings = {
    ...settings,
    ...patchGrindUiForBeanGrinder(settings, beanA.id, EUREKA_ZERO_65_SPEEDY_GRINDER_ID, {
      customGrindValue: 50,
    }),
  };

  for (const grinderId of PRESET_GRINDER_IDS) {
    const spec = getPresetGrinderSpec(grinderId);
    const expectedDefault = defaultPresetGrindValue(spec);
    const uiFresh = resolveGrindControlUiStateWithPending({
      pendingGrindByKey: {},
      grinderModel: grinderId,
      shots: [],
      activeBean: freshBean,
      recipes,
      beans,
      mockDate: null,
      flairEnabled: false,
      settings,
    });
    assert.equal(
      uiFresh.customGrindValue,
      expectedDefault,
      `${grinderId}: fresh bean must use catalog default (Speedy leak repro)`
    );
    if (grinderId === EUREKA_ZERO_65_SPEEDY_GRINDER_ID) {
      assert.equal(uiFresh.customGrindValue, 2, 'Zero 65 Speedy fresh bean must be 2.0 default');
    }

    const uiBeanA = resolveGrindControlUiStateWithPending({
      pendingGrindByKey: {},
      grinderModel: EUREKA_ZERO_65_SPEEDY_GRINDER_ID,
      shots: [],
      activeBean: beanA,
      recipes,
      beans,
      mockDate: null,
      flairEnabled: false,
      settings,
    });
    assert.equal(uiBeanA.customGrindValue, 50, 'same bean keeps applied Speedy dial');
  }

  console.log('Fresh bean preset integration tests passed.');
}
