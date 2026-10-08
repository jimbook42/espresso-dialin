import {
  brewGuideGrindSettingLabelForGrinder,
  getBrewGuideChangedGrindPurgeExtraLine,
  getBrewGuideMachineKey,
  getGrinderDefinitionById,
  SETTE_GRINDER_ID,
  SUNBEAM_GRINDER_ID,
} from '../grinders/grinderRegistry.js';
import { GENERIC_BREW_GUIDE_MENU, SUNBEAM_MACHINE_BREW_GUIDE } from './machine/index.js';

const MACHINE_PACKAGES = Object.freeze({
  [SUNBEAM_MACHINE_BREW_GUIDE.key]: SUNBEAM_MACHINE_BREW_GUIDE,
});

/**
 * Grind-step behaviour for the generic brew workflow (labels, purge copy).
 * Grind display values come from Dial-In via dial.grindLabel (registry formatting in App).
 */
export function getBrewGuideGrindConfig(grinderModel) {
  return {
    grindSettingLabel: brewGuideGrindSettingLabelForGrinder(grinderModel),
    changedGrindPurgeExtraLine: getBrewGuideChangedGrindPurgeExtraLine(grinderModel),
  };
}

/** Machine-specific guide package for a stored grinder id, if any. */
export function getBrewGuideMachinePackageForGrinder(grinderModel) {
  const key = getBrewGuideMachineKey(grinderModel);
  if (!key) return null;
  return MACHINE_PACKAGES[key] ?? null;
}

/**
 * Machine reference UI shown in Brew Guide today (Sunbeam EM5300 content for all grinders).
 * Workflow grind behaviour still follows the active grinder via getBrewGuideGrindConfig.
 */
export function getBrewGuideMenuShell() {
  return GENERIC_BREW_GUIDE_MENU;
}

export function getBrewGuideMachinePackage() {
  return {
    ...GENERIC_BREW_GUIDE_MENU,
    machineSettingsDetail: SUNBEAM_MACHINE_BREW_GUIDE.machineSettingsDetail,
    guides: SUNBEAM_MACHINE_BREW_GUIDE.guides,
  };
}

export function buildBrewGuideDialPayload({
  beanName,
  targetDoseG,
  targetYieldG,
  targetTimeMinS,
  targetTimeMaxS,
  brewTemperatureC,
  grinderModel,
  grindLabel,
  previousGrindLabel,
}) {
  return {
    beanName: beanName || '',
    doseG: targetDoseG,
    yieldG: targetYieldG,
    timeMinS: targetTimeMinS,
    timeMaxS: targetTimeMaxS,
    brewTemperatureC,
    grinderModel,
    grindLabel,
    previousGrindLabel,
  };
}

export function brewGuideGrinderIds() {
  return { sette: SETTE_GRINDER_ID, sunbeam: SUNBEAM_GRINDER_ID };
}

export function resolveBrewGuideGrinderDefinition(grinderModel) {
  return getGrinderDefinitionById(grinderModel);
}
