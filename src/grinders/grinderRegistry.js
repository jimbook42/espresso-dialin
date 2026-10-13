import {
  NICHE_ZERO_GRINDER_ID,
  NICHE_ZERO_DEFAULT_SETTING,
  NICHE_ZERO_DIAL_MIN,
  NICHE_ZERO_DIAL_MAX,
  parseNicheZeroSetting,
  formatNicheZeroSetting,
} from './nicheZero.js';
import {
  CUSTOM_GRINDER_PICKER_ID,
  buildCustomGrinderDefinition,
  isCustomGrinderProfileActive,
  normalizeCustomGrinderProfile,
} from './customGrinder.js';

/** Stored grinder identity strings (must not change). */
export const SETTE_GRINDER_ID = 'Sette 270Wi';
export const SUNBEAM_GRINDER_ID = 'Sunbeam Barista Max';

export { NICHE_ZERO_GRINDER_ID } from './nicheZero.js';
export { CUSTOM_GRINDER_PICKER_ID } from './customGrinder.js';

const SETTE_MICROS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

export function setteToNumeric(macro, micro) {
  const macroVal = parseInt(macro, 10) || 13;
  const microIdx = SETTE_MICROS.indexOf(micro);
  return (macroVal - 1) * 9 + (microIdx !== -1 ? microIdx : 4);
}

export function numericToSette(num) {
  const clamped = Math.min(Math.max(Math.round(num), 0), (31 - 1) * 9 + 8);
  const macro = Math.floor(clamped / 9) + 1;
  const microIdx = clamped % 9;
  return { macro, micro: SETTE_MICROS[microIdx] };
}

export function adjustSette(macro, microLetter, letterShift) {
  const numeric = setteToNumeric(macro, microLetter) + letterShift;
  return numericToSette(numeric);
}

export function adjustSunbeam(currentSetting, stepShift) {
  const setting = parseInt(currentSetting, 10);
  return Math.min(Math.max(setting + stepShift, 1), 30);
}

const setteDefinition = {
  id: SETTE_GRINDER_ID,
  supportsQuantitativeRecommendations: true,
  sensitivity: 1.25,
  shiftUnit: 'micro',
  inRangeVerySourShift: -2,
  inRangeVeryBitterShift: 2,
  macroMin: 1,
  macroMax: 31,
  microLetters: SETTE_MICROS,
  numericMin: 0,
  numericMax: 278,
  defaultMacro: 13,
  defaultMicro: 'E',
  chokeReasonStepLabel: 'MICRO STEP(S)',
  timeOffTargetStepLabel: 'MICRO STEP(S)',
  controlType: 'sette',
  shortBadgeLabel: SETTE_GRINDER_ID,
  settingsSelectLabel: 'Baratza Sette 270Wi',
  setupCardLabel: 'Baratza Sette 270Wi',
  setupCardHint: 'Separate grinder with macro and micro steps — good for precise dial-in.',
  defaultBrewTemperatureC: 93,
  brewGuideGrindSettingLabel: 'Grind setting',
  brewGuideMachineKey: null,
  brewGuideChangedGrindPurgeExtraLine: 'Keep the purge separate from the dose.',
  macroFieldLabel: 'Macro 1–31',
  microFieldLabel: 'Micro A–I',
  macroValidationError: 'Sette Macro setting must be a valid number.',
  adjustSetting(shift, { setteMacro, setteMicro }) {
    return adjustSette(setteMacro || 13, setteMicro || 'E', shift);
  },
  shotToNumeric(shot) {
    return setteToNumeric(shot.setteMacro, shot.setteMicro);
  },
  formatShotGrindForHistory(shot) {
    return `${shot?.setteMacro || 13}-${shot?.setteMicro || 'E'}`;
  },
  formatPreviousGrindLabel(shot) {
    if (shot?.setteMacro == null || shot.setteMacro === '') return '';
    return `${shot.setteMacro}-${shot.setteMicro ?? ''}`;
  },
  formatCurrentGrindLabel({ setteMacro, setteMicro }) {
    return `${setteMacro}-${setteMicro}`;
  },
  formatRecommendedGrindDisplay(recommendedSetting) {
    return `${recommendedSetting.macro || 13}-${recommendedSetting.micro || 'E'}`;
  },
  formatInitialGrindDisplay(initialSetting) {
    return `${initialSetting.macro}-${initialSetting.micro}`;
  },
  uiStateFromLastShot(shot) {
    return {
      setteMacro: shot.setteMacro || 13,
      setteMicro: shot.setteMicro || 'E',
    };
  },
  uiStateFromRecommendedSetting(recSet) {
    if (!recSet?.macro) return null;
    return { setteMacro: recSet.macro, setteMicro: recSet.micro };
  },
  persistedSettingsPatchFromRecommendation(recSet) {
    if (!recSet?.macro) return {};
    return { lastSetteMacro: recSet.macro, lastSetteMicro: recSet.micro };
  },
  parseGrindForShotSave({ setteMacro, setteMicro }) {
    const finalMacro = parseInt(setteMacro, 10);
    if (Number.isNaN(finalMacro)) {
      return { ok: false, error: this.macroValidationError };
    }
    return {
      ok: true,
      setteMacro: finalMacro,
      setteMicro: setteMicro || 'E',
      sunbeamSetting: null,
    };
  },
  grindMatchesRecommendation({ setteMacro, setteMicro }, rec) {
    return setteMacro === rec.macro && setteMicro === rec.micro;
  },
};

const sunbeamDefinition = {
  id: SUNBEAM_GRINDER_ID,
  supportsQuantitativeRecommendations: true,
  sensitivity: 4.5,
  shiftUnit: 'macro',
  inRangeVerySourShift: -1,
  inRangeVeryBitterShift: 1,
  dialMin: 1,
  dialMax: 30,
  defaultSetting: 15,
  chokeReasonStepLabel: 'SETTING(S)',
  timeOffTargetStepLabel: 'SETTING(S)',
  controlType: 'sunbeam',
  shortBadgeLabel: 'Sunbeam',
  settingsSelectLabel: SUNBEAM_GRINDER_ID,
  setupCardLabel: SUNBEAM_GRINDER_ID,
  setupCardHint: 'Built-in grinder on the Barista Max machine (also used for machine-specific brew guides).',
  defaultBrewTemperatureC: 92,
  brewGuideGrindSettingLabel: 'Dial setting',
  brewGuideMachineKey: 'sunbeam',
  brewGuideChangedGrindPurgeExtraLine:
    'Keep the purge separate from the dose. A short run is enough — do not run the hopper empty.',
  dialFieldLabel: 'Dial setting 1–30',
  dialValidationError: 'Sunbeam dial setting must be a valid number.',
  adjustSetting(shift, { sunbeamSetting }) {
    return { setting: adjustSunbeam(sunbeamSetting || 15, shift) };
  },
  shotToNumeric(shot) {
    return shot.sunbeamSetting;
  },
  formatShotGrindForHistory(shot) {
    return `${shot?.sunbeamSetting || 15}`;
  },
  formatPreviousGrindLabel(shot) {
    if (shot?.sunbeamSetting == null || shot.sunbeamSetting === '') return '';
    return String(shot.sunbeamSetting);
  },
  formatCurrentGrindLabel({ sunbeamSetting }) {
    return `${sunbeamSetting}`;
  },
  formatRecommendedGrindDisplay(recommendedSetting) {
    return `${recommendedSetting.setting || 15}`;
  },
  formatInitialGrindDisplay(initialSetting) {
    return `${initialSetting.setting}`;
  },
  uiStateFromLastShot(shot) {
    return { sunbeamSetting: shot.sunbeamSetting || 15 };
  },
  uiStateFromRecommendedSetting(recSet) {
    if (recSet?.setting == null) return null;
    return { sunbeamSetting: recSet.setting };
  },
  persistedSettingsPatchFromRecommendation(recSet) {
    if (recSet?.setting == null) return {};
    return { lastSunbeamSetting: recSet.setting };
  },
  parseGrindForShotSave({ sunbeamSetting }) {
    const finalSunbeam = parseInt(sunbeamSetting, 10);
    if (Number.isNaN(finalSunbeam)) {
      return { ok: false, error: this.dialValidationError };
    }
    return {
      ok: true,
      setteMacro: null,
      setteMicro: null,
      sunbeamSetting: finalSunbeam,
    };
  },
  grindMatchesRecommendation({ sunbeamSetting }, rec) {
    return sunbeamSetting === rec.setting;
  },
};

const nicheZeroDefinition = {
  id: NICHE_ZERO_GRINDER_ID,
  supportsQuantitativeRecommendations: false,
  sensitivity: null,
  shiftUnit: 'reference',
  controlType: 'nicheZero',
  shortBadgeLabel: 'Niche Zero',
  settingsSelectLabel: NICHE_ZERO_GRINDER_ID,
  setupCardLabel: NICHE_ZERO_GRINDER_ID,
  setupCardHint: 'Single-dial grinder; recommendations use your shot history when enough data exists.',
  defaultBrewTemperatureC: 93,
  brewGuideGrindSettingLabel: 'Grind setting',
  brewGuideMachineKey: null,
  brewGuideChangedGrindPurgeExtraLine: 'Keep the purge separate from the dose.',
  dialFieldLabel: 'Dial reference (0–50, stepless)',
  dialValidationError: 'Niche Zero dial reference must be a number from 0 to 50.',
  dialMin: NICHE_ZERO_DIAL_MIN,
  dialMax: NICHE_ZERO_DIAL_MAX,
  defaultSetting: NICHE_ZERO_DEFAULT_SETTING,
  adjustSetting() {
    throw new Error('Niche Zero does not support quantitative adjustSetting');
  },
  shotToNumeric(shot) {
    const n = parseNicheZeroSetting(shot?.nicheZeroSetting);
    return n === null ? NaN : n;
  },
  formatShotGrindForHistory(shot) {
    return formatNicheZeroSetting(shot?.nicheZeroSetting) || String(NICHE_ZERO_DEFAULT_SETTING);
  },
  formatPreviousGrindLabel(shot) {
    if (shot?.nicheZeroSetting == null || shot.nicheZeroSetting === '') return '';
    return formatNicheZeroSetting(shot.nicheZeroSetting);
  },
  formatCurrentGrindLabel({ nicheZeroSetting }) {
    return formatNicheZeroSetting(nicheZeroSetting) || String(nicheZeroSetting ?? '');
  },
  formatRecommendedGrindDisplay(recommendedSetting) {
    return formatNicheZeroSetting(recommendedSetting?.nicheZeroSetting)
      || String(recommendedSetting?.nicheZeroSetting ?? NICHE_ZERO_DEFAULT_SETTING);
  },
  formatInitialGrindDisplay(initialSetting) {
    return formatNicheZeroSetting(initialSetting.nicheZeroSetting)
      || String(initialSetting.nicheZeroSetting ?? NICHE_ZERO_DEFAULT_SETTING);
  },
  uiStateFromLastShot(shot) {
    return {
      nicheZeroSetting: parseNicheZeroSetting(shot.nicheZeroSetting) ?? NICHE_ZERO_DEFAULT_SETTING,
    };
  },
  uiStateFromRecommendedSetting(recSet) {
    if (recSet?.nicheZeroSetting == null) return null;
    const parsed = parseNicheZeroSetting(recSet.nicheZeroSetting);
    if (parsed === null) return null;
    return { nicheZeroSetting: parsed };
  },
  persistedSettingsPatchFromRecommendation(recSet) {
    const parsed = parseNicheZeroSetting(recSet?.nicheZeroSetting);
    if (parsed === null) return {};
    return { lastNicheZeroSetting: parsed };
  },
  parseGrindForShotSave({ nicheZeroSetting }) {
    const parsed = parseNicheZeroSetting(nicheZeroSetting);
    if (parsed === null) {
      return { ok: false, error: this.dialValidationError };
    }
    return {
      ok: true,
      setteMacro: null,
      setteMicro: null,
      sunbeamSetting: null,
      nicheZeroSetting: parsed,
    };
  },
  grindMatchesRecommendation({ nicheZeroSetting }, rec) {
    const a = parseNicheZeroSetting(nicheZeroSetting);
    const b = parseNicheZeroSetting(rec?.nicheZeroSetting);
    return a !== null && b !== null && a === b;
  },
};

export function resolveCustomGrinderDefinition(grinderModel, settings) {
  if (!isCustomGrinderProfileActive(grinderModel, settings)) return null;
  return buildCustomGrinderDefinition(settings.customGrinder);
}

/** Exact stored ID lookup only; unknown IDs return null unless custom profile matches. */
export function getGrinderDefinitionById(grinderModel, settings = null) {
  if (grinderModel === SETTE_GRINDER_ID) return setteDefinition;
  if (grinderModel === SUNBEAM_GRINDER_ID) return sunbeamDefinition;
  if (grinderModel === NICHE_ZERO_GRINDER_ID) return nicheZeroDefinition;
  const custom = resolveCustomGrinderDefinition(grinderModel, settings);
  if (custom) return custom;
  return null;
}

/** Recommendation engine: only exact Sette ID uses Sette; all other values use Sunbeam path. */
export function isSetteGrinderModel(grinderModel) {
  return grinderModel === SETTE_GRINDER_ID;
}

export function isNicheZeroGrinderModel(grinderModel) {
  return grinderModel === NICHE_ZERO_GRINDER_ID;
}

export function isCustomGrinderModel(grinderModel, settings = null) {
  return isCustomGrinderProfileActive(grinderModel, settings);
}

export function grinderSupportsQuantitativeRecommendations(grinderModel, settings = null) {
  const profile = getRecommendationGrinderProfile(grinderModel, settings);
  return profile.supportsQuantitativeRecommendations !== false;
}

export function getRecommendationGrinderProfile(grinderModel, settings = null) {
  const custom = resolveCustomGrinderDefinition(grinderModel, settings);
  if (custom) return custom;
  if (isSetteGrinderModel(grinderModel)) return setteDefinition;
  if (isSunbeamGrinderModel(grinderModel)) return sunbeamDefinition;
  if (isNicheZeroGrinderModel(grinderModel)) return nicheZeroDefinition;
  return sunbeamDefinition;
}

/** getShotEngineStats: missing/null/empty grinder identity defaults to Sette. */
export function resolveShotStatsGrinderModel(grinderModel) {
  return grinderModel || SETTE_GRINDER_ID;
}

/**
 * Read-side grinder identity when persisted grinderModel is missing (legacy rows).
 * Keeps Settings, dial controls, and learning defaults aligned without writing settings.
 */
export function resolveActiveGrinderModel(settings) {
  const stored = settings?.grinderModel;
  if (stored !== null && stored !== undefined && stored !== '') {
    return stored;
  }
  const customProfile = normalizeCustomGrinderProfile(settings?.customGrinder);
  if (customProfile?.name) return customProfile.name;

  const hasSette =
    settings?.lastSetteMacro != null && settings?.lastSetteMacro !== '';
  const hasSunbeam =
    settings?.lastSunbeamSetting != null && settings?.lastSunbeamSetting !== '';
  if (hasSunbeam && !hasSette) return SUNBEAM_GRINDER_ID;
  return SETTE_GRINDER_ID;
}

export function getShotStatsGrinderProfile(resolvedGrinderModel) {
  const def = getGrinderDefinitionById(resolvedGrinderModel);
  if (def) return def;
  return sunbeamDefinition;
}

export function getFreshnessOffsetKey(grinderModel) {
  return isSetteGrinderModel(grinderModel) ? 'offsetSette' : 'offsetSunbeam';
}

export function isSunbeamGrinderModel(grinderModel) {
  return grinderModel === SUNBEAM_GRINDER_ID;
}

/** Known grinder presentation, or legacy Sunbeam presentation for unknown ids. */
export function getUiGrinderPresentation(grinderModel, settings = null) {
  const def = getGrinderDefinitionById(grinderModel, settings);
  if (def) return def;
  return sunbeamDefinition;
}

export function defaultBrewTemperatureForGrinder(grinderModel) {
  return getUiGrinderPresentation(grinderModel).defaultBrewTemperatureC;
}

export function formatShotGrindForHistory(shot, settings = null) {
  const model = shot?.grinderModel;
  const customDef = resolveCustomGrinderDefinition(model, settings);
  if (customDef) {
    return customDef.formatShotGrindForHistory(shot);
  }
  if (
    shot?.customGrindValue != null
    && shot.customGrindValue !== ''
    && model
    && !isSetteGrinderModel(model)
    && !isSunbeamGrinderModel(model)
    && !isNicheZeroGrinderModel(model)
  ) {
    const numeric = Number(shot.customGrindValue);
    return Number.isFinite(numeric) ? String(numeric) : String(shot.customGrindValue);
  }
  return getUiGrinderPresentation(model, settings).formatShotGrindForHistory(shot);
}

export function formatPreviousGrindLabel(grinderModel, shot, settings = null) {
  return getUiGrinderPresentation(grinderModel, settings).formatPreviousGrindLabel(shot);
}

export function formatCurrentGrindLabel(grinderModel, grindState, settings = null) {
  if (isNicheZeroGrinderModel(grinderModel)) {
    return formatNicheZeroSetting(grindState?.nicheZeroSetting, settings)
      || String(grindState?.nicheZeroSetting ?? '');
  }
  return getUiGrinderPresentation(grinderModel, settings).formatCurrentGrindLabel(grindState);
}

export function formatRecommendedGrindDisplay(grinderModel, recommendedSetting, settings = null) {
  if (isNicheZeroGrinderModel(grinderModel)) {
    return formatNicheZeroSetting(recommendedSetting?.nicheZeroSetting, settings)
      || String(recommendedSetting?.nicheZeroSetting ?? NICHE_ZERO_DEFAULT_SETTING);
  }
  return getUiGrinderPresentation(grinderModel, settings).formatRecommendedGrindDisplay(recommendedSetting);
}

export function formatInitialGrindDisplay(grinderModel, initialSetting, settings = null) {
  if (isNicheZeroGrinderModel(grinderModel)) {
    return formatNicheZeroSetting(initialSetting?.nicheZeroSetting, settings)
      || String(initialSetting?.nicheZeroSetting ?? NICHE_ZERO_DEFAULT_SETTING);
  }
  return getUiGrinderPresentation(grinderModel, settings).formatInitialGrindDisplay(initialSetting);
}

export function parseGrindForShotSave(grinderModel, grindState, settings = null) {
  if (isNicheZeroGrinderModel(grinderModel)) {
    const parsed = parseNicheZeroSetting(grindState?.nicheZeroSetting, settings);
    if (parsed === null) {
      return { ok: false, error: nicheZeroDefinition.dialValidationError };
    }
    return {
      ok: true,
      setteMacro: null,
      setteMicro: null,
      sunbeamSetting: null,
      nicheZeroSetting: parsed,
    };
  }
  return getUiGrinderPresentation(grinderModel, settings).parseGrindForShotSave(grindState);
}

export function grindMatchesStoredRecommendation(lastShotGrinderModel, savedGrind, rec, settings = null) {
  if (!rec) return true;
  if (isCustomGrinderModel(lastShotGrinderModel, settings)) {
    const def = getGrinderDefinitionById(lastShotGrinderModel, settings);
    return def.grindMatchesRecommendation(savedGrind, rec);
  }
  if (isSetteGrinderModel(lastShotGrinderModel)) {
    return setteDefinition.grindMatchesRecommendation(savedGrind, rec);
  }
  if (isSunbeamGrinderModel(lastShotGrinderModel)) {
    return sunbeamDefinition.grindMatchesRecommendation(savedGrind, rec);
  }
  if (isNicheZeroGrinderModel(lastShotGrinderModel)) {
    return nicheZeroDefinition.grindMatchesRecommendation(savedGrind, rec);
  }
  return true;
}

export function uiStateFromLastShot(grinderModel, shot, settings = null) {
  return getUiGrinderPresentation(grinderModel, settings).uiStateFromLastShot(shot);
}

export function uiStateFromInitialRecommendation(grinderModel, initialSetting, settings = null) {
  if (isSetteGrinderModel(grinderModel)) {
    return { setteMacro: initialSetting.macro, setteMicro: initialSetting.micro };
  }
  if (isNicheZeroGrinderModel(grinderModel)) {
    return { nicheZeroSetting: initialSetting.nicheZeroSetting };
  }
  if (isCustomGrinderModel(grinderModel, settings)) {
    return { customGrindValue: initialSetting.customGrindValue };
  }
  return { sunbeamSetting: initialSetting.setting };
}

export function uiStateFromRecommendedSetting(grinderModel, recSet, settings = null) {
  return getUiGrinderPresentation(grinderModel, settings).uiStateFromRecommendedSetting(recSet);
}

export function persistedSettingsPatchFromRecommendation(grinderModel, recSet, settings = null) {
  return getUiGrinderPresentation(grinderModel, settings).persistedSettingsPatchFromRecommendation(recSet);
}

export const GRINDER_REGISTRY_ENTRIES = [setteDefinition, sunbeamDefinition, nicheZeroDefinition];

export const GRINDER_SETUP_OPTIONS = GRINDER_REGISTRY_ENTRIES;

export function listGrinderPickerOptions() {
  return [
    ...GRINDER_REGISTRY_ENTRIES.map((entry) => ({
      id: entry.id,
      label: entry.settingsSelectLabel,
      hint: entry.setupCardHint,
    })),
    {
      id: CUSTOM_GRINDER_PICKER_ID,
      label: 'Not listed — custom grinder',
      hint: 'Enter your dial range; recommendations stay estimated until you log shots.',
    },
  ];
}

export function grinderPickerValueForSettings(settings) {
  if (isCustomGrinderProfileActive(settings?.grinderModel, settings)) {
    return CUSTOM_GRINDER_PICKER_ID;
  }
  const customProfile = normalizeCustomGrinderProfile(settings?.customGrinder);
  if (customProfile?.name && !settings?.grinderModel) {
    return CUSTOM_GRINDER_PICKER_ID;
  }
  return resolveActiveGrinderModel(settings);
}

export function normalizeCustomGrinderSettingsPatch(partialProfile) {
  const profile = normalizeCustomGrinderProfile(partialProfile);
  if (!profile) return null;
  return { customGrinder: profile, grinderModel: profile.name };
}

/** Brew Guide copy: only exact Sunbeam id uses dial wording (matches legacy /sunbeam/i on stored ids). */
export function brewGuideGrindSettingLabelForGrinder(grinderModel) {
  return isSunbeamGrinderModel(grinderModel)
    ? sunbeamDefinition.brewGuideGrindSettingLabel
    : setteDefinition.brewGuideGrindSettingLabel;
}

export function getBrewGuideMachineKey(grinderModel) {
  const def = getGrinderDefinitionById(grinderModel);
  return def?.brewGuideMachineKey ?? null;
}

export function getBrewGuideChangedGrindPurgeExtraLine(grinderModel) {
  return isSunbeamGrinderModel(grinderModel)
    ? sunbeamDefinition.brewGuideChangedGrindPurgeExtraLine
    : setteDefinition.brewGuideChangedGrindPurgeExtraLine;
}
