import { labPressureNeedsGaugeSetup } from '../flairPressureLab/shotLabPressureTrust.js';

/**
 * Lab status + re-calibrate under the shot Start row (Connect scale stays above in ScaleTimerControls).
 */
export function LabPressureStartPanel({
  enabled,
  calibrated,
  viewMoved,
  onRecalibrate,
  onDisable,
  ui,
}) {
  if (!enabled) return null;
  const needsSetup = labPressureNeedsGaugeSetup({ calibration: calibrated, viewMoved });
  return (
    <div className="space-y-2" data-testid="lab-pressure-start-panel">
      <p className={`text-[10px] font-semibold ${ui?.sub ?? 'text-[#a09880]'}`} data-testid="lab-pressure-status-line">
        {needsSetup ? 'Camera pressure on · Set up gauge' : 'Camera pressure on · Gauge calibrated'}
      </p>
      <div className="flex flex-wrap gap-x-4">
        <button
          type="button"
          onClick={onRecalibrate}
          className={`text-[10px] font-semibold underline min-h-[44px] ${ui?.accentText ?? 'text-[#c97868]'}`}
          data-testid="lab-pressure-recalibrate-btn"
        >
          {needsSetup ? 'Set up gauge' : 'Re-calibrate gauge'}
        </button>
        {onDisable && (
          <button type="button" onClick={onDisable} className={`min-h-11 text-xs ${ui.sub}`}>
            Turn off camera pressure
          </button>
        )}
      </div>
    </div>
  );
}
