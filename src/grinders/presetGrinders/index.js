import { PRESET_GRINDER_SPECS, isPresetGrinderId, getPresetGrinderSpec } from './catalog.js';
import { buildPresetGrinderDefinition } from './buildPresetDefinition.js';

export {
  PRESET_GRINDER_IDS,
  PRESET_GRINDER_SPECS,
  isPresetGrinderId,
  getPresetGrinderSpec,
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
} from './catalog.js';

const definitions = PRESET_GRINDER_SPECS.map((spec) => buildPresetGrinderDefinition(spec));
const definitionById = new Map(definitions.map((d) => [d.id, d]));

export function getPresetGrinderDefinition(grinderModel) {
  return definitionById.get(grinderModel) ?? null;
}

export function isPresetGrinderModel(grinderModel) {
  return isPresetGrinderId(grinderModel);
}

export const PRESET_GRINDER_DEFINITIONS = definitions;
