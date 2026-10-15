import {
  BARISTA_EXPRESS_GRINDER_ID,
  DF54_GRINDER_ID,
  DF64_GEN2_GRINDER_ID,
  getPresetGrinderSpec,
} from '../grinders/presetGrinders/index.js';
import {
  BARISTA_EXPRESS_UPPER_BURR_SHIFT_NOTE,
  presetOptionalDialField,
  presetUpperBurrSettingsKey,
  presetZeroOffsetSettingsKey,
  validatePresetUpperBurrInput,
  validatePresetZeroOffsetInput,
} from '../grinders/presetGrinders/presetOptionalFields.js';

export function PresetGrinderAuxFields({ grinderModel, settings, onPatchSettings, ui, inputClass }) {
  const spec = getPresetGrinderSpec(grinderModel);
  const field = presetOptionalDialField(spec);
  if (!field || !spec) return null;

  if (field === 'upperBurr' && grinderModel === BARISTA_EXPRESS_GRINDER_ID) {
    const key = presetUpperBurrSettingsKey(grinderModel);
    const raw = settings?.[key];
    const validation = validatePresetUpperBurrInput(raw ?? '');
    return (
      <div className="space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
        <label className={`block ${ui.fieldLabel}`}>Upper burr position (optional)</label>
        <input
          type="number"
          min={1}
          max={10}
          value={raw ?? ''}
          onChange={(e) => {
            const next = validatePresetUpperBurrInput(e.target.value);
            if (!next.ok) return;
            onPatchSettings({ [key]: next.value });
          }}
          placeholder={`Factory default ${6}`}
          className={`w-full ${inputClass} border rounded-lg p-2.5 font-semibold`}
        />
        {validation.warning && (
          <p className={`text-[10px] text-[#d0a060]`} role="status">{validation.warning}</p>
        )}
        <p className={`text-[10px] ${ui.muted}`}>{BARISTA_EXPRESS_UPPER_BURR_SHIFT_NOTE}</p>
      </div>
    );
  }

  if (field === 'zeroOffset') {
    const key = presetZeroOffsetSettingsKey(grinderModel);
    const raw = settings?.[key];
    const label =
      grinderModel === DF64_GEN2_GRINDER_ID
        ? 'Burr-touch zero (optional)'
        : 'Burr-touch zero (optional)';
    const hint =
      grinderModel === DF54_GRINDER_ID
        ? 'Dial reading when burrs first touch; starting point is typically zero + 15. Version differences between DF54 units are not well documented.'
        : 'Dial reading when burrs first touch; espresso is often roughly zero + 5–18 (start around zero + 10–15).';
    return (
      <div className="space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
        <label className={`block ${ui.fieldLabel}`}>{label}</label>
        <input
          type="number"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={raw ?? ''}
          onChange={(e) => {
            const next = validatePresetZeroOffsetInput(e.target.value, spec);
            if (!next.ok) return;
            onPatchSettings({ [key]: next.value });
          }}
          placeholder="e.g. 0"
          className={`w-full ${inputClass} border rounded-lg p-2.5 font-semibold`}
        />
        <p className={`text-[10px] ${ui.muted}`}>{hint}</p>
      </div>
    );
  }

  return null;
}
