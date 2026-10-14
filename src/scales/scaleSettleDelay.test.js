import assert from 'assert';
import { roundYieldG, SHOT_YIELD_SETTLE_MS } from './scaleShotStopSettle.js';

function createMockScaleState() {
  let liveWeight = 32.4;
  let recording = true;
  return {
    get liveWeight() {
      return liveWeight;
    },
    set liveWeight(v) {
      liveWeight = v;
    },
    get recording() {
      return recording;
    },
    notifyShotYieldSettleBegin() {
      return true;
    },
    finalizeShotYieldSettle() {
      recording = false;
      return { yieldG: roundYieldG(liveWeight), metrics: null };
    },
  };
}

export function runScaleSettleDelayTests() {
  assert.equal(SHOT_YIELD_SETTLE_MS, 1000);
  assert.equal(roundYieldG(32.44), 32.4);
  assert.equal(roundYieldG(-1), 0);

  const scale = createMockScaleState();
  assert.equal(scale.notifyShotYieldSettleBegin(), true);
  scale.liveWeight = 33.1;
  const { yieldG } = scale.finalizeShotYieldSettle();
  assert.equal(yieldG, 33.1);
  assert.equal(scale.recording, false);
  console.log('Scale settle delay tests passed.');
}
