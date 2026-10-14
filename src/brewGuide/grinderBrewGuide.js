import {
  brewGuideGrindSettingLabelForGrinder,
  getBrewGuideChangedGrindPurgeExtraLine,
  getBrewGuideMachineKey,
  getGrinderDefinitionById,
  SETTE_GRINDER_ID,
  SUNBEAM_GRINDER_ID,
} from '../grinders/grinderRegistry.js';
import {
  GENERIC_BREW_GUIDE_MENU,
  GENERIC_MACHINE_BREW_GUIDE,
  SUNBEAM_MACHINE_BREW_GUIDE,
} from './machine/index.js';
import { resolveBrewGuideRecipeTargets } from './steps.js';

const MACHINE_PACKAGES = Object.freeze({
  [SUNBEAM_MACHINE_BREW_GUIDE.key]: SUNBEAM_MACHINE_BREW_GUIDE,
  [GENERIC_MACHINE_BREW_GUIDE.key]: GENERIC_MACHINE_BREW_GUIDE,
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

/** Menu framing shared by all Brew Guide machine packages. */
export function getBrewGuideMenuShell() {
  return GENERIC_BREW_GUIDE_MENU;
}

/**
 * Machine reference content for the active grinder.
 * Sunbeam-specific guides only when the Sunbeam Barista Max is the selected grinder.
 */
export function getBrewGuideMachinePackage(grinderModel) {
  const machine = getBrewGuideMachinePackageForGrinder(grinderModel) ?? GENERIC_MACHINE_BREW_GUIDE;
  return {
    ...GENERIC_BREW_GUIDE_MENU,
    machineSettingsDetail: machine.machineSettingsDetail,
    guides: machine.guides,
    machineKey: machine.key,
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
  flairEnabled = false,
  scaleConnected = false,
}) {
  const targets = resolveBrewGuideRecipeTargets({
    targetDoseG,
    targetYieldG,
    targetTimeMinS,
    targetTimeMaxS,
    brewTemperatureC,
  });
  return {
    beanName: beanName || '',
    doseG: targets.doseG,
    yieldG: targets.yieldG,
    timeMinS: targets.timeMinS,
    timeMaxS: targets.timeMaxS,
    brewTemperatureC: targets.brewTemperatureC ?? brewTemperatureC,
    grinderModel,
    grindLabel,
    previousGrindLabel,
    flairEnabled: Boolean(flairEnabled),
    scaleConnected: Boolean(scaleConnected),
  };
}

export function brewGuideGrinderIds() {
  return { sette: SETTE_GRINDER_ID, sunbeam: SUNBEAM_GRINDER_ID };
}

export function resolveBrewGuideGrinderDefinition(grinderModel) {
  return getGrinderDefinitionById(grinderModel);
}
