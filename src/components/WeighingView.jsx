import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { normalizeBatteryPercent } from '../scales/scaleBattery.js';
import { useOverlayHistoryClose } from '../hooks/useOverlayHistoryClose.js';
import { formatScaleLiveWeightLabel } from './ScaleTimerControls.jsx';
import { formatWeighingTargetDoseLine, parseRecipeTargetDoseG } from './weighingViewFormat.js';
import {
  resolveWeighingColorState,
  weighingWeightColorForState,
  weighingWeightIsBold,
} from './weighingViewColor.js';
import {
  readWeighingTargetFeedbackSession,
  writeWeighingTargetFeedbackSession,
} from './weighingViewSession.js';

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
  const [targetFeedbackEnabled, setTargetFeedbackEnabled] = useState(() => readWeighingTargetFeedbackSession());

  const toggleTargetFeedback = useCallback(() => {
    setTargetFeedbackEnabled((prev) => {
      const next = !prev;
      writeWeighingTargetFeedbackSession(next);
      return next;
    });
  }, []);

  if (!open) return null;

  const hasRecipeTarget = parseRecipeTargetDoseG(targetDoseG) != null;
  const targetLine = targetFeedbackEnabled
    ? formatWeighingTargetDoseLine(liveWeightG, targetDoseG)
    : null;
  const colorState = resolveWeighingColorState(liveWeightG, targetDoseG, targetFeedbackEnabled);
  const weightColor = weighingWeightColorForState(colorState.state, colorState.approach);
  const battery = normalizeBatteryPercent(batteryPercent);
  const gramsDisplay = formatScaleLiveWeightLabel(liveWeightG).replace(/ g$/, '');
  const hitLockClass = colorState.state === 'hit' ? 'weighing-lock-hit' : '';

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
          className={`text-[clamp(4rem,22vw,6.5rem)] font-black font-mono tabular-nums tracking-tight leading-none ${hitLockClass} ${
            weighingWeightIsBold(colorState.state) ? 'font-black' : ''
          }`}
          style={weightColor ? { color: weightColor } : undefined}
          role="status"
          aria-live="polite"
          aria-label={`Scale weight ${formatScaleLiveWeightLabel(liveWeightG)}`}
        >
          {gramsDisplay}
          <span className="text-[clamp(1.5rem,6vw,2.25rem)] font-bold text-[#a09880] ml-2">g</span>
        </p>

        {hasRecipeTarget && targetLine != null && (
          <button
            type="button"
            onClick={toggleTargetFeedback}
            className={`text-lg font-semibold tabular-nums ${ui.muted} px-3 py-1 rounded-lg active:opacity-70`}
            aria-label="Toggle target dose feedback"
            aria-pressed="true"
          >
            {targetLine}
          </button>
        )}

        {hasRecipeTarget && !targetFeedbackEnabled && (
          <button
            type="button"
            onClick={toggleTargetFeedback}
            className={`text-xs uppercase tracking-widest ${ui.muted} px-3 py-2 rounded-lg border border-[#2e2b26] active:opacity-70`}
            aria-label="Show target dose feedback"
            aria-pressed="false"
          >
            Show target dose
          </button>
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
