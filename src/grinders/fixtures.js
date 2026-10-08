/** Shared fixtures mirroring shapes from test.js / runLegacyShotDataTests. */

export const MOCK_NOW = '2026-09-20T12:00:00.000Z';

export const BASE_RECIPE = {
  targetTimeMinS: 25,
  targetTimeMaxS: 30,
  targetDoseG: 18,
  targetYieldG: 36,
  brewTemperatureC: 93,
};

export const FLAIR_RECIPE = {
  ...BASE_RECIPE,
  flairProfile: { preinfusionPressure: '2', peakPressure: '9', taperPressure: '6' },
};

export const LEGACY_BEAN = {
  id: 'legacy-bean',
  name: 'House',
  roaster: 'Local',
  roastType: 'Medium',
  roastDate: '2026-01-01',
  storageType: 'bag',
  createdAt: '2026-01-01T00:00:00.000Z',
};

export const LEGACY_RECIPE = {
  id: 'legacy-recipe',
  beanId: 'legacy-bean',
  targetDoseG: 18,
  targetYieldG: 36,
  targetTimeMinS: 25,
  targetTimeMaxS: 30,
};

export const LEGACY_SHOT = {
  id: 'legacy-shot',
  beanId: 'legacy-bean',
  timestamp: '2026-01-05T00:00:00.000Z',
  grinderModel: 'Sette 270Wi',
  setteMacro: 12,
  setteMicro: 'C',
  actualTimeS: 28,
  actualYieldG: 36,
  actualDoseG: 18,
  tasteProfile: 'good',
};

export const STOPPED_SHOT = {
  id: 'stopped-shot',
  beanId: 'legacy-bean',
  timestamp: '2026-01-06T00:00:00.000Z',
  grinderModel: 'Sette 270Wi',
  setteMacro: 13,
  setteMicro: 'E',
  actualDoseG: 18,
  actualYieldG: 10,
  actualTimeS: 60,
  tasteProfile: 'bitter',
  notes: 'stopped the shot',
  excludeFromLearning: true,
  knownIssueReason: 'stopped_early',
};

export function recipeForBean(bean) {
  return {
    id: `recipe-${bean.id}`,
    beanId: bean.id,
    targetDoseG: 18,
    targetYieldG: 36,
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
  };
}

export function createSetteShot(time, taste, yieldG = 36, extra = {}) {
  return {
    grinderModel: 'Sette 270Wi',
    setteMacro: 13,
    setteMicro: 'E',
    actualTime: time,
    actualTimeS: time,
    actualDose: 18,
    actualDoseG: 18,
    actualYield: yieldG,
    actualYieldG: yieldG,
    tasteProfile: taste,
    brewTemperatureC: 93,
    flairProfile: { preinfusionPressure: '2', peakPressure: '9', taperPressure: '6' },
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
    timestamp: '2026-09-18T10:00:00.000Z',
    wasPurged: true,
    ...extra,
  };
}

export function createSunbeamShot(time, taste, yieldG = 36, extra = {}) {
  return {
    grinderModel: 'Sunbeam Barista Max',
    sunbeamSetting: 15,
    actualTime: time,
    actualTimeS: time,
    actualDose: 18,
    actualDoseG: 18,
    actualYield: yieldG,
    actualYieldG: yieldG,
    tasteProfile: taste,
    brewTemperatureC: 92,
    timestamp: '2026-09-18T10:00:00.000Z',
    wasPurged: true,
    ...extra,
  };
}

export function storedDialledShot({
  beanId = 'b1',
  macro = 10,
  micro = 'A',
  setting = 15,
  grinder = 'Sette 270Wi',
  timestamp = '2026-09-18T10:00:00.000Z',
  beanAgeDays = 19,
  extra = {},
}) {
  const base = {
    id: `shot-${timestamp}`,
    beanId,
    grinderModel: grinder,
    actualTimeS: 28,
    actualYieldG: 36,
    actualDoseG: 18,
    tasteProfile: 'good',
    timestamp,
    beanAgeDays,
    recommendationFollowed: true,
    recommendation: {
      recommendedSetting:
        grinder === 'Sette 270Wi' ? { macro, micro } : { setting },
      reason: 'KEEP GRIND — Balanced and in range.',
    },
    ...extra,
  };
  if (grinder === 'Sette 270Wi') {
    base.setteMacro = macro;
    base.setteMicro = micro;
  } else {
    base.sunbeamSetting = setting;
  }
  return base;
}
