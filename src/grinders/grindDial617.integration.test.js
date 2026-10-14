import assert from 'assert';
import { SETTE_GRINDER_ID, NICHE_ZERO_GRINDER_ID, persistedSettingsPatchFromRecommendation } from './grinderRegistry.js';
import { resolveGrindControlUiStateWithPending } from './pendingGrindSession.js';
import { patchGrindUiForBeanGrinder } from './grindDialByBean.js';
import {
  PRESET_GRINDER_IDS,
  ENCORE_ESP_GRINDER_ID,
  EUREKA_SPECIALITA_GRINDER_ID,
  EUREKA_ZERO_GRINDER_ID,
  EUREKA_ZERO_55S_GRINDER_ID,
  EUREKA_ZERO_65_AP_GRINDER_ID,
  EUREKA_ZERO_65_SPEEDY_GRINDER_ID,
  FELLOW_OPUS_2_GRINDER_ID,
  ZERNO_Z1_GRINDER_ID,
  getPresetGrinderSpec,
} from './presetGrinders/catalog.js';
import { getAgeAdjustedRecommendation, recomputeReferenceLearningRecommendationFromLastShot } from '../utils/grinderLogic.js';
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

  const dialEndGrinders = [
    ...[
      EUREKA_SPECIALITA_GRINDER_ID,
      EUREKA_ZERO_GRINDER_ID,
      EUREKA_ZERO_55S_GRINDER_ID,
      EUREKA_ZERO_65_AP_GRINDER_ID,
      EUREKA_ZERO_65_SPEEDY_GRINDER_ID,
    ],
    FELLOW_OPUS_2_GRINDER_ID,
    ZERNO_Z1_GRINDER_ID,
  ];

  for (const grinderId of dialEndGrinders) {
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
    assert.ok(
      dialBoundaryAdvisoryForRecommendation(grinderId, atMin),
      `${grinderId} at min should trigger dial boundary advisory`
    );
    const minSummary = formatGrindRecommendationSummary(grinderId, atMin);
    assert.match(minSummary, /finest end of the dial/i);
    assert.match(minSummary, /dose or yield/i);
    assert.doesNotMatch(minSummary, /Grind finer/i);

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
    assert.ok(
      dialBoundaryAdvisoryForRecommendation(grinderId, atMax),
      `${grinderId} at max should trigger dial boundary advisory`
    );
    const maxSummary = formatGrindRecommendationSummary(grinderId, atMax);
    assert.match(maxSummary, /coarsest end of the dial/i);
    assert.match(maxSummary, /dose or yield/i);
    assert.doesNotMatch(maxSummary, /Grind coarser/i);
  }

  const eurekaZeroMinRec = calculateRecommendation(
    {
      grinderModel: EUREKA_ZERO_GRINDER_ID,
      customGrindValue: 0,
      wasPurged: true,
      actualTime: 12,
      actualYield: 36,
      tasteProfile: 'balanced',
    },
    RECIPE,
    []
  );
  const ageBean = { id: 'bean-age', roastDate: '2026-01-01' };
  const eurekaShot = {
    id: 'shot-eureka',
    beanId: ageBean.id,
    grinderModel: EUREKA_ZERO_GRINDER_ID,
    customGrindValue: 0,
    wasPurged: true,
    actualTimeS: 12,
    actualYieldG: 36,
    tasteProfile: 'balanced',
    beanAgeDays: 5,
    recommendation: eurekaZeroMinRec,
  };
  const ageAdjusted = getAgeAdjustedRecommendation(eurekaShot, ageBean);
  const ageSummary = formatGrindRecommendationSummary(EUREKA_ZERO_GRINDER_ID, ageAdjusted);
  assert.match(ageSummary, /finest end of the dial/i);

  const liveFromShot = recomputeReferenceLearningRecommendationFromLastShot(
    eurekaShot,
    RECIPE,
    [eurekaShot]
  );
  assert.match(
    formatGrindRecommendationSummary(EUREKA_ZERO_GRINDER_ID, liveFromShot),
    /finest end of the dial/i
  );

  console.log('Grind dial 6.17 integration tests passed.');
}
