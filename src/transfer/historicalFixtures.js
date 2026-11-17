export const historicalSchemas = {
  1: {
    beans: 'id, name, roaster, roastDate, createdAt',
    recipes: 'id, beanId, targetDoseG, targetYieldG, targetTimeMinS, targetTimeMaxS',
    shots: 'id, beanId, timestamp, grinderModel',
  },
};
historicalSchemas[6] = {
  ...historicalSchemas[1],
  beans: 'id, name, roaster, roastDate, storageType, rating, createdAt',
};
historicalSchemas[10] = {
  ...historicalSchemas[6],
  beans: 'id, name, roaster, roastDate, storageType, postThawStorage, freezeDate, thawDate, rating, createdAt',
  shots: 'id, beanId, timestamp, grinderModel, setteMacro, setteMicro, sunbeamSetting',
  settings: 'id, grinderModel, flairEnabled',
};
historicalSchemas[11] = historicalSchemas[10];

// Synthetic values in the field shapes written by b05f544 and 777a703.
export const v1Bean = { id: 'bean-early', name: 'Early espresso', roaster: 'Example', roastType: 'Medium',
  roastDate: '2025-01-05', factorAge: true, createdAt: '2025-01-10T10:00:00.123Z' };
export const v1Recipe = { id: 'recipe-early', beanId: v1Bean.id, targetDoseG: 18, targetYieldG: 36,
  targetTimeMinS: 27, targetTimeMaxS: 32 };
export const v1Shot = { id: 'shot-early', beanId: v1Bean.id, timestamp: '2025-01-10T10:01:00.123Z',
  grinderModel: 'Sette 270Wi', setteMacro: 13, setteMicro: 'E', sunbeamSetting: null, wasPurged: true,
  actualDoseG: 18.2, actualYieldG: 36.125, actualTimeS: 28, tasteProfile: 'good',
  recommendation: { recommendedSetting: { macro: 13, micro: 'E' } }, notes: 'Earliest saved shot' };
export const v10Shot = { ...v1Shot, id: 'shot-middle', timestamp: '2025-02-10T10:01:00.123Z',
  shotRating: 4, brewRatio: '1:1.98', beanAgeDays: 36, storageType: 'frozen',
  flairProfile: { waterTempC: 94, preinfusion: 8, extraction: 28, rampDown: 4 } };
