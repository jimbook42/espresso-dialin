/**
 * Ticket 6.15 preset grinder specs (validated research, Oct 2026).
 * @typedef {'stepped' | 'stepless' | 'fellowOpus1'} PresetDialKind
 */

export const BCG820_GRINDER_ID = 'Breville Smart Grinder Pro BCG820';
export const ENCORE_ESP_GRINDER_ID = 'Baratza Encore ESP';
export const FELLOW_OPUS_GRINDER_ID = 'Fellow Opus';
export const FELLOW_OPUS_2_GRINDER_ID = 'Fellow Opus 2';
export const MAZZER_PHILOS_GRINDER_ID = 'Mazzer Philos';
export const EUREKA_SPECIALITA_GRINDER_ID = 'Eureka Mignon Specialità';
export const EUREKA_ZERO_GRINDER_ID = 'Eureka Mignon Zero';
export const EUREKA_ZERO_55S_GRINDER_ID = 'Eureka Mignon Zero 55s';
export const EUREKA_ZERO_65_AP_GRINDER_ID = 'Eureka Mignon Zero 65 AP';
export const EUREKA_ZERO_65_SPEEDY_GRINDER_ID = 'Eureka Mignon Zero 65 Speedy';
export const ZERNO_Z1_GRINDER_ID = 'Zerno Z1';

/** @type {readonly string[]} */
export const PRESET_GRINDER_IDS = Object.freeze([
  BCG820_GRINDER_ID,
  ENCORE_ESP_GRINDER_ID,
  FELLOW_OPUS_GRINDER_ID,
  FELLOW_OPUS_2_GRINDER_ID,
  MAZZER_PHILOS_GRINDER_ID,
  EUREKA_SPECIALITA_GRINDER_ID,
  EUREKA_ZERO_GRINDER_ID,
  EUREKA_ZERO_55S_GRINDER_ID,
  EUREKA_ZERO_65_AP_GRINDER_ID,
  EUREKA_ZERO_65_SPEEDY_GRINDER_ID,
  ZERNO_Z1_GRINDER_ID,
]);

/**
 * @typedef {Object} PresetGrinderSpec
 * @property {string} id
 * @property {string} settingsSelectLabel
 * @property {string} setupCardHint
 * @property {PresetDialKind} dialKind
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {number} defaultSetting
 * @property {boolean} lowerIsFiner
 * @property {number} sensitivity
 * @property {boolean} [referenceLearning]
 * @property {string} [unitSuffix]
 * @property {number} [defaultBrewTemperatureC]
 */

/** @type {PresetGrinderSpec[]} */
export const PRESET_GRINDER_SPECS = [
  {
    id: BCG820_GRINDER_ID,
    settingsSelectLabel: BCG820_GRINDER_ID,
    setupCardHint: '60 stepped settings; espresso typically 1–30 (dual-wall baskets from 30).',
    dialKind: 'stepped',
    min: 1,
    max: 60,
    step: 1,
    defaultSetting: 12,
    lowerIsFiner: true,
    sensitivity: 3.2,
    defaultBrewTemperatureC: 93,
  },
  {
    id: ENCORE_ESP_GRINDER_ID,
    settingsSelectLabel: ENCORE_ESP_GRINDER_ID,
    setupCardHint: 'Espresso range 1–20; optional shims (~5 settings each) in Settings.',
    dialKind: 'stepped',
    min: 1,
    max: 20,
    step: 1,
    defaultSetting: 15,
    lowerIsFiner: true,
    sensitivity: 2.8,
    defaultBrewTemperatureC: 93,
  },
  {
    id: FELLOW_OPUS_GRINDER_ID,
    settingsSelectLabel: 'Fellow Opus (gen 1)',
    setupCardHint: 'Espresso dial 1–12 in 0.25 steps (1 is finest; do not grind below 1).',
    dialKind: 'fellowOpus1',
    min: 1,
    max: 12,
    step: 0.25,
    defaultSetting: 1.5,
    lowerIsFiner: true,
    sensitivity: 0.35,
    defaultBrewTemperatureC: 93,
  },
  {
    id: FELLOW_OPUS_2_GRINDER_ID,
    settingsSelectLabel: 'Fellow Opus 2',
    setupCardHint: 'Stepless side dial; espresso roughly 0–2.',
    dialKind: 'stepless',
    min: 0,
    max: 2,
    step: 0.05,
    defaultSetting: 1,
    lowerIsFiner: true,
    sensitivity: 0.25,
    defaultBrewTemperatureC: 93,
  },
  {
    id: MAZZER_PHILOS_GRINDER_ID,
    settingsSelectLabel: MAZZER_PHILOS_GRINDER_ID,
    setupCardHint: '6 µm notches (stepless convertible); higher numbers are coarser.',
    dialKind: 'stepped',
    min: 10,
    max: 120,
    step: 1,
    defaultSetting: 20,
    lowerIsFiner: false,
    sensitivity: 4,
    defaultBrewTemperatureC: 93,
  },
  {
    id: EUREKA_SPECIALITA_GRINDER_ID,
    settingsSelectLabel: EUREKA_SPECIALITA_GRINDER_ID,
    setupCardHint: 'Stepless; clockwise is finer. Reference number plus shot learning.',
    dialKind: 'stepless',
    min: 0,
    max: 50,
    step: 0.1,
    defaultSetting: 2,
    lowerIsFiner: true,
    referenceLearning: true,
    defaultBrewTemperatureC: 93,
  },
  {
    id: EUREKA_ZERO_GRINDER_ID,
    settingsSelectLabel: EUREKA_ZERO_GRINDER_ID,
    setupCardHint: 'Stepless reference dial; learning from your logged shots.',
    dialKind: 'stepless',
    min: 0,
    max: 50,
    step: 0.1,
    defaultSetting: 1.5,
    lowerIsFiner: true,
    referenceLearning: true,
    defaultBrewTemperatureC: 93,
  },
  {
    id: EUREKA_ZERO_55S_GRINDER_ID,
    settingsSelectLabel: EUREKA_ZERO_55S_GRINDER_ID,
    setupCardHint: 'Stepless reference dial; learning from your logged shots.',
    dialKind: 'stepless',
    min: 0,
    max: 50,
    step: 0.1,
    defaultSetting: 1.5,
    lowerIsFiner: true,
    referenceLearning: true,
    defaultBrewTemperatureC: 93,
  },
  {
    id: EUREKA_ZERO_65_AP_GRINDER_ID,
    settingsSelectLabel: EUREKA_ZERO_65_AP_GRINDER_ID,
    setupCardHint: 'Stepless reference dial; learning from your logged shots.',
    dialKind: 'stepless',
    min: 0,
    max: 50,
    step: 0.1,
    defaultSetting: 2,
    lowerIsFiner: true,
    referenceLearning: true,
    defaultBrewTemperatureC: 93,
  },
  {
    id: EUREKA_ZERO_65_SPEEDY_GRINDER_ID,
    settingsSelectLabel: EUREKA_ZERO_65_SPEEDY_GRINDER_ID,
    setupCardHint: 'Stepless reference dial; learning from your logged shots.',
    dialKind: 'stepless',
    min: 0,
    max: 50,
    step: 0.1,
    defaultSetting: 2,
    lowerIsFiner: true,
    referenceLearning: true,
    defaultBrewTemperatureC: 93,
  },
  {
    id: ZERNO_Z1_GRINDER_ID,
    settingsSelectLabel: ZERNO_Z1_GRINDER_ID,
    setupCardHint: 'Stepless 0–1400 µm; espresso often starts around 200 µm.',
    dialKind: 'stepless',
    min: 0,
    max: 1400,
    step: 5,
    defaultSetting: 200,
    lowerIsFiner: true,
    sensitivity: 12,
    defaultBrewTemperatureC: 93,
  },
];

const specById = new Map(PRESET_GRINDER_SPECS.map((s) => [s.id, s]));

export function getPresetGrinderSpec(grinderModel) {
  return specById.get(grinderModel) ?? null;
}

export function isPresetGrinderId(grinderModel) {
  return specById.has(grinderModel);
}
