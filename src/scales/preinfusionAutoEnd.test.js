import assert from 'assert';
import {
  preinfusionAutoEndTargets,
  recipeDefinesPreinfusion,
  shouldAutoEndPreinfusion,
} from './preinfusionAutoEnd.js';

export function runPreinfusionAutoEndTests() {
  assert.equal(recipeDefinesPreinfusion({ preinfusionTime: '8' }), true);
  assert.equal(recipeDefinesPreinfusion({ preinfusionPressure: '2' }), true);
  assert.equal(recipeDefinesPreinfusion({}), false);

  const targets = preinfusionAutoEndTargets({ preinfusionTime: '10', peakEndYield: '4' }, true);
  assert.deepEqual(targets, { trigger: 'time', timeS: 10, weightG: null });

  assert.equal(
    shouldAutoEndPreinfusion(targets, { preInfusionElapsedS: 9, liveRelativeWeightG: 1 }),
    false
  );
  assert.equal(
    shouldAutoEndPreinfusion(targets, { preInfusionElapsedS: 10, liveRelativeWeightG: 1 }),
    true
  );
  assert.equal(
    shouldAutoEndPreinfusion(targets, { preInfusionElapsedS: 2, liveRelativeWeightG: 4 }),
    false
  );

  const timeOnly = preinfusionAutoEndTargets({ preinfusionTime: '5' }, true);
  assert.equal(shouldAutoEndPreinfusion(timeOnly, { preInfusionElapsedS: 5, liveRelativeWeightG: 0 }), true);
  assert.equal(shouldAutoEndPreinfusion(timeOnly, { preInfusionElapsedS: 4, liveRelativeWeightG: 99 }), false);

  console.log('Preinfusion auto-end tests passed.');
}
