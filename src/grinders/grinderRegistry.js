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
  adjustSetting(shift, { setteMacro, setteMicro }) {
    return adjustSette(setteMacro || 13, setteMicro || 'E', shift);
  },
  shotToNumeric(shot) {
    return setteToNumeric(shot.setteMacro, shot.setteMicro);
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
  adjustSetting(shift, { sunbeamSetting }) {
    return { setting: adjustSunbeam(sunbeamSetting || 15, shift) };
  },
  shotToNumeric(shot) {
    return shot.sunbeamSetting;
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
