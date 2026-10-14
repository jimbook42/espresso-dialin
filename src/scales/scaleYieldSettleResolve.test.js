import assert from 'assert';
import {
  resolveSettledYieldG,
  SETTLE_SHARP_DROP_G,
} from './scaleYieldSettleResolve.js';

export function runScaleYieldSettleResolveTests() {
  assert.equal(SETTLE_SHARP_DROP_G, 2.5);

  assert.equal(resolveSettledYieldG(18.2, 18.4, 18.3), 18.4);
  assert.equal(resolveSettledYieldG(18.2, 18.2, 5.0), 18.2, 'sharp drop keeps tap weight');
  assert.equal(resolveSettledYieldG(0, 0, 12.1), 12.1);
  assert.equal(resolveSettledYieldG(10.05, 10.05, 9.9), 10.1);

  console.log('Scale yield settle resolve tests passed.');
}
