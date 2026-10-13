import assert from 'assert';
import { createSimulatedTransport } from './transport/simulatedTransport.js';
import { createScaleSession } from './scaleSession.js';
import {
  preinfusionAutoEndTargets,
  shouldAutoEndPreinfusion,
} from './flairScaleTriggers.js';
import {
  addedMassSinceStartG,
  beginShotWeightTracking,
  createShotWeightTracking,
  ingestShotWeightSample,
  noteShotTareOutcome,
  weightTriggersReady,
} from './scaleShotBaseline.js';

function makeTracker() {
  const state = createShotWeightTracking();
  let liveG = 0;
  return {
    state,
    setLive(g) {
      liveG = g;
      ingestShotWeightSample(state, g);
    },
    getAdded() {
      return addedMassSinceStartG(state, liveG);
    },
    ready() {
      return weightTriggersReady(state);
    },
    live: () => liveG,
  };
}

/** Shot start + optional late stale pre-tare samples. */
async function runLeftoverShotScenario(leftoverG, { lateStaleG = null } = {}) {
  const transport = createSimulatedTransport({
    targetYieldG: 36,
    preinfusionDurationS: 12,
    tickMs: 50,
  });

  const tracker = makeTracker();
  tracker.setLive(leftoverG);

  createScaleSession(transport, {
    onLiveWeight: (g) => tracker.setLive(g),
  });

  await transport.connect();
  beginShotWeightTracking(tracker.state, leftoverG);
  assert.equal(tracker.getAdded(), 0);
  assert.equal(tracker.ready(), false);

  await transport.tare();
  noteShotTareOutcome(tracker.state, true);
  ingestShotWeightSample(tracker.state, tracker.live());

  if (lateStaleG != null) {
    ingestShotWeightSample(tracker.state, lateStaleG);
  }

  assert.ok(tracker.ready(), 'triggers should prime after post-tare anchor');
  assert.equal(tracker.getAdded(), 0, 'no added mass before drip');

  await transport.startTimer();
  return { transport, tracker };
}

export async function runScaleShotBaselineTests() {
  const t0 = makeTracker();
  beginShotWeightTracking(t0.state, 6.8);
  t0.setLive(6.8);
  assert.equal(t0.getAdded(), 0);
  noteShotTareOutcome(t0.state, true);
  t0.setLive(0);
  assert.equal(t0.getAdded(), 0);
  t0.setLive(6.8);
  assert.equal(t0.getAdded(), 0, 'late stale pre-tare sample must not add mass');
  t0.setLive(2);
  assert.equal(t0.getAdded(), 2);

  const tSmall = makeTracker();
  beginShotWeightTracking(tSmall.state, 0.2);
  tSmall.setLive(0.2);
  noteShotTareOutcome(tSmall.state, true);
  tSmall.setLive(0);
  tSmall.setLive(2);
  assert.equal(tSmall.getAdded(), 2, '0.2g leftover: trigger mass is from post-tare drip, not 1.8g');

  const profile = {
    preinfusionEndTrigger: 'weight',
    preinfusionEndWeightG: '2',
  };
  const preTargets = preinfusionAutoEndTargets(profile, {
    scaleFeatureEnabled: true,
    scaleConnected: true,
  });

  const { transport: t68, tracker: tr68 } = await runLeftoverShotScenario(6.8, { lateStaleG: 6.8 });
  assert.equal(
    shouldAutoEndPreinfusion(preTargets, { preInfusionElapsedS: 0.1, liveRelativeWeightG: tr68.getAdded() }),
    false,
    '6.8g leftover must not instant-end PRE at start'
  );

  const preDeadline = Date.now() + 12_000;
  let preEnded68 = false;
  while (Date.now() < preDeadline) {
    const added = tr68.getAdded();
    if (
      tr68.ready()
      && shouldAutoEndPreinfusion(preTargets, { preInfusionElapsedS: 2, liveRelativeWeightG: added })
    ) {
      preEnded68 = true;
      assert.ok(added >= 2, `6.8g leftover: end PRE at >=2g added, got ${added}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  assert.ok(preEnded68, '6.8g leftover should reach weight preinfusion trigger on added mass');
  await t68.disconnect();

  const { transport: t02, tracker: tr02 } = await runLeftoverShotScenario(0.2);
  const preDeadline02 = Date.now() + 12_000;
  let preEnded02 = false;
  let addedAtEnd = 0;
  while (Date.now() < preDeadline02) {
    const added = tr02.getAdded();
    if (
      tr02.ready()
      && shouldAutoEndPreinfusion(preTargets, { preInfusionElapsedS: 2, liveRelativeWeightG: added })
    ) {
      preEnded02 = true;
      addedAtEnd = added;
      assert.ok(added >= 2, `0.2g leftover: end at >=2g added, got ${added}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  assert.ok(preEnded02, '0.2g leftover should reach weight trigger');
  assert.ok(addedAtEnd >= 2, 'added mass at trigger must be full 2g since post-tare, not ~1.8g');
  await t02.disconnect();

  console.log('Scale shot baseline / weight trigger tests passed.');
}
