import assert from 'assert';
import {
  publishScaleLiveWeight,
  resetScaleLiveWeightStore,
  resolveShotWeightReadout,
  subscribeScaleLiveWeight,
} from './scaleLiveWeightStore.js';

export function runScaleLiveWeightReadoutTests() {
  resetScaleLiveWeightStore();
  let calls = 0;
  const unsub = subscribeScaleLiveWeight(() => {
    calls += 1;
  });
  publishScaleLiveWeight({ liveWeightG: 12.3 });
  assert.equal(calls, 1);
  unsub();

  assert.deepEqual(
    resolveShotWeightReadout({
      timerRunning: true,
      weightTriggersPrimed: true,
      liveRelativeWeightG: 18.2,
      liveWeightG: 18.2,
      isConnected: true,
    }),
    { visible: true, grams: 18.2, mode: 'shot' }
  );

  assert.deepEqual(
    resolveShotWeightReadout({
      timerRunning: true,
      weightTriggersPrimed: false,
      liveRelativeWeightG: 0,
      liveWeightG: 42,
      isConnected: true,
    }).mode,
    'stale',
    'unprimed shot weight must not present as live relative yield'
  );

  assert.equal(
    resolveShotWeightReadout({
      timerRunning: false,
      weightTriggersPrimed: false,
      liveWeightG: 0,
      liveRelativeWeightG: 0,
      isConnected: true,
    }).visible,
    false
  );

  assert.equal(
    resolveShotWeightReadout({
      timerRunning: true,
      weightTriggersPrimed: true,
      liveRelativeWeightG: 10,
      liveWeightG: 10,
      isConnected: false,
    }).visible,
    false,
    'disconnected must not show live weight'
  );

  assert.equal(
    resolveShotWeightReadout({
      timerRunning: false,
      weightTriggersPrimed: true,
      liveRelativeWeightG: 35.2,
      liveWeightG: 35.2,
      isConnected: true,
      yieldSettleActive: true,
    }).mode,
    'settling'
  );

  assert.deepEqual(
    resolveShotWeightReadout({
      timerRunning: false,
      liveRelativeWeightG: 99,
      liveWeightG: 99,
      isConnected: true,
      frozenYieldG: 36.4,
    }),
    { visible: true, grams: 36.4, mode: 'frozen' }
  );

  console.log('Scale live weight readout tests passed.');
}
