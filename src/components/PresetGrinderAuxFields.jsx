import { useEffect, useState } from 'react';
import {
  BARISTA_EXPRESS_GRINDER_ID,
  BARISTA_PRO_GRINDER_ID,
  BARISTA_TOUCH_GRINDER_ID,
  DF54_GRINDER_ID,
  DF64_GEN2_GRINDER_ID,
  getPresetGrinderSpec,
} from '../grinders/presetGrinders/index.js';
import {
  BARISTA_EXPRESS_UPPER_BURR_SHIFT_NOTE,
  BARISTA_PRO_TOUCH_UPPER_BURR_SHIFT_NOTE,
  presetOptionalDialField,
  presetUpperBurrSettingsKey,
  presetZeroOffsetSettingsKey,
  validatePresetUpperBurrInput,
  validatePresetZeroOffsetInput,
} from '../grinders/presetGrinders/presetOptionalFields.js';

function upperBurrShiftNote(grinderModel) {
  if (grinderModel === BARISTA_EXPRESS_GRINDER_ID) return BARISTA_EXPRESS_UPPER_BURR_SHIFT_NOTE;
  if (grinderModel === BARISTA_PRO_GRINDER_ID || grinderModel === BARISTA_TOUCH_GRINDER_ID) {
    return BARISTA_PRO_TOUCH_UPPER_BURR_SHIFT_NOTE;
  }
  return BARISTA_EXPRESS_UPPER_BURR_SHIFT_NOTE;
}

function committedUpperBurrToDraft(settings, key) {
  const committed = settings?.[key];
  return committed === undefined || committed === null ? '' : String(committed);
}

export function PresetGrinderAuxFields({ grinderModel, settings, onPatchSettings, ui, inputClass }) {
  const spec = getPresetGrinderSpec(grinderModel);
  const field = presetOptionalDialField(spec);
  const upperBurrKey = field === 'upperBurr' ? presetUpperBurrSettingsKey(grinderModel) : null;

  const zeroOffsetKey =
    field === 'zeroOffset' ? presetZeroOffsetSettingsKey(grinderModel) : null;

  const [upperBurrDraft, setUpperBurrDraft] = useState(() =>
    upperBurrKey ? committedUpperBurrToDraft(settings, upperBurrKey) : ''
  );
  const [upperBurrError, setUpperBurrError] = useState(null);
  const [upperBurrWarning, setUpperBurrWarning] = useState(null);
  const [zeroOffsetDraft, setZeroOffsetDraft] = useState(() => {
    if (!zeroOffsetKey) return '';
    const committed = settings?.[zeroOffsetKey];
    return committed === undefined || committed === null ? '' : String(committed);
  });

  useEffect(() => {
    if (!upperBurrKey) return;
    setUpperBurrDraft(committedUpperBurrToDraft(settings, upperBurrKey));
    setUpperBurrError(null);
    const validation = validatePresetUpperBurrInput(settings?.[upperBurrKey] ?? '');
    setUpperBurrWarning(validation.warning);
  }, [settings, upperBurrKey]);

  useEffect(() => {
    if (!zeroOffsetKey) return;
    const committed = settings?.[zeroOffsetKey];
    setZeroOffsetDraft(committed === undefined || committed === null ? '' : String(committed));
  }, [settings, zeroOffsetKey]);

  if (!field || !spec) return null;

  if (field === 'upperBurr' && upperBurrKey) {
    const key = upperBurrKey;
    const commitUpperBurrDraft = async (rawValue = upperBurrDraft) => {
      const next = validatePresetUpperBurrInput(rawValue);
      if (!next.ok) {
        setUpperBurrError(next.error);
        setUpperBurrDraft(committedUpperBurrToDraft(settings, key));
        setUpperBurrWarning(null);
        return;
      }
      setUpperBurrError(null);
      setUpperBurrWarning(next.warning);
      await onPatchSettings({ [key]: next.value });
    };

    return (
      <div className="space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
        <label className={`block ${ui.fieldLabel}`}>Upper burr position (optional)</label>
        <input
          type="text"
          inputMode="numeric"
          value={upperBurrDraft}
          onChange={(e) => {
            setUpperBurrError(null);
            setUpperBurrDraft(e.target.value);
          }}
          onBlur={(e) => {
            void commitUpperBurrDraft(e.target.value);
          }}
          placeholder="Factory default 6"
          className={`w-full ${inputClass} border rounded-lg p-2.5 font-semibold`}
          aria-invalid={upperBurrError ? true : undefined}
        />
        {upperBurrError && (
          <p className="text-[10px] text-[#d08080]" role="alert">{upperBurrError}</p>
        )}
        {upperBurrWarning && !upperBurrError && (
          <p className={`text-[10px] text-[#d0a060]`} role="status">{upperBurrWarning}</p>
        )}
        <p className={`text-[10px] ${ui.muted}`}>{upperBurrShiftNote(grinderModel)}</p>
      </div>
    );
  }

  if (field === 'zeroOffset') {
    const key = zeroOffsetKey;
    const label = 'Burr-touch zero (optional)';
    const hint =
      grinderModel === DF54_GRINDER_ID
        ? 'Dial reading when burrs first touch; starting point is typically zero + 15. Version differences between DF54 units are not well documented.'
        : 'Dial reading when burrs first touch; espresso is often roughly zero + 5–18 (start around zero + 10–15).';
    const commitZeroDraft = async (rawValue = zeroOffsetDraft) => {
      const next = validatePresetZeroOffsetInput(rawValue, spec);
      if (!next.ok) {
        const committed = settings?.[key];
        setZeroOffsetDraft(committed === undefined || committed === null ? '' : String(committed));
        return;
      }
      await onPatchSettings({ [key]: next.value });
    };
    return (
      <div className="space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
        <label className={`block ${ui.fieldLabel}`}>{label}</label>
        <input
          type="text"
          inputMode="decimal"
          value={zeroOffsetDraft}
          onChange={(e) => {
            setZeroOffsetDraft(e.target.value);
          }}
          onBlur={(e) => {
            void commitZeroDraft(e.target.value);
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
