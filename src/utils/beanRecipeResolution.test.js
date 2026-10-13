import assert from 'assert';
import 'fake-indexeddb/auto';
import { db, recomputeQuantitativeRecommendationFromLastShot } from './grinderLogic.js';
import {
  inferRecipeTargetsFromShots,
  persistBeanRecipeForBean,
  resolveRecipeForBean,
} from './beanRecipeResolution.js';

export async function runBeanRecipeResolutionTests() {
  const shots = [
    { actualDoseG: 18, actualYieldG: 30, actualTimeS: 28 },
    { actualDoseG: 18, actualYieldG: 30, actualTimeS: 32 },
    { actualDoseG: 18, actualYieldG: 30.1, actualTimeS: 27 },
  ];
  const inferred = inferRecipeTargetsFromShots(shots);
  assert.equal(inferred.targetYieldG, 30);
  assert.equal(inferred.targetDoseG, 18);

  const resolved = resolveRecipeForBean(
    { id: 'b1' },
    { id: 'r1', beanId: 'b1', targetYieldG: '', targetDoseG: 18, targetTimeMinS: 27, targetTimeMaxS: 32 },
    shots,
    'Sette 270Wi'
  );
  assert.equal(resolved.targetYieldG, 30);

  await db.open();
  await db.transaction('rw', db.beans, db.recipes, async () => {
    await db.beans.clear();
    await db.recipes.clear();
  });

  const beanId = 'imported-b2';
  await db.beans.add({
    id: beanId,
    name: 'B2',
    roaster: '',
    roastType: 'Medium',
    roastDate: '2026-01-01',
    storageType: 'bag',
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  await persistBeanRecipeForBean(
    db,
    beanId,
    { targetDoseG: 18, targetYieldG: 30, targetTimeMinS: 27, targetTimeMaxS: 32 },
    undefined,
    'Sette 270Wi'
  );
  const saved = await db.recipes.where('beanId').equals(beanId).first();
  assert.equal(saved.targetYieldG, 30);

  await persistBeanRecipeForBean(
    db,
    beanId,
    { targetDoseG: 18, targetYieldG: 30, targetTimeMinS: 27, targetTimeMaxS: 32 },
    saved,
    'Sette 270Wi'
  );
  const updated = await db.recipes.get(saved.id);
  assert.equal(updated.targetYieldG, 30);

  const recipe = {
    targetTimeMinS: 27,
    targetTimeMaxS: 32,
    targetDoseG: 18,
    targetYieldG: 30,
  };
  const lastShot = {
    beanId,
    grinderModel: 'Sette 270Wi',
    setteMacro: 7,
    setteMicro: 'I',
    actualTimeS: 20,
    actualYieldG: 30,
    tasteProfile: 'sour',
    timestamp: '2026-10-13T14:27:35.000Z',
  };
  const rec = recomputeQuantitativeRecommendationFromLastShot(lastShot, recipe, [], false);
  assert.ok(rec?.recommendedSetting);

  db.close();
  console.log('Bean recipe resolution tests passed.');
}
