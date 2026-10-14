import assert from 'assert';
import { buildNicheEligibilityCompactCounts, diagnoseNicheLearningEligibility } from './nicheEligibility.js';
import { EUREKA_ZERO_GRINDER_ID } from './presetGrinders/catalog.js';
import { formatGrinderMatchedShotCount } from './grinderRegistry.js';
import {
  EUREKA_ZERO_65_SPEEDY_GRINDER_ID,
  FELLOW_OPUS_GRINDER_ID,
} from './presetGrinders/catalog.js';
import { NICHE_ZERO_GRINDER_ID } from './nicheZero.js';
import { SETTE_GRINDER_ID } from './grinderRegistry.js';

export function runNicheEligibilityTests() {
  const eligibility = {
    counts: { grinderMatched: 25, recipeMatched: 20 },
    observationCount: 3,
    dialSpread: 1.2,
  };

  assert.equal(
    formatGrinderMatchedShotCount(25, EUREKA_ZERO_65_SPEEDY_GRINDER_ID),
    '25 Speedy shots'
  );
  assert.equal(formatGrinderMatchedShotCount(1, FELLOW_OPUS_GRINDER_ID), '1 Opus shot');
  assert.equal(formatGrinderMatchedShotCount(3, SETTE_GRINDER_ID), '3 Sette 270Wi shots');

  const speedyCounts = buildNicheEligibilityCompactCounts(
    eligibility,
    EUREKA_ZERO_65_SPEEDY_GRINDER_ID
  );
  assert.match(speedyCounts, /^25 Speedy shots · 20 match recipe/);
  assert.doesNotMatch(speedyCounts, /Niche shot/i);

  const nicheCounts = buildNicheEligibilityCompactCounts(eligibility, NICHE_ZERO_GRINDER_ID);
  assert.match(nicheCounts, /^25 Niche Zero shots ·/);

  const RECIPE = {
    targetTimeMinS: 27,
    targetTimeMaxS: 32,
    targetDoseG: 18,
    targetYieldG: 36,
  };
  const decimalShots = [
    {
      id: 'e1',
      beanId: 'b',
      grinderModel: EUREKA_ZERO_GRINDER_ID,
      customGrindValue: 25.5,
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
      id: 'e2',
      beanId: 'b',
      grinderModel: EUREKA_ZERO_GRINDER_ID,
      customGrindValue: 23.5,
      actualTimeS: 28,
      actualYieldG: 36,
      targetDoseG: 18,
      targetYieldG: 36,
      targetTimeMinS: 27,
      targetTimeMaxS: 32,
      wasPurged: true,
      timestamp: '2026-01-02',
    },
  ];
  const spreadDiag = diagnoseNicheLearningEligibility({
    shots: decimalShots,
    beanId: 'b',
    grinderModel: EUREKA_ZERO_GRINDER_ID,
    recipe: RECIPE,
  });
  assert.equal(spreadDiag.dialSpread, 2);

  console.log('Niche eligibility tests passed.');
}
