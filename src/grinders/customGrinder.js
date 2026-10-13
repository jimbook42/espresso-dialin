/** Picker sentinel — not stored as grinderModel. */
export const CUSTOM_GRINDER_PICKER_ID = '__custom_grinder__';

export const CUSTOM_GRINDER_ESTIMATED_LABEL = 'estimated';

const DEFAULT_CUSTOM_SENSITIVITY = 4.5;

/**
 * @typedef {'stepped' | 'stepless'} CustomDialType
 * @typedef {{
 *   name: string,
 *   dialType: CustomDialType,
 *   min: number,
 *   max: number,
 *   step: number,
 *   lowerIsFiner: boolean,
 * }} CustomGrinderProfile
 */

export function isCustomGrinderFormValid(draft) {
  return Boolean(normalizeCustomGrinderProfile(draft));
}

export function normalizeCustomGrinderProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim();
  if (!name) return null;
  const dialType = raw.dialType === 'stepless' ? 'stepless' : 'stepped';
  const min = Number(raw.min);
  const max = Number(raw.max);
  const step = Number(raw.step);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step)) return null;
  if (max <= min || step <= 0) return null;
  const lowerIsFiner = raw.lowerIsFiner !== false;
  return {
    name,
    dialType,
    min,
    max,
    step: dialType === 'stepped' ? Math.max(1, Math.round(step)) : step,
    lowerIsFiner,
  };
}

export function isCustomGrinderProfileActive(grinderModel, settings) {
  const profile = normalizeCustomGrinderProfile(settings?.customGrinder);
  if (!profile || !grinderModel) return false;
  if (profile.name !== grinderModel) return false;
  return true;
}

function decimalPlacesForStep(step) {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

export function roundToCustomStep(value, profile) {
  const places = decimalPlacesForStep(profile.step);
  const stepsFromMin = Math.round((value - profile.min) / profile.step);
  const snapped = profile.min + stepsFromMin * profile.step;
  const clamped = Math.min(profile.max, Math.max(profile.min, snapped));
  return Number(clamped.toFixed(places));
}

export function parseCustomGrindValue(raw, profile) {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n) || !profile) return null;
  return roundToCustomStep(n, profile);
}

export function defaultCustomGrindValue(profile) {
  const mid = (profile.min + profile.max) / 2;
  return roundToCustomStep(mid, profile);
}

/**
 * @param {number} dialShift signed engine steps (negative = finer on lower-is-finer grinders)
 */
export function adjustCustomGrind(currentValue, dialShift, profile) {
  const current = parseCustomGrindValue(currentValue, profile) ?? defaultCustomGrindValue(profile);
  let signed = dialShift;
  if (!profile.lowerIsFiner) signed = -signed;
  const next = current + signed * profile.step;
  return roundToCustomStep(next, profile);
}

export function customValueToNumeric(value, profile) {
  const parsed = parseCustomGrindValue(value, profile);
  if (parsed === null) return NaN;
  return (parsed - profile.min) / profile.step;
}

export function formatCustomGrindDisplay(value, profile) {
  const parsed = parseCustomGrindValue(value, profile);
  if (parsed === null) return '';
  const places = decimalPlacesForStep(profile.step);
  return places > 0 ? parsed.toFixed(places) : String(Math.round(parsed));
}

export function buildCustomGrinderDefinition(profile) {
  const normalized = normalizeCustomGrinderProfile(profile);
  if (!normalized) {
    throw new Error('Invalid custom grinder profile');
  }
  const p = normalized;
  const dialLabel =
    p.dialType === 'stepped'
      ? `Dial (${p.min}–${p.max}, step ${p.step})`
      : `Dial (${p.min}–${p.max}, stepless ±${p.step})`;

  return {
    id: p.name,
    controlType: 'custom',
    supportsQuantitativeRecommendations: true,
    recommendationIsEstimated: true,
    sensitivity: DEFAULT_CUSTOM_SENSITIVITY,
    shiftUnit: p.dialType === 'stepped' ? 'STEP(S)' : 'INCREMENT(S)',
    inRangeVerySourShift: -1,
    inRangeVeryBitterShift: 1,
    chokeReasonStepLabel: p.dialType === 'stepped' ? 'STEP(S)' : 'INCREMENT(S)',
    timeOffTargetStepLabel: p.dialType === 'stepped' ? 'STEP(S)' : 'INCREMENT(S)',
    shortBadgeLabel: p.name,
    settingsSelectLabel: p.name,
    setupCardLabel: p.name,
    setupCardHint: 'Your grinder — recommendations stay cautious until the app learns from your shots.',
    defaultBrewTemperatureC: 93,
    brewGuideGrindSettingLabel: 'Grind setting',
    brewGuideMachineKey: null,
    brewGuideChangedGrindPurgeExtraLine: 'Keep the purge separate from the dose.',
    dialFieldLabel: dialLabel,
    dialValidationError: 'Grind dial value must be a valid number within your configured range.',
    dialMin: p.min,
    dialMax: p.max,
    dialStep: p.step,
    customProfile: p,
    adjustSetting(shift, { customGrindValue }) {
      const next = adjustCustomGrind(customGrindValue ?? defaultCustomGrindValue(p), shift, p);
      return { customGrindValue: next };
    },
    shotToNumeric(shot) {
      return customValueToNumeric(shot?.customGrindValue, p);
    },
    formatShotGrindForHistory(shot) {
      if (shot?.customGrindValue == null || shot.customGrindValue === '') return '';
      return formatCustomGrindDisplay(shot.customGrindValue, p) || String(shot.customGrindValue);
    },
    formatPreviousGrindLabel(shot) {
      if (shot?.customGrindValue == null || shot.customGrindValue === '') return '';
      return formatCustomGrindDisplay(shot.customGrindValue, p);
    },
    formatCurrentGrindLabel({ customGrindValue }) {
      return formatCustomGrindDisplay(customGrindValue, p);
    },
    formatRecommendedGrindDisplay(recommendedSetting) {
      return formatCustomGrindDisplay(recommendedSetting?.customGrindValue, p);
    },
    formatInitialGrindDisplay(initialSetting) {
      return formatCustomGrindDisplay(initialSetting.customGrindValue, p);
    },
    uiStateFromLastShot(shot) {
      return {
        customGrindValue:
          parseCustomGrindValue(shot?.customGrindValue, p) ?? defaultCustomGrindValue(p),
      };
    },
    uiStateFromRecommendedSetting(recSet) {
      if (recSet?.customGrindValue == null) return null;
      const parsed = parseCustomGrindValue(recSet.customGrindValue, p);
      if (parsed === null) return null;
      return { customGrindValue: parsed };
    },
    persistedSettingsPatchFromRecommendation(recSet) {
      const parsed = parseCustomGrindValue(recSet?.customGrindValue, p);
      if (parsed === null) return {};
      return { lastCustomGrindValue: parsed };
    },
    parseGrindForShotSave({ customGrindValue }) {
      const parsed = parseCustomGrindValue(customGrindValue, p);
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
      const a = parseCustomGrindValue(customGrindValue, p);
      const b = parseCustomGrindValue(rec?.customGrindValue, p);
      return a !== null && b !== null && a === b;
    },
  };
}

export function customDialValueIndex(value, profile) {
  const parsed = parseCustomGrindValue(value, profile) ?? profile.min;
  const steps = Math.round((parsed - profile.min) / profile.step);
  const maxIndex = Math.round((profile.max - profile.min) / profile.step);
  return Math.min(Math.max(0, steps), maxIndex);
}

export function customDialMaxIndex(profile) {
  return Math.max(0, Math.round((profile.max - profile.min) / profile.step));
}

export function customDialIndexToValue(index, profile) {
  const maxIndex = customDialMaxIndex(profile);
  const clamped = Math.min(Math.max(0, index), maxIndex);
  return roundToCustomStep(profile.min + clamped * profile.step, profile);
}
