import assert from 'assert';
import {
  applyBasketChangeToRecommendation,
  buildBasketAdjustmentBasisRec,
  BASKET_FLOW_FEWER_HOLES,
  BASKET_FLOW_MORE_HOLES,
} from './basketChangeAdjustment.js';
import { SETTE_GRINDER_ID } from '../grinders/grinderRegistry.js';

export function runBasketChangeAdjustmentTests() {
  const rec = {
    recommendedSetting: { macro: 13, micro: 'E' },
    reason: 'KEEP GRIND',
  };
  const finer = applyBasketChangeToRecommendation(
    rec,
    SETTE_GRINDER_ID,
    BASKET_FLOW_MORE_HOLES
  );
  assert.ok(finer.basketChangeNote);
  assert.ok(finer.recommendedSetting.macro < 13 || finer.recommendedSetting.micro !== 'E');

  const coarser = applyBasketChangeToRecommendation(
    rec,
    SETTE_GRINDER_ID,
    BASKET_FLOW_FEWER_HOLES
  );
  assert.notDeepEqual(coarser.recommendedSetting, rec.recommendedSetting);

  const basis = buildBasketAdjustmentBasisRec(null, SETTE_GRINDER_ID, {
    hasBeanShotsForGrinder: false,
    initialGrindSetting: { macro: 17, micro: 'F' },
  });
  const immediate = applyBasketChangeToRecommendation(
    basis,
    SETTE_GRINDER_ID,
    BASKET_FLOW_MORE_HOLES
  );
  assert.equal(immediate.recommendedSetting.macro, 17);
  assert.equal(immediate.recommendedSetting.micro, 'D');

  console.log('Basket change adjustment tests passed.');
}
