import {
  SETTE_GRINDER_ID,
  getRecommendationGrinderProfile,
  isSetteGrinderModel,
  isSunbeamGrinderModel,
  isNicheZeroGrinderModel,
  isPresetGrinderModel,
  isCustomGrinderModel,
  adjustSette,
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
