import assert from 'assert';
import { buildNicheEligibilityCompactCounts } from './nicheEligibility.js';
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

  console.log('Niche eligibility tests passed.');
}
