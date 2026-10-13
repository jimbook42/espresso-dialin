import assert from 'assert';
import { createSimulatedTransport } from './transport/simulatedTransport.js';
import { createScaleSession } from './scaleSession.js';
import {
  preinfusionAutoEndTargets,
  resolveFlairPressurePhase,
  shouldAutoEndPreinfusion,
} from './flairScaleTriggers.js';
import { relativeWeightG, shotStartWeightBaselineG } from './scaleShotBaseline.js';

/** Mirrors useTimemoreScale notifyShotStarted baseline + relative weight. */
async function simulateStartWithLeftoverG(leftoverG) {
  const transport = createSimulatedTransport({
    targetYieldG: 36,
    preinfusionDurationS: 12,
    tickMs: 50,
  });

  let liveG = leftoverG;
  let baselineG = 0;

  createScaleSession(transport, {
    onLiveWeight: (g) => {
      liveG = g;
    },
  });

  await transport.connect();

  const weightBeforeTare = liveG;
  baselineG = weightBeforeTare;
  assert.equal(relativeWeightG(liveG, baselineG), 0);

  await transport.tare();
  baselineG = shotStartWeightBaselineG(weightBeforeTare, liveG, true);
  assert.equal(relativeWeightG(liveG, baselineG), 0);

  await transport.startTimer();
  return {
    transport,
    getRelative: () => relativeWeightG(liveG, baselineG),
  };
}

export async function runScaleShotBaselineTests() {
  assert.equal(shotStartWeightBaselineG(36, 0, true), 0);
  assert.equal(shotStartWeightBaselineG(36, 36, false), 36);
  assert.equal(relativeWeightG(5.5, 36), 0);
  assert.equal(relativeWeightG(5.5, 0), 5.5);

  const profile = {
    preinfusionPressure: '2',
    preinfusionEndTrigger: 'weight',
    preinfusionEndWeightG: '2',
    peakPressure: '9',
    peakEndYield: '20',
    taperPressure: '6',
    taperStartTrigger: 'weight',
  };
  const scaleOn = { scaleFeatureEnabled: true, scaleConnected: true };
  const preTargets = preinfusionAutoEndTargets(profile, scaleOn);

  const { transport, getRelative } = await simulateStartWithLeftoverG(25);

  const preDeadline = Date.now() + 10_000;
  let preEnded = false;
  while (Date.now() < preDeadline) {
    const rel = getRelative();
    if (shouldAutoEndPreinfusion(preTargets, { preInfusionElapsedS: 2, liveRelativeWeightG: rel })) {
      preEnded = true;
      assert.ok(rel >= 2, `preinfusion weight trigger at >=2g relative, got ${rel}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  assert.ok(preEnded, 'weight preinfusion trigger should fire after post-tare drip');

  await transport.endPreinfusion();

  const taperDeadline = Date.now() + 40_000;
  let sawTaper = false;
  while (Date.now() < taperDeadline) {
    const rel = getRelative();
    const phase = resolveFlairPressurePhase({
      profile,
      timerRunning: true,
      timerUsePreInfusion: true,
      preInfusionPhase: false,
      scaleConnected: true,
      liveRelativeWeightG: rel,
    });
    if (phase === 'taper') {
      sawTaper = true;
      assert.ok(rel >= 20, `taper at >=20g relative, got ${rel}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(sawTaper, 'yield taper phase should activate when relative weight crosses peakEndYield');

  await transport.disconnect();
  console.log('Scale shot baseline / weight trigger tests passed.');
}
