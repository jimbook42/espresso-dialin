import {
  labPressureStatusText,
  labPressureCameraPreviewEnabled,
} from '../flairPressureLab/shotLabPressureTrust.js';

/**
 * Lab status + re-calibrate under the shot Start row (Connect scale stays above in ScaleTimerControls).
 */
export function LabPressureStartPanel({
  enabled,
  calibrated,
  viewMoved,
  readerReady,
  onRecalibrate,
  ui,
}) {
  if (!enabled) return null;
  const status = labPressureStatusText({
    enabled,
    calibrated,
    viewMoved,
    readerReady,
  });
  return (
    <div className="space-y-2" data-testid="lab-pressure-start-panel">
      {status && (
        <p className={`text-[10px] font-semibold ${ui?.sub ?? 'text-[#a09880]'}`} data-testid="lab-pressure-status-line">
          {status}
        </p>
      )}
      <button
        type="button"
        onClick={onRecalibrate}
        className={`text-[10px] font-semibold underline min-h-[44px] ${ui?.accentText ?? 'text-[#c97868]'}`}
        data-testid="lab-pressure-recalibrate-btn"
      >
        Re-calibrate gauge
      </button>
    </div>
  );
}

export function labPressurePreviewEnabledFromSettings(settings) {
  return labPressureCameraPreviewEnabled(settings);
}
