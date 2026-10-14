import assert from 'assert';
import { createSimulatedTransport } from './simulatedTransport.js';
import { resolveSettledYieldG } from '../scaleYieldSettleResolve.js';

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
      assert.ok(
        lastWeight <= 6.5,
        `pre-infusion sim curve stays low (~6g), got ${lastWeight} — explains bogus settle if stop used curve not live weight`
      );
      return transport.disconnect();
    })
    .then(() => {
      const extractionSim = createSimulatedTransport({
        targetYieldG: 36,
        preinfusionDurationS: 0,
        tickMs: 50,
        dripAfterStopS: 1,
      });
      let weightAtStop = 0;
      extractionSim.onWeight((evt) => {
        weightAtStop = evt.weightG;
      });
      return extractionSim
        .connect()
        .then(() => extractionSim.startTimer())
        .then(() => new Promise((resolve) => setTimeout(resolve, 12000)))
        .then(() => {
          assert.ok(weightAtStop >= 14, `extraction should pass 14g before stop, got ${weightAtStop}`);
          const beforeStop = weightAtStop;
          return extractionSim.stopTimer().then(() => {
            assert.ok(
              weightAtStop >= beforeStop - 0.05,
              `stop must freeze last emitted weight (${beforeStop}), not rewind sim curve (${weightAtStop})`
            );
            const settled = resolveSettledYieldG(beforeStop, beforeStop, weightAtStop);
            assert.ok(
              settled >= 14,
              `settle logic must not collapse to preinfusion drip (~6g), got ${settled}`
            );
            return extractionSim.disconnect();
          });
        });
    })
    .then(() => {
      console.log('Simulated transport tests passed.');
    });
}
