import Dexie from 'dexie';

export const db = new Dexie('EspressoDialDB');

db.version(1).stores({
  beans: 'id, name, roaster, roastDate, createdAt',
  recipes: 'id, beanId, targetDoseG, targetYieldG, targetTimeMinS, targetTimeMaxS',
  shots: 'id, beanId, timestamp, grinderModel'
});