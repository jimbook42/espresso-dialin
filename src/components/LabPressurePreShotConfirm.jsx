/**
 * Pre-shot zero check when Lab camera pressure is enabled.
 */
export function LabPressurePreShotConfirm({ open, onYes, onRecalibrate, onCancel, ui }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[64] flex items-center justify-center bg-black/70 px-6"
      role="dialog"
      aria-modal="true"
      aria-label="Gauge zero check"
      data-testid="lab-pressure-zero-confirm"
    >
      <div className={`${ui?.card ?? 'bg-[#1a1815] border border-[#2e2b26]'} rounded-2xl p-5 max-w-sm w-full space-y-4`}>
        <p className={`text-sm font-semibold ${ui?.text ?? 'text-[#f5f2eb]'}`}>
          Does the gauge read 0 at rest?
        </p>
        <p className={`text-[11px] ${ui?.muted ?? 'text-[#6b6457]'}`}>
          Point the camera at the gauge before you start. If the needle is not on zero, re-calibrate.
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onYes}
            className={`w-full min-h-[48px] rounded-xl font-bold ${ui?.primary ?? 'bg-[#c88a4b] text-[#121110]'}`}
          >
            Yes, start shot
          </button>
          <button
            type="button"
            onClick={onRecalibrate}
            className={`w-full min-h-[44px] rounded-xl font-semibold ${ui?.secondaryBtn ?? ''}`}
          >
            No — re-calibrate
          </button>
          <button type="button" onClick={onCancel} className={`text-xs ${ui?.ghostBtn ?? ''}`}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
