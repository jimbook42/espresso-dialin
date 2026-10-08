/** Stored grinder identity strings (must not change). */
export const SETTE_GRINDER_ID = 'Sette 270Wi';
export const SUNBEAM_GRINDER_ID = 'Sunbeam Barista Max';

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
  defaultBrewTemperatureC: 93,
  brewGuideGrindSettingLabel: 'Grind setting',
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
  defaultBrewTemperatureC: 92,
  brewGuideGrindSettingLabel: 'Dial setting',
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

/** Exact stored ID lookup only; unknown IDs return null. */
export function getGrinderDefinitionById(grinderModel) {
  if (grinderModel === SETTE_GRINDER_ID) return setteDefinition;
  if (grinderModel === SUNBEAM_GRINDER_ID) return sunbeamDefinition;
  return null;
}

/** Recommendation engine: only exact Sette ID uses Sette; all other values use Sunbeam path. */
export function isSetteGrinderModel(grinderModel) {
  return grinderModel === SETTE_GRINDER_ID;
}

export function getRecommendationGrinderProfile(grinderModel) {
  return isSetteGrinderModel(grinderModel) ? setteDefinition : sunbeamDefinition;
}

/** getShotEngineStats: missing/null/empty grinder identity defaults to Sette. */
export function resolveShotStatsGrinderModel(grinderModel) {
  return grinderModel || SETTE_GRINDER_ID;
}

export function getShotStatsGrinderProfile(resolvedGrinderModel) {
  return isSetteGrinderModel(resolvedGrinderModel) ? setteDefinition : sunbeamDefinition;
}

export function getFreshnessOffsetKey(grinderModel) {
  return isSetteGrinderModel(grinderModel) ? 'offsetSette' : 'offsetSunbeam';
}

export function isSunbeamGrinderModel(grinderModel) {
  return grinderModel === SUNBEAM_GRINDER_ID;
}

/** UI/presentation profile: exact Sette id, otherwise Sunbeam presentation (matches recommendation path). */
export function getUiGrinderPresentation(grinderModel) {
  return isSetteGrinderModel(grinderModel) ? setteDefinition : sunbeamDefinition;
}

export function defaultBrewTemperatureForGrinder(grinderModel) {
  return getUiGrinderPresentation(grinderModel).defaultBrewTemperatureC;
}

export function formatShotGrindForHistory(shot) {
  return getUiGrinderPresentation(shot?.grinderModel).formatShotGrindForHistory(shot);
}

export function formatPreviousGrindLabel(grinderModel, shot) {
  return getUiGrinderPresentation(grinderModel).formatPreviousGrindLabel(shot);
}

export function formatCurrentGrindLabel(grinderModel, grindState) {
  return getUiGrinderPresentation(grinderModel).formatCurrentGrindLabel(grindState);
}

export function formatRecommendedGrindDisplay(grinderModel, recommendedSetting) {
  return getUiGrinderPresentation(grinderModel).formatRecommendedGrindDisplay(recommendedSetting);
}

export function formatInitialGrindDisplay(grinderModel, initialSetting) {
  return getUiGrinderPresentation(grinderModel).formatInitialGrindDisplay(initialSetting);
}

export function parseGrindForShotSave(grinderModel, grindState) {
  return getUiGrinderPresentation(grinderModel).parseGrindForShotSave(grindState);
}

export function grindMatchesStoredRecommendation(lastShotGrinderModel, savedGrind, rec) {
  if (!rec) return true;
  if (isSetteGrinderModel(lastShotGrinderModel)) {
    return setteDefinition.grindMatchesRecommendation(savedGrind, rec);
  }
  if (isSunbeamGrinderModel(lastShotGrinderModel)) {
    return sunbeamDefinition.grindMatchesRecommendation(savedGrind, rec);
  }
  return true;
}

export function uiStateFromLastShot(grinderModel, shot) {
  return getUiGrinderPresentation(grinderModel).uiStateFromLastShot(shot);
}

export function uiStateFromInitialRecommendation(grinderModel, initialSetting) {
  if (isSetteGrinderModel(grinderModel)) {
    return { setteMacro: initialSetting.macro, setteMicro: initialSetting.micro };
  }
  return { sunbeamSetting: initialSetting.setting };
}

export function uiStateFromRecommendedSetting(grinderModel, recSet) {
  return getUiGrinderPresentation(grinderModel).uiStateFromRecommendedSetting(recSet);
}

export function persistedSettingsPatchFromRecommendation(grinderModel, recSet) {
  return getUiGrinderPresentation(grinderModel).persistedSettingsPatchFromRecommendation(recSet);
}

export const GRINDER_SETUP_OPTIONS = [setteDefinition, sunbeamDefinition];

/** Brew Guide copy: only exact Sunbeam id uses dial wording (matches legacy /sunbeam/i on stored ids). */
export function brewGuideGrindSettingLabelForGrinder(grinderModel) {
  return isSunbeamGrinderModel(grinderModel)
    ? sunbeamDefinition.brewGuideGrindSettingLabel
    : setteDefinition.brewGuideGrindSettingLabel;
}
