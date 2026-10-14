import { getNicheZeroDialLimits } from './nicheZero.js';
import {
  getGrinderDefinitionById,
  isNicheZeroGrinderModel,
  isSetteGrinderModel,
  isSunbeamGrinderModel,
  setteToNumeric,
} from './grinderRegistry.js';
import { parsePresetGrindValue } from './presetGrinders/dial.js';
import { getPresetGrinderSpec, isPresetGrinderId } from './presetGrinders/catalog.js';

const DOSE_YIELD_HINT =
  'Try adjusting dose or yield (or puck prep) instead of pushing the dial further.';

function grinderDialLimits(grinderModel, settings) {
  const def = getGrinderDefinitionById(grinderModel, settings);
  if (!def) return null;

  if (isSetteGrinderModel(grinderModel)) {
    return {
      min: def.numericMin ?? 0,
      max: def.numericMax ?? 278,
      step: 1,
    };
  }
  if (isSunbeamGrinderModel(grinderModel)) {
    return { min: def.dialMin ?? 1, max: def.dialMax ?? 30, step: 1 };
  }
  if (isNicheZeroGrinderModel(grinderModel)) {
    const { min, max } = getNicheZeroDialLimits(settings);
    return { min, max, step: 0.1 };
  }
  if (isPresetGrinderId(grinderModel)) {
    const spec = getPresetGrinderSpec(grinderModel);
    if (!spec) return null;
    return { min: spec.min, max: spec.max, step: spec.step };
  }
  if (def.customProfile) {
    return {
      min: def.customProfile.min,
      max: def.customProfile.max,
      step: def.customProfile.step,
    };
  }
  return null;
}

function recommendedDialValue(grinderModel, recommendedSetting, settings) {
  if (!recommendedSetting) return null;
  if (isSetteGrinderModel(grinderModel)) {
    return setteToNumeric(recommendedSetting.macro, recommendedSetting.micro);
  }
  if (isSunbeamGrinderModel(grinderModel)) {
    const n = Number(recommendedSetting.setting);
    return Number.isFinite(n) ? n : null;
  }
  if (isNicheZeroGrinderModel(grinderModel)) {
    const n = Number(recommendedSetting.nicheZeroSetting);
    return Number.isFinite(n) ? n : null;
  }
  if (isPresetGrinderId(grinderModel)) {
    const spec = getPresetGrinderSpec(grinderModel);
    return parsePresetGrindValue(recommendedSetting.customGrindValue, spec);
  }
  const def = getGrinderDefinitionById(grinderModel, settings);
  if (def?.customProfile) {
    const n = Number(recommendedSetting.customGrindValue);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function atDialEnd(value, limits, which) {
  if (value === null || !limits) return false;
  const tol = limits.step / 2;
  if (which === 'min') return value <= limits.min + tol;
  if (which === 'max') return value >= limits.max - tol;
  return false;
}

/**
 * When the engine wanted a grind move but the dial is already at min/max.
 * @returns {{ headline: string, detail: string } | null}
 */
function reasonWantsFiner(reason) {
  const u = (reason || '').toUpperCase();
  return u.includes('FINER') || u.includes('LOWER DIAL');
}

function reasonWantsCoarser(reason) {
  const u = (reason || '').toUpperCase();
  return u.includes('COARSER') || u.includes('CHOKE') || u.includes('HIGHER DIAL');
}

export function dialBoundaryAdvisoryForRecommendation(grinderModel, rec, settings = null) {
  const shift = rec?.engineStats?.shift ?? 0;
  const reason = rec?.reason || rec?.originalReason || '';

  const limits = grinderDialLimits(grinderModel, settings);
  const target = recommendedDialValue(grinderModel, rec?.recommendedSetting, settings);
  if (limits == null || target === null) return null;

  const wantedFiner = shift < 0 || (shift === 0 && reasonWantsFiner(reason));
  const wantedCoarser = shift > 0 || (shift === 0 && reasonWantsCoarser(reason));
  if (!wantedFiner && !wantedCoarser) return null;

  if (wantedFiner && atDialEnd(target, limits, 'min')) {
    return {
      headline: 'Already at the finest end of the dial',
      detail: DOSE_YIELD_HINT,
    };
  }
  if (wantedCoarser && atDialEnd(target, limits, 'max')) {
    return {
      headline: 'Already at the coarsest end of the dial',
      detail: DOSE_YIELD_HINT,
    };
  }
  return null;
}
