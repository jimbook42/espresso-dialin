import assert from 'assert';
import {
  flairProfileMarkerProgress,
  preinfusionAutoEndTargets,
  recipeDefinesPreinfusion,
  resolvePreinfusionEndTrigger,
  resolveTaperStartTrigger,
  shouldAutoEndPreinfusion,
} from './flairScaleTriggers.js';

export function runFlairScaleTriggerTests() {
  const legacyProfile = {
    preinfusionPressure: '2',
    preinfusionTime: '10',
    peakPressure: '9',
    peakEndYield: '4',
    taperPressure: '6',
  };

  assert.equal(resolvePreinfusionEndTrigger(legacyProfile, false), 'manual');
  assert.equal(resolvePreinfusionEndTrigger(legacyProfile, true), 'time');
  assert.equal(resolveTaperStartTrigger(legacyProfile), 'weight');

  const legacyTargets = preinfusionAutoEndTargets(legacyProfile, true);
  assert.deepEqual(legacyTargets, { trigger: 'time', timeS: 10, weightG: null });
  assert.equal(
    shouldAutoEndPreinfusion(legacyTargets, { preInfusionElapsedS: 10, liveRelativeWeightG: 99 }),
    true
  );
  assert.equal(
    shouldAutoEndPreinfusion(legacyTargets, { preInfusionElapsedS: 9, liveRelativeWeightG: 99 }),
    false
  );
  assert.equal(
    shouldAutoEndPreinfusion(legacyTargets, { preInfusionElapsedS: 2, liveRelativeWeightG: 4 }),
    false
  );

  const weightEnd = preinfusionAutoEndTargets(
    { ...legacyProfile, preinfusionEndTrigger: 'weight', preinfusionEndWeightG: '3' },
    true
  );
  assert.equal(shouldAutoEndPreinfusion(weightEnd, { preInfusionElapsedS: 1, liveRelativeWeightG: 2.9 }), false);
  assert.equal(shouldAutoEndPreinfusion(weightEnd, { preInfusionElapsedS: 1, liveRelativeWeightG: 3 }), true);

  const manual = preinfusionAutoEndTargets({ ...legacyProfile, preinfusionEndTrigger: 'manual' }, true);
  assert.equal(shouldAutoEndPreinfusion(manual, { preInfusionElapsedS: 99, liveRelativeWeightG: 99 }), false);

  const built = { preDur: 10, rampDur: 4, taperDur: 8, totalSec: 44 };
  const timerOnly = flairProfileMarkerProgress(built, {
    timerProgress: 0.5,
    scaleConnected: false,
    profile: legacyProfile,
    extractionElapsedS: 20,
    liveRelativeWeightG: 10,
    targetTimeMaxS: 32,
  });
  assert.equal(timerOnly, 0.5);

  const beforeTaperWeight = flairProfileMarkerProgress(built, {
    timerProgress: 0.9,
    scaleConnected: true,
    profile: legacyProfile,
    extractionElapsedS: 5,
    liveRelativeWeightG: 1,
    targetTimeMaxS: 32,
  });
  assert.ok(beforeTaperWeight < 0.9);

  const afterTaperWeight = flairProfileMarkerProgress(built, {
    timerProgress: 0.2,
    scaleConnected: true,
    profile: legacyProfile,
    extractionElapsedS: 5,
    liveRelativeWeightG: 4,
    targetTimeMaxS: 32,
  });
  assert.ok(afterTaperWeight > 0.2);

  assert.equal(recipeDefinesPreinfusion(legacyProfile), true);
  assert.equal(recipeDefinesPreinfusion({}), false);

  console.log('Flair scale trigger tests passed.');
}
