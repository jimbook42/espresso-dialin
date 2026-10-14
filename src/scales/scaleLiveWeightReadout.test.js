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

  console.log('Scale live weight readout tests passed.');
}
