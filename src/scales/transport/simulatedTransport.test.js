import assert from 'assert';
import { createSimulatedTransport } from './simulatedTransport.js';

export function runSimulatedTransportTests() {
  const transport = createSimulatedTransport({
    targetYieldG: 36,
    preinfusionDurationS: 4,
    tickMs: 50,
  });

  let lastWeight = 0;
  transport.onWeight((evt) => {
    lastWeight = evt.weightG;
  });

  return transport
    .connect()
    .then(() => transport.startTimer())
    .then(() => new Promise((resolve) => setTimeout(resolve, 4200)))
    .then(() => {
      assert.ok(lastWeight >= 2, `pre-infusion should exceed 2g trigger, got ${lastWeight}`);
      return transport.disconnect();
    })
    .then(() => {
      console.log('Simulated transport tests passed.');
    });
}
