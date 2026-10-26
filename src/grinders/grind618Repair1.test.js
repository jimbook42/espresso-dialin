import assert from 'assert';
import { diagnoseNicheLearningEligibility } from './nicheEligibility.js';
import {
  EUREKA_ZERO_GRINDER_ID,
  EUREKA_SPECIALITA_GRINDER_ID,
  EUREKA_ZERO_55S_GRINDER_ID,
  EUREKA_ZERO_65_AP_GRINDER_ID,
  EUREKA_ZERO_65_SPEEDY_GRINDER_ID,
  ENCORE_ESP_GRINDER_ID,
  PRESET_GRINDER_IDS,
} from './presetGrinders/catalog.js';
import { calculateRecommendation } from '../utils/grinderLogic.js';
import { defaultPresetGrindValue } from './presetGrinders/dial.js';
import { getPresetGrinderSpec } from './presetGrinders/catalog.js';
import { maxQuantitativeShiftSteps } from '../utils/grindShiftDamping.js';
import { getRecommendationGrinderProfile } from './grinderRegistry.js';
import { resolveRecommendationFollowedForSave } from '../utils/recommendationFollowed.js';
import { NICHE_ZERO_GRINDER_ID } from './nicheZero.js';

const RECIPE = {
  targetTimeMinS: 27,
  targetTimeMaxS: 32,
  targetDoseG: 18,
  targetYieldG: 36,
};

function recipeShot(grinderId, customGrindValue, timeS, id) {
  return {
    id,
    beanId: 'b',
    grinderModel: grinderId,
    customGrindValue,
    actualTimeS: timeS,
    actualYieldG: 36,
    targetDoseG: 18,
    targetYieldG: 36,
    targetTimeMinS: 27,
    targetTimeMaxS: 32,
    tasteProfile: 'balanced',
    wasPurged: true,
    timestamp: `2026-01-0${id}T12:00:00.000Z`,
  };
}

export function runGrind618Repair1Tests() {
  const zeroDecimal = diagnoseNicheLearningEligibility({
    shots: [recipeShot(EUREKA_ZERO_GRINDER_ID, 25.5, 30, '1'), recipeShot(EUREKA_ZERO_GRINDER_ID, 23.5, 28, '2')],
    beanId: 'b',
    grinderModel: EUREKA_ZERO_GRINDER_ID,
    recipe: RECIPE,
    currentObservation: { customGrindValue: 25.5, actualTimeS: 30 },
  });
  assert.equal(zeroDecimal.dialSpread, 2);

  const zeroSingle = diagnoseNicheLearningEligibility({
    shots: [recipeShot(EUREKA_ZERO_GRINDER_ID, 0, 12, '1')],
    beanId: 'b',
    grinderModel: EUREKA_ZERO_GRINDER_ID,
    recipe: RECIPE,
    currentObservation: { customGrindValue: 0, actualTimeS: 12 },
  });
  assert.equal(zeroSingle.dialSpread, 0);

  const speedySingle = diagnoseNicheLearningEligibility({
    shots: [recipeShot(EUREKA_ZERO_65_SPEEDY_GRINDER_ID, 50, 45, '1')],
    beanId: 'b',
    grinderModel: EUREKA_ZERO_65_SPEEDY_GRINDER_ID,
    recipe: RECIPE,
    currentObservation: { customGrindValue: 50, actualTimeS: 45 },
  });
  assert.equal(speedySingle.dialSpread, 0);

  for (const grinderId of [
    EUREKA_SPECIALITA_GRINDER_ID,
    EUREKA_ZERO_55S_GRINDER_ID,
    EUREKA_ZERO_65_AP_GRINDER_ID,
    EUREKA_ZERO_65_SPEEDY_GRINDER_ID,
  ]) {
    const diag = diagnoseNicheLearningEligibility({
      shots: [recipeShot(grinderId, 25, 30, '1'), recipeShot(grinderId, 23, 28, '2')],
      beanId: 'b',
      grinderModel: grinderId,
      recipe: RECIPE,
    });
    assert.equal(diag.dialSpread, 2, `${grinderId} spread`);
  }

  const nicheDiag = diagnoseNicheLearningEligibility({
    shots: [
      {
        id: 'n1',
        beanId: 'b',
        grinderModel: NICHE_ZERO_GRINDER_ID,
        nicheZeroSetting: 25,
        actualTimeS: 30,
        actualYieldG: 36,
        targetDoseG: 18,
        targetYieldG: 36,
        targetTimeMinS: 27,
        targetTimeMaxS: 32,
        wasPurged: true,
        timestamp: '2026-01-01',
      },
      {
        id: 'n2',
        beanId: 'b',
        grinderModel: NICHE_ZERO_GRINDER_ID,
        nicheZeroSetting: 23,
        actualTimeS: 28,
        actualYieldG: 36,
        targetDoseG: 18,
        targetYieldG: 36,
        targetTimeMinS: 27,
        targetTimeMaxS: 32,
        wasPurged: true,
        timestamp: '2026-01-02',
      },
    ],
    beanId: 'b',
    grinderModel: NICHE_ZERO_GRINDER_ID,
    recipe: RECIPE,
  });
  assert.equal(nicheDiag.dialSpread, 2);

  const encoreSpec = getPresetGrinderSpec(ENCORE_ESP_GRINDER_ID);
  const encoreStart = 11;
  const encoreMax = maxQuantitativeShiftSteps(getRecommendationGrinderProfile(ENCORE_ESP_GRINDER_ID));
  assert.equal(encoreMax, 3);
  for (const time of [12, 45]) {
    const rec = calculateRecommendation(
      {
        grinderModel: ENCORE_ESP_GRINDER_ID,
        customGrindValue: encoreStart,
        wasPurged: true,
        actualTime: time,
        actualYield: 36,
        tasteProfile: 'balanced',
      },
      RECIPE,
      []
    );
    assert.ok(
      Math.abs(rec.engineStats.shift) <= encoreMax,
      `Encore shift ${rec.engineStats.shift} exceeds cap ${encoreMax}`
    );
  }

  for (const grinderId of PRESET_GRINDER_IDS) {
    const spec = getPresetGrinderSpec(grinderId);
    const maxShift = maxQuantitativeShiftSteps(getRecommendationGrinderProfile(grinderId));
    const start = defaultPresetGrindValue(spec);
    for (const time of [12, 45]) {
      const rec = calculateRecommendation(
        {
          grinderModel: grinderId,
          customGrindValue: start,
          wasPurged: true,
          actualTime: time,
          actualYield: 36,
          tasteProfile: 'balanced',
        },
        RECIPE,
        []
      );
      assert.ok(
        Math.abs(rec.engineStats.shift) <= maxShift,
        `${grinderId} @ ${time}s: shift ${rec.engineStats.shift} > cap ${maxShift}`
      );
    }
  }

  const bean = { id: 'b', roastDate: '2026-01-01', storageType: 'bag' };
  const lastShot = {
    grinderModel: NICHE_ZERO_GRINDER_ID,
    recommendation: { recommendedSetting: { nicheZeroSetting: 23 }, reason: 'test' },
    beanAgeDays: 5,
  };
  const followed = resolveRecommendationFollowedForSave({
    displayedRecommendation: lastShot.recommendation,
    grinderModel: NICHE_ZERO_GRINDER_ID,
    savedGrind: { nicheZeroSetting: 23 },
  });
  assert.equal(followed, true);

  console.log('Grind 6.18 repair 1 tests passed.');
}
