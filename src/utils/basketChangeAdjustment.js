import {
  SETTE_GRINDER_ID,
  getRecommendationGrinderProfile,
  isSetteGrinderModel,
  isSunbeamGrinderModel,
  isNicheZeroGrinderModel,
  isPresetGrinderModel,
  isCustomGrinderModel,
  adjustSette,
  parseGrindForShotSave,
} from '../grinders/grinderRegistry.js';
import { adjustPresetGrind } from '../grinders/presetGrinders/dial.js';
import { getPresetGrinderSpec } from '../grinders/presetGrinders/catalog.js';
import { adjustCustomGrind } from '../grinders/customGrinder.js';
import { parseNicheZeroSetting, formatNicheZeroSetting } from '../grinders/nicheZero.js';

export const BASKET_FLOW_MORE_HOLES = 'more_holes';
export const BASKET_FLOW_FEWER_HOLES = 'fewer_holes';

const BASKET_ADJUSTMENT_NOTE = 'Adjusted for basket change';

function engineShiftMagnitude(profile) {
  const numericMin = profile.numericMin ?? profile.dialMin ?? profile.macroMin ?? 0;
  const numericMax = profile.numericMax ?? profile.dialMax ?? profile.macroMax ?? 30;
  const range = Math.max(1, numericMax - numericMin);
  const fromRange = Math.max(1, Math.round(range * 0.03));
  return Math.min(2, fromRange);
}

function shiftSetteSetting(setting, direction, settings) {
  const profile = getRecommendationGrinderProfile(SETTE_GRINDER_ID, settings);
  const magnitude = engineShiftMagnitude(profile);
  const shift = direction === BASKET_FLOW_MORE_HOLES ? -magnitude : magnitude;
  const next = adjustSette(setting.macro || 13, setting.micro || 'E', shift);
  return { macro: next.macro, micro: next.micro };
}

function shiftQuantitativeSetting(grinderModel, setting, direction, settings) {
  const profile = getRecommendationGrinderProfile(grinderModel, settings);
  const magnitude = engineShiftMagnitude(profile);
  const signed = direction === BASKET_FLOW_MORE_HOLES ? -magnitude : magnitude;

  if (isSetteGrinderModel(grinderModel)) {
    return shiftSetteSetting(setting, direction, settings);
  }

  if (isSunbeamGrinderModel(grinderModel)) {
    const current = setting.setting ?? 15;
    const next = profile.adjustSetting(signed, { sunbeamSetting: current });
    return { setting: next.setting };
  }

  if (isNicheZeroGrinderModel(grinderModel)) {
    const current = parseNicheZeroSetting(setting.nicheZeroSetting ?? 15);
    const next = Math.max(0, Math.min(50, current + signed * 0.5));
    return { nicheZeroSetting: formatNicheZeroSetting(next) };
  }

  if (isPresetGrinderModel(grinderModel)) {
    const spec = getPresetGrinderSpec(grinderModel);
    const current = setting.customGrindValue ?? spec?.defaultSetting;
    const next = adjustPresetGrind(current, signed, spec);
    return { customGrindValue: next };
  }

  if (isCustomGrinderModel(grinderModel, settings)) {
    const current = setting.customGrindValue;
    const next = adjustCustomGrind(current, signed, settings?.customGrinder);
    return { customGrindValue: next };
  }

  return setting;
}

export function recommendedSettingFromInitialGrind(grinderModel, initialSetting) {
  if (!initialSetting || !grinderModel) return null;
  if (isSetteGrinderModel(grinderModel)) {
    return { macro: initialSetting.macro, micro: initialSetting.micro };
  }
  if (isSunbeamGrinderModel(grinderModel)) {
    return { setting: initialSetting.setting };
  }
  if (isNicheZeroGrinderModel(grinderModel)) {
    return { nicheZeroSetting: initialSetting.nicheZeroSetting };
  }
  if (initialSetting.customGrindValue != null && initialSetting.customGrindValue !== '') {
    return { customGrindValue: initialSetting.customGrindValue };
  }
  return null;
}

export function recommendedSettingFromGrindControls(grinderModel, grindFields, settings = null) {
  const parsed = parseGrindForShotSave(grinderModel, grindFields, settings);
  if (!parsed.ok) return null;
  if (isSetteGrinderModel(grinderModel)) {
    return { macro: parsed.setteMacro, micro: parsed.setteMicro };
  }
  if (isSunbeamGrinderModel(grinderModel)) {
    return { setting: parsed.sunbeamSetting };
  }
  if (isNicheZeroGrinderModel(grinderModel)) {
    return { nicheZeroSetting: parsed.nicheZeroSetting };
  }
  if (parsed.customGrindValue != null && parsed.customGrindValue !== '') {
    return { customGrindValue: parsed.customGrindValue };
  }
  return null;
}

/** Recommendation currently shown on the card — basis for an immediate basket shift. */
export function buildBasketAdjustmentBasisRec(
  dynamicRec,
  grinderModel,
  { initialGrindSetting = null, hasBeanShotsForGrinder = true, grindFields = null, settings = null } = {}
) {
  if (dynamicRec?.recommendedSetting) return dynamicRec;
  if (!hasBeanShotsForGrinder && initialGrindSetting) {
    const recommendedSetting = recommendedSettingFromInitialGrind(grinderModel, initialGrindSetting);
    if (recommendedSetting) {
      return { recommendedSetting, reason: dynamicRec?.reason || 'KEEP GRIND' };
    }
  }
  if (grindFields) {
    const recommendedSetting = recommendedSettingFromGrindControls(grinderModel, grindFields, settings);
    if (recommendedSetting) {
      return { recommendedSetting, reason: dynamicRec?.reason || 'KEEP GRIND' };
    }
  }
  return null;
}

/**
 * One-off grind shift for the next recommendation display only (does not touch learning).
 */
export function applyBasketChangeToRecommendation(rec, grinderModel, direction, settings = null) {
  if (!rec?.recommendedSetting || !grinderModel || !direction) return rec;

  const shifted = shiftQuantitativeSetting(
    grinderModel,
    rec.recommendedSetting,
    direction,
    settings
  );

  return {
    ...rec,
    recommendedSetting: shifted,
    basketChangeNote: BASKET_ADJUSTMENT_NOTE,
  };
}
