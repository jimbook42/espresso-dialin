import assert from 'assert';
import { calculateRecommendation } from '../utils/grinderLogic.js';
import { PRESET_GRINDER_IDS, getPresetGrinderSpec } from './presetGrinders/catalog.js';
import { defaultPresetGrindValue } from './presetGrinders/dial.js';
import { maxQuantitativeShiftSteps } from '../utils/grindShiftDamping.js';
import { diagnoseNicheLearningEligibility } from './nicheEligibility.js';
import { EUREKA_ZERO_GRINDER_ID } from './presetGrinders/catalog.js';
import { getRecommendationGrinderProfile } from './grinderRegistry.js';

const RECIPE = {
  targetTimeMinS: 27,
  targetTimeMaxS: 32,
  targetDoseG: 18,
  targetYieldG: 36,
};

function shotRow(grinderId, customGrindValue, timeS, id) {
  return {
    id,
    beanId: 'bean-618',
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

export function runPresetGrinderShiftSanity618Tests() {
  const sanityResults = [];

  for (const grinderId of PRESET_GRINDER_IDS) {
    const spec = getPresetGrinderSpec(grinderId);
    const start = defaultPresetGrindValue(spec);
    const profile = getRecommendationGrinderProfile(grinderId);
    const maxShift = maxQuantitativeShiftSteps(profile);
    const history = [
      shotRow(grinderId, start, 30, '1'),
      shotRow(grinderId, start + spec.step, 28, '2'),
    ];

    for (const actualTime of [12, 45]) {
      const rec = calculateRecommendation(
        {
          grinderModel: grinderId,
          customGrindValue: start,
          wasPurged: true,
          actualTime,
          actualYield: 36,
          tasteProfile: 'balanced',
          beanId: 'bean-618',
        },
        RECIPE,
        history
      );
      const shift = Math.abs(rec.engineStats?.shift ?? 0);
      assert.ok(
        shift <= maxShift,
        `${grinderId} @ ${actualTime}s: shift ${shift} exceeds cap ${maxShift}`
      );
      sanityResults.push({ grinderId, actualTime, shift, maxShift });
    }
  }

  const eurekaDiag = diagnoseNicheLearningEligibility({
    shots: [
      shotRow(EUREKA_ZERO_GRINDER_ID, 25.5, 30, 'a'),
      shotRow(EUREKA_ZERO_GRINDER_ID, 23.5, 28, 'b'),
    ],
    beanId: 'bean-618',
    grinderModel: EUREKA_ZERO_GRINDER_ID,
    recipe: RECIPE,
  });
  assert.equal(eurekaDiag.dialSpread, 2);
  assert.equal(eurekaDiag.counts.validDialTime, 2);

  console.log('Preset grinder shift sanity (6.18):', sanityResults);
  console.log('Preset grinder shift sanity 6.18 tests passed.');
}
