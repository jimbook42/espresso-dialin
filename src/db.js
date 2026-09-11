import Dexie from 'dexie';

export const db = new Dexie('EspressoDialDB');

db.version(6).stores({
  beans: 'id, name, roaster, roastDate, storageType, rating, createdAt',
  recipes: 'id, beanId, targetDoseG, targetYieldG, targetTimeMinS, targetTimeMaxS',
  shots: 'id, beanId, timestamp, grinderModel'
});