import { useState } from 'react';
import { SettingsToggle } from './SettingsToggle.jsx';
import { CustomGrinderForm } from './CustomGrinderForm.jsx';
import { isCustomGrinderFormValid } from '../grinders/customGrinder.js';
import { listGrinderPickerOptions, CUSTOM_GRINDER_PICKER_ID } from '../grinders/grinderRegistry.js';
import {
  listSmartScalePickerOptions,
  SMART_SCALE_MANUAL_ID,
  SMART_SCALE_NOT_LISTED_ID,
} from '../settings/scalePreference.js';

const STEPS = ['grinder', 'scale', 'extras'];

export function FirstLaunchWizard({
  ui,
  grinderPickerValue,
  onGrinderPickerChange,
  customGrinderDraft,
  onCustomGrinderDraftChange,
  smartScaleDeviceId,
  onSmartScaleChange,
  useSmartScale,
  onUseSmartScaleChange,
  setupFlairEnabled,
  onSetupFlairChange,
  setupPreInfusionEnabled,
  onSetupPreInfusionChange,
  setupBrewGuideEnabled,
  onSetupBrewGuideChange,
  onComplete,
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const pickerOptions = listGrinderPickerOptions();
  const scaleOptions = listSmartScalePickerOptions();
  const isCustom = grinderPickerValue === CUSTOM_GRINDER_PICKER_ID;
  const grinderReady = isCustom
    ? isCustomGrinderFormValid(customGrinderDraft)
    : Boolean(grinderPickerValue);

  const canNext = step !== 'grinder' || grinderReady;

  const goNext = () => {
    if (stepIndex < STEPS.length - 1) setStepIndex((i) => i + 1);
    else onComplete();
  };

  const goBack = () => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  };

  return (
    <div className={`min-h-screen ${ui.page} flex items-center justify-center p-6`}>
      <div className={`${ui.card} p-8 rounded-2xl max-w-md w-full space-y-6 shadow-2xl`}>
        <div className="flex flex-col items-center gap-3">
          <img src="/logo.jpg" alt="Espresso Dial-In" className="w-16 h-16 rounded-full object-cover ring-2 ring-[#2e2b26]" />
          <div className="text-center">
            <h1 className="text-xl font-bold text-[#f5f2eb] tracking-tight">Welcome</h1>
            <p className="text-xs text-[#6b6457] mt-1">Set up grinder, scale, and optional features</p>
          </div>
          <div className="flex gap-2 pt-1" aria-label="Progress">
            {STEPS.map((s, idx) => (
              <span
                key={s}
                className={`w-2 h-2 rounded-full ${idx === stepIndex ? 'bg-[#c88a4b]' : idx < stepIndex ? 'bg-[#8a9d72]' : 'bg-[#2e2b26]'}`}
              />
            ))}
          </div>
        </div>

        {step === 'grinder' && (
          <div className="space-y-3">
            <label className="text-[10px] uppercase tracking-widest text-[#6b6457] font-bold">Primary grinder</label>
            <select
              value={grinderPickerValue || ''}
              onChange={(e) => onGrinderPickerChange(e.target.value)}
              className="w-full bg-[#211e1a] border border-[#2e2b26] text-[#f5f2eb] rounded-lg p-2.5 text-sm font-semibold"
            >
              <option value="" disabled>Select your grinder</option>
              {pickerOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
            {!isCustom && grinderPickerValue && (
              <p className="text-[11px] text-[#6b6457]">
                {pickerOptions.find((o) => o.id === grinderPickerValue)?.hint}
              </p>
            )}
            {isCustom && (
              <CustomGrinderForm
                value={customGrinderDraft}
                onChange={onCustomGrinderDraftChange}
                ui={ui}
              />
            )}
          </div>
        )}

        {step === 'scale' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 bg-[#211e1a] border border-[#2e2b26] rounded-xl p-4">
              <div>
                <p className="text-sm font-bold text-[#f5f2eb]">Smart scale</p>
                <p className="text-[11px] text-[#6b6457] mt-1">Optional BLE scale for live weight and flow (manual timing still works).</p>
              </div>
              <SettingsToggle
                checked={useSmartScale}
                onChange={onUseSmartScaleChange}
                label="Use smart scale"
              />
            </div>
            {useSmartScale && (
              <div>
                <label className="text-[10px] uppercase tracking-widest text-[#6b6457] font-bold block mb-1">
                  Supported scale
                </label>
                <select
                  value={smartScaleDeviceId === SMART_SCALE_MANUAL_ID ? '' : smartScaleDeviceId}
                  onChange={(e) => onSmartScaleChange(e.target.value || SMART_SCALE_MANUAL_ID)}
                  className="w-full bg-[#211e1a] border border-[#2e2b26] text-[#f5f2eb] rounded-lg p-2.5 text-sm font-semibold"
                >
                  <option value="" disabled>Select scale model</option>
                  {scaleOptions.filter((o) => o.id !== SMART_SCALE_MANUAL_ID).map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
                {smartScaleDeviceId === SMART_SCALE_NOT_LISTED_ID && (
                  <p className="text-[11px] text-[#a09880] mt-2">
                    No problem — you can log shots with manual dose, yield, and time. Add your scale to the registry later.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {step === 'extras' && (
          <div className="space-y-3">
            <p className="text-sm text-[#c4bcaa] text-center">Optional features — change anytime in Settings.</p>
            <div className="bg-[#211e1a] border border-[#2e2b26] rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#f5f2eb]">Enable Flair manual profile</p>
                <p className="text-[11px] text-[#6b6457] mt-1">For Flair lever machines: pressure chart and water temperature on Dial-In.</p>
              </div>
              <SettingsToggle checked={setupFlairEnabled} onChange={onSetupFlairChange} label="Enable Flair manual profile" />
            </div>
            <div className="bg-[#211e1a] border border-[#2e2b26] rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#f5f2eb]">Track pre-infusion time</p>
                <p className="text-[11px] text-[#6b6457] mt-1">Adds a pre-soak phase to the shot timer before extraction time.</p>
              </div>
              <SettingsToggle
                checked={setupPreInfusionEnabled}
                onChange={onSetupPreInfusionChange}
                label="Track pre-infusion time"
              />
            </div>
            <div className="bg-[#211e1a] border border-[#2e2b26] rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#f5f2eb]">Would you like to use the Brew Guide?</p>
                <p className="text-[11px] text-[#6b6457] mt-1">Optional checklists and full-screen brew steps tied to your recipe.</p>
              </div>
              <SettingsToggle checked={setupBrewGuideEnabled} onChange={onSetupBrewGuideChange} label="Brew Guide" />
            </div>
          </div>
        )}

        {(step === 'grinder' || step === 'scale' || step === 'extras') && (
          <p className="text-[11px] text-[#6b6457] text-center leading-relaxed">
            You can change these in Settings later.
          </p>
        )}

        <div className="flex gap-2 pt-2">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={goBack}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-[#211e1a] border border-[#2e2b26] text-[#f5f2eb]"
            >
              Back
            </button>
          )}
          <button
            type="button"
            disabled={!canNext}
            onClick={goNext}
            className="flex-1 py-3 rounded-xl font-bold text-sm bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] disabled:opacity-40"
          >
            {stepIndex === STEPS.length - 1 ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
