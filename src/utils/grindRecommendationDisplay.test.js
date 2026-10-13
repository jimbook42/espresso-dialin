import assert from 'assert';
import { formatGrindRecommendationSummary } from './grindRecommendationDisplay.js';

export function runGrindRecommendationDisplayTests() {
  const rec = {
    recommendedSetting: { macro: 14, micro: 'A' },
    reason: 'GO 2 MICRO STEP(S) FINER — Shot was 4s off target midpoint.',
  };
  const summary = formatGrindRecommendationSummary('Sette 270Wi', rec);
  assert.match(summary, /Grind finer/i);
  assert.match(summary, /4s off target/i);
  assert.match(summary, /14-A/);

  const keep = formatGrindRecommendationSummary('Sette 270Wi', {
    recommendedSetting: { macro: 13, micro: 'E' },
    reason: 'KEEP GRIND — Balanced and in range.',
  });
  assert.match(keep, /Keep the same grind/i);
  assert.match(keep, /13-E/);

  console.log('Grind recommendation display tests passed.');
}
