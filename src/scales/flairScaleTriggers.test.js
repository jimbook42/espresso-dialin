import assert from 'assert';
import {
  flairProfileMarkerProgress,
  flairProfileTaperStartChartProgress,
  preinfusionAutoEndTargets,
  recipeDefinesPreinfusion,
  recipeUsesTimedPreinfusionAutoEnd,
  resolveFlairPressurePhase,
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

  const scaleOn = { scaleFeatureEnabled: true, scaleConnected: true };
  const scaleOff = { scaleFeatureEnabled: true, scaleConnected: false };
  const noScaleFlag = { scaleFeatureEnabled: false, scaleConnected: false };

  assert.equal(resolvePreinfusionEndTrigger(legacyProfile, scaleOn), 'manual');
  assert.equal(resolvePreinfusionEndTrigger(legacyProfile, scaleOff), 'manual');
  assert.equal(resolveTaperStartTrigger(legacyProfile), 'weight');

  const legacyTargets = preinfusionAutoEndTargets(legacyProfile, scaleOn);
  assert.deepEqual(legacyTargets, { trigger: 'manual', timeS: null, weightG: null });
  assert.equal(
    shouldAutoEndPreinfusion(legacyTargets, { preInfusionElapsedS: 10, liveRelativeWeightG: 99 }),
    false
  );

  const timeProfile = { ...legacyProfile, preinfusionEndTrigger: 'time' };
  assert.equal(resolvePreinfusionEndTrigger(timeProfile, scaleOff), 'time');
  assert.equal(resolvePreinfusionEndTrigger(timeProfile, noScaleFlag), 'time');

  const timeTargets = preinfusionAutoEndTargets(timeProfile, scaleOff);
  assert.deepEqual(timeTargets, { trigger: 'time', timeS: 10, weightG: null });
  assert.equal(
    shouldAutoEndPreinfusion(timeTargets, { preInfusionElapsedS: 9, liveRelativeWeightG: 0 }),
    false
  );
  assert.equal(
    shouldAutoEndPreinfusion(timeTargets, { preInfusionElapsedS: 10, liveRelativeWeightG: 0 }),
    true
  );

  assert.equal(recipeUsesTimedPreinfusionAutoEnd(timeProfile, true, scaleOff), true);
  assert.equal(recipeUsesTimedPreinfusionAutoEnd(legacyProfile, true, scaleOn), false);

  const weightEnd = preinfusionAutoEndTargets(
    { ...legacyProfile, preinfusionEndTrigger: 'weight', preinfusionEndWeightG: '3' },
    scaleOn
  );
  assert.equal(shouldAutoEndPreinfusion(weightEnd, { preInfusionElapsedS: 1, liveRelativeWeightG: 2.9 }), false);
  assert.equal(shouldAutoEndPreinfusion(weightEnd, { preInfusionElapsedS: 1, liveRelativeWeightG: 3 }), true);

  const weightStoredNoScale = preinfusionAutoEndTargets(
    { ...legacyProfile, preinfusionEndTrigger: 'weight', preinfusionEndWeightG: '3' },
    scaleOff
  );
  assert.deepEqual(weightStoredNoScale, { trigger: 'manual', timeS: null, weightG: null });

  const manual = preinfusionAutoEndTargets({ ...legacyProfile, preinfusionEndTrigger: 'manual' }, scaleOn);
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

  const timeTaperProfile = { ...legacyProfile, taperStartTrigger: 'time', taperStartTimeS: '5' };
  const weightTaperProgress = flairProfileTaperStartChartProgress(built, legacyProfile, { targetYieldG: 36 });
  const timeTaperProgress = flairProfileTaperStartChartProgress(built, timeTaperProfile, { targetYieldG: 36 });
  assert.notEqual(weightTaperProgress, timeTaperProgress);

  assert.equal(
    resolveFlairPressurePhase({
      profile: legacyProfile,
      timerRunning: true,
      timerUsePreInfusion: true,
      preInfusionPhase: true,
      scaleConnected: true,
    }),
    'pre'
  );
  assert.equal(
    resolveFlairPressurePhase({
      profile: legacyProfile,
      timerRunning: true,
      timerUsePreInfusion: true,
      preInfusionPhase: false,
      scaleConnected: true,
      liveRelativeWeightG: 2,
    }),
    'peak'
  );
  assert.equal(
    resolveFlairPressurePhase({
      profile: legacyProfile,
      timerRunning: true,
      timerUsePreInfusion: true,
      preInfusionPhase: false,
      scaleConnected: true,
      liveRelativeWeightG: 4,
    }),
    'taper'
  );

  console.log('Flair scale trigger tests passed.');
}
