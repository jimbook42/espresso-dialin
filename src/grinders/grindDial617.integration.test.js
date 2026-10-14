import assert from 'assert';
import { SETTE_GRINDER_ID, NICHE_ZERO_GRINDER_ID, persistedSettingsPatchFromRecommendation } from './grinderRegistry.js';
import { resolveGrindControlUiStateWithPending } from './pendingGrindSession.js';
import { patchGrindUiForBeanGrinder } from './grindDialByBean.js';
import { PRESET_GRINDER_IDS, ENCORE_ESP_GRINDER_ID, getPresetGrinderSpec } from './presetGrinders/catalog.js';
import { adjustPresetGrind, defaultPresetGrindValue } from './presetGrinders/dial.js';
import { calculateRecommendation } from '../utils/grinderLogic.js';
import { formatGrindRecommendationSummary } from '../utils/grindRecommendationDisplay.js';
import { dialBoundaryAdvisoryForRecommendation } from './dialBoundaryAdvisory.js';
import { normalizeCustomGrinderProfile } from './customGrinder.js';

const RECIPE = {
  targetTimeMinS: 27,
  targetTimeMaxS: 32,
  targetDoseG: 18,
  targetYieldG: 36,
};

function settingsAfterApply(grinderModel, recSet, beanId, base = { id: 'global' }) {
  const patch = persistedSettingsPatchFromRecommendation(grinderModel, recSet, base, beanId);
  return { ...base, customGrinder: base.customGrinder, ...patch };
}

export function runGrindDial617IntegrationTests() {
  const bean = { id: 'bean-reload', roastType: 'Medium' };
  const recipes = [{ beanId: bean.id, ...RECIPE }];
  const beans = [bean];

  const nichePatch = settingsAfterApply(
    NICHE_ZERO_GRINDER_ID,
    { nicheZeroSetting: 17 },
    bean.id
  );
  const nicheUi = resolveGrindControlUiStateWithPending({
    pendingGrindByKey: {},
    grinderModel: NICHE_ZERO_GRINDER_ID,
    shots: [],
    activeBean: bean,
    recipes,
    beans,
    mockDate: null,
    flairEnabled: false,
    settings: nichePatch,
  });
  assert.equal(nicheUi.nicheZeroSetting, 17);

  const settePatch = settingsAfterApply(
    SETTE_GRINDER_ID,
    { macro: 15, micro: 'C' },
    bean.id
  );
  const setteUi = resolveGrindControlUiStateWithPending({
    pendingGrindByKey: {},
    grinderModel: SETTE_GRINDER_ID,
    shots: [],
    activeBean: bean,
    recipes,
    beans,
    mockDate: null,
    flairEnabled: false,
    settings: settePatch,
  });
  assert.equal(setteUi.setteMacro, 15);
  assert.equal(setteUi.setteMicro, 'C');

  const customProfile = normalizeCustomGrinderProfile({
    name: 'DF64',
    dialType: 'stepped',
    min: 1,
    max: 20,
    step: 1,
    lowerIsFiner: true,
  });
  let customSettings = {
    id: 'global',
    grinderModel: 'DF64',
    customGrinder: customProfile,
  };
  customSettings = settingsAfterApply(
    'DF64',
    { customGrindValue: 20 },
    bean.id,
    customSettings
  );
  assert.ok(customSettings.customGrinder?.name === 'DF64');
  const customUi = resolveGrindControlUiStateWithPending({
    pendingGrindByKey: {},
    grinderModel: 'DF64',
    shots: [],
    activeBean: bean,
    recipes,
    beans,
    mockDate: null,
    flairEnabled: false,
    settings: customSettings,
  });
  assert.equal(customUi.customGrindValue, 20);

  for (const grinderId of PRESET_GRINDER_IDS) {
    const spec = getPresetGrinderSpec(grinderId);
    const applied = adjustPresetGrind(spec.defaultSetting, 2, spec);
    const settings = settingsAfterApply(
      grinderId,
      { customGrindValue: applied },
      bean.id
    );
    const ui = resolveGrindControlUiStateWithPending({
      pendingGrindByKey: {},
      grinderModel: grinderId,
      shots: [],
      activeBean: bean,
      recipes,
      beans,
      mockDate: null,
      flairEnabled: false,
      settings,
    });
    assert.equal(ui.customGrindValue, applied, `${grinderId} reload apply`);
  }

  const encoreSpec = getPresetGrinderSpec(ENCORE_ESP_GRINDER_ID);
  const encoreMax = encoreSpec.max;
  const encoreRec = calculateRecommendation(
    {
      grinderModel: ENCORE_ESP_GRINDER_ID,
      customGrindValue: encoreMax,
      wasPurged: true,
      actualTime: 45,
      actualYield: 36,
      tasteProfile: 'balanced',
    },
    RECIPE,
    []
  );
  assert.ok(dialBoundaryAdvisoryForRecommendation(ENCORE_ESP_GRINDER_ID, encoreRec));
  const encoreSummary = formatGrindRecommendationSummary(ENCORE_ESP_GRINDER_ID, encoreRec);
  assert.match(encoreSummary, /coarsest end of the dial/i);
  assert.doesNotMatch(encoreSummary, /Grind coarser/i);

  for (const grinderId of PRESET_GRINDER_IDS) {
    const spec = getPresetGrinderSpec(grinderId);
    const atMin = calculateRecommendation(
      {
        grinderModel: grinderId,
        customGrindValue: spec.min,
        wasPurged: true,
        actualTime: 12,
        actualYield: 36,
        tasteProfile: 'balanced',
      },
      RECIPE,
      []
    );
    if (dialBoundaryAdvisoryForRecommendation(grinderId, atMin)) {
      const summary = formatGrindRecommendationSummary(grinderId, atMin);
      assert.match(summary, /finest end of the dial/i);
    }
    const atMax = calculateRecommendation(
      {
        grinderModel: grinderId,
        customGrindValue: spec.max,
        wasPurged: true,
        actualTime: 45,
        actualYield: 36,
        tasteProfile: 'balanced',
      },
      RECIPE,
      []
    );
    if (dialBoundaryAdvisoryForRecommendation(grinderId, atMax)) {
      const summary = formatGrindRecommendationSummary(grinderId, atMax);
      assert.match(summary, /coarsest end of the dial/i);
    }
  }

  console.log('Grind dial 6.17 integration tests passed.');
}
