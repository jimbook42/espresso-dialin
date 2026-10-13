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

  const targets = preinfusionAutoEndTargets({ preinfusionTime: '10', peakEndYield: '4' });
  assert.deepEqual(targets, { timeS: 10, weightG: 4 });

  assert.equal(
    shouldAutoEndPreinfusion(targets, { preInfusionElapsedS: 9, liveWeightG: 1 }),
    false
  );
  assert.equal(
    shouldAutoEndPreinfusion(targets, { preInfusionElapsedS: 10, liveWeightG: 1 }),
    true
  );
  assert.equal(
    shouldAutoEndPreinfusion(targets, { preInfusionElapsedS: 2, liveWeightG: 4 }),
    true
  );

  const timeOnly = preinfusionAutoEndTargets({ preinfusionTime: '5' });
  assert.equal(shouldAutoEndPreinfusion(timeOnly, { preInfusionElapsedS: 5, liveWeightG: 0 }), true);
  assert.equal(shouldAutoEndPreinfusion(timeOnly, { preInfusionElapsedS: 4, liveWeightG: 99 }), false);

  console.log('Preinfusion auto-end tests passed.');
}
