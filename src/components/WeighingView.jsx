import { X } from 'lucide-react';
import { normalizeBatteryPercent } from '../scales/scaleBattery.js';
import { useOverlayHistoryClose } from '../hooks/useOverlayHistoryClose.js';
import { formatScaleLiveWeightLabel } from './ScaleTimerControls.jsx';
import { formatWeighingTargetDoseLine } from './weighingViewFormat.js';

/**
 * Full-screen live weighing when the scale is connected and the shot timer is idle.
 */
export function WeighingView({
  open,
  onClose,
  ui,
  liveWeightG = 0,
  targetDoseG,
  batteryPercent = null,
  onTare,
}) {
  const requestClose = useOverlayHistoryClose(open, onClose);

  if (!open) return null;

  const targetLine = formatWeighingTargetDoseLine(liveWeightG, targetDoseG);
  const battery = normalizeBatteryPercent(batteryPercent);
  const gramsDisplay = formatScaleLiveWeightLabel(liveWeightG).replace(/ g$/, '');

  return (
    <div
      className="fixed inset-0 z-[62] flex flex-col bg-[#121110] text-[#f5f2eb] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      role="dialog"
      aria-modal="true"
      aria-label="Live scale weight"
    >
      <div className="flex items-center justify-end p-4 shrink-0">
        <button
          type="button"
          onClick={requestClose}
          className={`${ui.ghostBtn} p-2 min-h-[48px] min-w-[48px] flex items-center justify-center`}
          aria-label="Close weighing view"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6 min-h-0">
        <p
          className="text-[clamp(4rem,22vw,6.5rem)] font-black font-mono tabular-nums tracking-tight leading-none"
          role="status"
          aria-live="polite"
          aria-label={`Scale weight ${formatScaleLiveWeightLabel(liveWeightG)}`}
        >
          {gramsDisplay}
          <span className="text-[clamp(1.5rem,6vw,2.25rem)] font-bold text-[#a09880] ml-2">g</span>
        </p>

        {targetLine != null && (
          <p className={`text-lg font-semibold tabular-nums ${ui.muted}`}>{targetLine}</p>
        )}

        {battery != null && (
          <p className={`text-sm font-medium tabular-nums ${ui.muted}`}>{Math.round(battery)}% battery</p>
        )}

        <button
          type="button"
          onClick={onTare}
          className="mt-4 min-h-[52px] px-10 rounded-2xl text-base font-bold bg-[rgba(200,138,75,0.18)] text-[#c88a4b] border border-[rgba(200,138,75,0.35)] active:scale-[0.99]"
        >
          Tare
        </button>
      </div>
    </div>
  );
}
