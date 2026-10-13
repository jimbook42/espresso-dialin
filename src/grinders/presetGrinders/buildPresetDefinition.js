import {
  adjustPresetGrind,
  clampPresetGrind,
  defaultPresetGrindValue,
  formatPresetGrindDisplay,
  parsePresetGrindValue,
  presetProfileFromSpec,
  presetValueToNumeric,
} from './dial.js';

export function buildPresetGrinderDefinition(spec) {
  const profile = presetProfileFromSpec(spec);
  const dialLabel =
    spec.dialKind === 'fellowOpus1'
      ? 'Dial 0–12 (0.25 steps; 1 is finest)'
      : spec.id === 'Zerno Z1'
        ? 'Dial 0–1400 · µm'
        : spec.dialKind === 'stepless'
          ? `Dial reference ${spec.min}–${spec.max} (stepless)`
          : `Dial ${spec.min}–${spec.max}`;

  const stepped = spec.dialKind === 'stepped' || spec.dialKind === 'fellowOpus1';
  const controlType =
    spec.dialKind === 'fellowOpus1' ? 'fellowOpus1' : stepped ? 'presetStepped' : 'presetStepless';

  return {
    id: spec.id,
    presetSpec: spec,
    controlType,
    supportsQuantitativeRecommendations: !spec.referenceLearning,
    recommendationIsEstimated: true,
    referenceLearning: Boolean(spec.referenceLearning),
    sensitivity: spec.sensitivity ?? 4.5,
    shiftUnit: stepped ? 'step(s)' : 'increment(s)',
    inRangeVerySourShift: stepped ? -1 : -0.5,
    inRangeVeryBitterShift: stepped ? 1 : 0.5,
    chokeReasonStepLabel: stepped ? 'STEP(S)' : 'INCREMENT(S)',
    timeOffTargetStepLabel: stepped ? 'STEP(S)' : 'INCREMENT(S)',
    shortBadgeLabel: spec.settingsSelectLabel.split(' ').slice(-1)[0] || spec.id,
    settingsSelectLabel: spec.settingsSelectLabel,
    setupCardLabel: spec.settingsSelectLabel,
    setupCardHint: spec.setupCardHint,
    defaultBrewTemperatureC: spec.defaultBrewTemperatureC ?? 93,
    brewGuideGrindSettingLabel: 'Grind setting',
    brewGuideMachineKey: null,
    brewGuideChangedGrindPurgeExtraLine: 'Keep the purge separate from the dose.',
    dialFieldLabel: dialLabel,
    dialValidationError: 'Grind dial value must be a valid number within the grinder range.',
    dialMin: spec.min,
    dialMax: spec.max,
    dialStep: spec.step,
    customProfile: profile,
    adjustSetting(shift, { customGrindValue }) {
      const next = adjustPresetGrind(
        customGrindValue ?? defaultPresetGrindValue(spec),
        shift,
        spec
      );
      return { customGrindValue: next };
    },
    shotToNumeric(shot) {
      return presetValueToNumeric(shot?.customGrindValue, spec);
    },
    formatShotGrindForHistory(shot) {
      if (shot?.customGrindValue == null || shot.customGrindValue === '') return '';
      return formatPresetGrindDisplay(shot.customGrindValue, spec) || String(shot.customGrindValue);
    },
    formatPreviousGrindLabel(shot) {
      if (shot?.customGrindValue == null || shot.customGrindValue === '') return '';
      return formatPresetGrindDisplay(shot.customGrindValue, spec);
    },
    formatCurrentGrindLabel({ customGrindValue }) {
      return formatPresetGrindDisplay(customGrindValue, spec) || String(customGrindValue ?? '');
    },
    formatRecommendedGrindDisplay(recommendedSetting) {
      return (
        formatPresetGrindDisplay(recommendedSetting?.customGrindValue, spec)
        || String(recommendedSetting?.customGrindValue ?? defaultPresetGrindValue(spec))
      );
    },
    formatInitialGrindDisplay(initialSetting) {
      return formatPresetGrindDisplay(initialSetting.customGrindValue, spec)
        || String(initialSetting.customGrindValue ?? defaultPresetGrindValue(spec));
    },
    uiStateFromLastShot(shot) {
      const parsed = parsePresetGrindValue(shot?.customGrindValue, spec);
      return { customGrindValue: parsed ?? defaultPresetGrindValue(spec) };
    },
    uiStateFromRecommendedSetting(recSet) {
      if (recSet?.customGrindValue == null) return null;
      const parsed = parsePresetGrindValue(recSet.customGrindValue, spec);
      if (parsed === null) return null;
      return { customGrindValue: parsed };
    },
    persistedSettingsPatchFromRecommendation(recSet) {
      const parsed = parsePresetGrindValue(recSet?.customGrindValue, spec);
      if (parsed === null) return {};
      return { lastPresetGrindValue: parsed, lastCustomGrindValue: parsed };
    },
    parseGrindForShotSave({ customGrindValue }) {
      const parsed = parsePresetGrindValue(customGrindValue, spec);
      if (parsed === null) {
        return { ok: false, error: this.dialValidationError };
      }
      return {
        ok: true,
        setteMacro: null,
        setteMicro: null,
        sunbeamSetting: null,
        nicheZeroSetting: null,
        customGrindValue: parsed,
      };
    },
    grindMatchesRecommendation({ customGrindValue }, rec) {
      const a = parsePresetGrindValue(customGrindValue, spec);
      const b = parsePresetGrindValue(rec?.customGrindValue, spec);
      return a !== null && b !== null && a === b;
    },
    clampReferenceDial(n) {
      return clampPresetGrind(n, spec);
    },
    parseReferenceDial(raw) {
      return parsePresetGrindValue(raw, spec);
    },
    formatReferenceDial(value) {
      return formatPresetGrindDisplay(value, spec);
    },
  };
}
