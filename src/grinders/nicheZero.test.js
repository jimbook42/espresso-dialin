import assert from 'assert';
import {
  NICHE_ZERO_GRINDER_ID,
  NICHE_ZERO_DEFAULT_SETTING,
  parseNicheZeroSetting,
  formatNicheZeroSetting,
} from './nicheZero.js';
import {
  getGrinderDefinitionById,
  getRecommendationGrinderProfile,
  GRINDER_SETUP_OPTIONS,
  isNicheZeroGrinderModel,
  grinderSupportsQuantitativeRecommendations,
} from './grinderRegistry.js';
import { calculateRecommendation } from '../utils/grinderLogic.js';

const BASE_RECIPE = { targetTimeMinS: 27, targetTimeMaxS: 32, targetYieldG: 36, targetDoseG: 18 };

export function runNicheZeroTests() {
  assert.equal(NICHE_ZERO_GRINDER_ID, 'Niche Zero');
  assert.equal(parseNicheZeroSetting('14.5'), 14.5);
  assert.equal(parseNicheZeroSetting(51), null);
  assert.equal(formatNicheZeroSetting(15), '15');

  const def = getGrinderDefinitionById(NICHE_ZERO_GRINDER_ID);
  assert.ok(def);
  assert.equal(def.controlType, 'nicheZero');
  assert.equal(def.supportsQuantitativeRecommendations, false);
  assert.equal(isNicheZeroGrinderModel(NICHE_ZERO_GRINDER_ID), true);
  assert.equal(GRINDER_SETUP_OPTIONS.some((o) => o.id === NICHE_ZERO_GRINDER_ID), true);

  assert.equal(getRecommendationGrinderProfile('Unknown Grinder').sensitivity, 4.5);
  assert.equal(getRecommendationGrinderProfile(NICHE_ZERO_GRINDER_ID).supportsQuantitativeRecommendations, false);
  assert.equal(grinderSupportsQuantitativeRecommendations(NICHE_ZERO_GRINDER_ID), false);

  const rec = calculateRecommendation(
    {
      grinderModel: NICHE_ZERO_GRINDER_ID,
      nicheZeroSetting: 15,
      setteMacro: null,
      setteMicro: null,
      sunbeamSetting: null,
      wasPurged: true,
      actualTime: 24,
      actualDose: 18,
      actualYield: 36,
      tasteProfile: 'sour',
    },
    BASE_RECIPE
  );
  assert.equal(rec.recommendedSetting.nicheZeroSetting, 15);
  assert.equal(rec.engineStats.shift, 0);
  assert.equal(rec.engineStats.sensitivity, null);
  assert.match(rec.reason, /not auto-calibrated/i);
  assert.doesNotMatch(rec.reason, /GO \d+ SETTING/i);

  const setteRec = calculateRecommendation(
    {
      grinderModel: 'Sette 270Wi',
      setteMacro: 13,
      setteMicro: 'E',
      wasPurged: true,
      actualTime: 24,
      actualDose: 18,
      actualYield: 36,
      tasteProfile: 'sour',
    },
    BASE_RECIPE
  );
  assert.match(setteRec.reason, /FINER/i);

  console.log('Niche Zero tests passed.');
}
