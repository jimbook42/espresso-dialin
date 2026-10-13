import assert from 'assert';
import {
  preinfusionAutoEndTargets,
  recipeDefinesPreinfusion,
  recipeUsesTimedPreinfusionAutoEnd,
  shouldAutoEndPreinfusion,
} from './preinfusionAutoEnd.js';

export function runPreinfusionAutoEndTests() {
  assert.equal(recipeDefinesPreinfusion({ preinfusionTime: '8' }), true);
  assert.equal(recipeDefinesPreinfusion({ preinfusionPressure: '2' }), true);
  assert.equal(recipeDefinesPreinfusion({}), false);

  const legacy = preinfusionAutoEndTargets({ preinfusionTime: '10', peakEndYield: '4' }, { scaleConnected: true });
  assert.deepEqual(legacy, { trigger: 'manual', timeS: null, weightG: null });

  const targets = preinfusionAutoEndTargets(
    { preinfusionTime: '10', preinfusionEndTrigger: 'time' },
    { scaleConnected: false }
  );
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

  assert.equal(
    recipeUsesTimedPreinfusionAutoEnd(
      { preinfusionTime: '5', preinfusionEndTrigger: 'time' },
      true,
      { scaleFeatureEnabled: false, scaleConnected: false }
    ),
    true
  );

  const timeOnly = preinfusionAutoEndTargets(
    { preinfusionTime: '5', preinfusionEndTrigger: 'time' },
    { scaleConnected: true }
  );
  assert.equal(shouldAutoEndPreinfusion(timeOnly, { preInfusionElapsedS: 5, liveRelativeWeightG: 0 }), true);
  assert.equal(shouldAutoEndPreinfusion(timeOnly, { preInfusionElapsedS: 4, liveRelativeWeightG: 99 }), false);

  console.log('Preinfusion auto-end tests passed.');
}
