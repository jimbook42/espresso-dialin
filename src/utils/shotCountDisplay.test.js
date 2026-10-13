import assert from 'assert';
import {
  getRecommendationEvidenceContext,
  recomputeNicheRecommendationFromLastShot,
  CURRENT_PULL_ELIGIBILITY_ID,
} from './grinderLogic.js';
import { buildNicheLearningTransparencyNote } from '../grinders/nicheZeroLearning.js';
import { NICHE_ZERO_GRINDER_ID } from '../grinders/nicheZero.js';

const BASE_RECIPE = { targetTimeMinS: 27, targetTimeMaxS: 32, targetYieldG: 36, targetDoseG: 18 };

function nicheShot(overrides = {}) {
  return {
    grinderModel: NICHE_ZERO_GRINDER_ID,
    beanId: 'b1',
    timestamp: '2026-09-20T12:00:00.000Z',
    actualDoseG: 18,
    actualYieldG: 36,
    actualTimeS: 30,
    nicheZeroSetting: 15,
    excludeFromLearning: false,
    ...overrides,
  };
}

export function runShotCountDisplayTests() {
  const note = buildNicheLearningTransparencyNote(
    'insufficient_observations',
    { observationCount: 2 },
    { recipeComparableCount: 1, grinderLearningShotCount: 1 }
  );
  assert.match(note, /you have 1\./);
  assert.doesNotMatch(note, /you have 2\./);

  const oneLogged = [
    nicheShot({ id: 'only', timestamp: '2026-09-20T12:00:00.000Z', nicheZeroSetting: 14, actualTimeS: 28 }),
  ];
  const liveOne = recomputeNicheRecommendationFromLastShot(oneLogged[0], BASE_RECIPE, oneLogged, false);
  assert.match(liveOne.evidenceContext, /Based on recent shots/);

  const threeLogged = [
    nicheShot({ id: 'a', timestamp: '2026-09-22T12:00:00.000Z', nicheZeroSetting: 14, actualTimeS: 28 }),
    nicheShot({ id: 'b', timestamp: '2026-09-21T12:00:00.000Z', nicheZeroSetting: 15, actualTimeS: 30 }),
    nicheShot({ id: 'c', timestamp: '2026-09-20T12:00:00.000Z', nicheZeroSetting: 16, actualTimeS: 33 }),
  ];
  const liveThree = recomputeNicheRecommendationFromLastShot(
    threeLogged[0],
    BASE_RECIPE,
    threeLogged,
    false
  );
  assert.equal(liveThree.evidenceContext, 'Based on 3 recent shots with this recipe');

  const fourComparable = [
    nicheShot({ id: 'd1', timestamp: '2026-09-25T12:00:00.000Z', nicheZeroSetting: 14, actualTimeS: 28 }),
    nicheShot({ id: 'd2', timestamp: '2026-09-24T12:00:00.000Z', nicheZeroSetting: 15, actualTimeS: 30 }),
    nicheShot({ id: 'd3', timestamp: '2026-09-23T12:00:00.000Z', nicheZeroSetting: 16, actualTimeS: 33 }),
    nicheShot({ id: 'd4', timestamp: '2026-09-22T12:00:00.000Z', nicheZeroSetting: 17, actualTimeS: 35 }),
  ];
  assert.equal(
    getRecommendationEvidenceContext(fourComparable, BASE_RECIPE, false),
    'Based on 4 recent shots with this recipe'
  );

  assert.equal(CURRENT_PULL_ELIGIBILITY_ID, '__current_pull__');

  console.log('Shot count display tests passed.');
}
