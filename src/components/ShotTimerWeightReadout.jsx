import { memo, useSyncExternalStore } from 'react';
import {
  getScaleLiveWeightSnapshot,
  resolveShotWeightReadout,
  subscribeScaleLiveWeight,
} from '../scales/scaleLiveWeightStore.js';

function formatGrams(g) {
  const n = Number(g);
  if (!Number.isFinite(n)) return '0.0';
  return n.toFixed(1);
}

/**
 * Isolated live scale weight for shot timers (subscribes to weight bus — no App props per tick).
 *
 * @param {{
 *   variant: 'fullscreen' | 'dial-inline' | 'brew-guide',
 *   timerRunning: boolean,
 *   showFlow?: boolean,
 *   instantFlowGs?: number | null,
 *   darkMode?: boolean,
 *   ui?: { accentText?: string, muted?: string },
 * }} props
 */
function ShotTimerWeightReadoutInner({
  variant,
  timerRunning,
  showFlow = false,
  instantFlowGs = null,
  darkMode = true,
  ui,
}) {
  const snap = useSyncExternalStore(subscribeScaleLiveWeight, getScaleLiveWeightSnapshot);
  const { visible, grams, mode } = resolveShotWeightReadout({
    timerRunning,
    weightTriggersPrimed: snap.weightTriggersPrimed,
    liveRelativeWeightG: snap.liveRelativeWeightG,
    liveWeightG: snap.liveWeightG,
    isConnected: snap.isConnected,
  });

  if (!visible) return null;

  const isLiveShot = mode === 'shot';
  const flowSuffix =
    showFlow && instantFlowGs != null
      ? ` · ${instantFlowGs.toFixed(2)} g/s`
      : '';

  if (variant === 'fullscreen') {
    return (
      <div className="mt-3 text-center" role="status" aria-live="polite">
        <p
          className={`font-bold tabular-nums tracking-tight leading-none text-[clamp(2.75rem,16vw,4.25rem)] ${
            isLiveShot ? 'text-[#e8b872]' : 'text-[#5a5754] line-through decoration-[#4a4846]'
          }`}
          aria-label={isLiveShot ? `Shot weight ${formatGrams(grams)} grams` : 'Scale reading not ready'}
        >
          {formatGrams(grams)}
          <span className="text-[0.42em] font-semibold align-baseline ml-1 text-[#c88a4b]/90">g</span>
        </p>
        {!isLiveShot && (
          <p className="text-[10px] uppercase tracking-[0.14em] text-[#6b6457] mt-2">Scale settling</p>
        )}
        {flowSuffix && isLiveShot && (
          <p className="text-[15px] text-[#8a9d72] font-medium tabular-nums mt-2">{flowSuffix.replace(/^ · /, '')}</p>
        )}
      </div>
    );
  }

  if (variant === 'brew-guide') {
    const liveClass = ui?.accentText ?? 'text-[#c88a4b]';
    const staleClass = ui?.muted ?? 'text-[#6b6457]';
    return (
      <div className="text-center" role="status" aria-live="polite">
        <p
          className={`font-black tabular-nums leading-none text-[clamp(2.25rem,12vw,3.25rem)] ${
            isLiveShot ? liveClass : `${staleClass} line-through opacity-70`
          }`}
        >
          {formatGrams(grams)}g
        </p>
        {!isLiveShot && (
          <p className={`text-[10px] uppercase tracking-wide mt-1 ${staleClass}`}>Scale settling</p>
        )}
      </div>
    );
  }

  const liveClass = darkMode ? 'text-[#e8b872]' : ui?.accentText ?? 'text-[#a06830]';
  const staleClass = darkMode ? 'text-[#6b6457] line-through' : `${ui?.muted ?? 'text-[#8a8276]'} line-through opacity-80`;
  return (
    <div role="status" aria-live="polite">
      <p className={`font-black tabular-nums mt-2 text-[clamp(1.75rem,8vw,2.75rem)] leading-none ${isLiveShot ? liveClass : staleClass}`}>
        {formatGrams(grams)}g
        {flowSuffix && isLiveShot && (
          <span className={`text-base font-semibold ml-2 ${ui?.muted ?? 'text-[#6b6457]'}`}>
            {instantFlowGs.toFixed(2)} g/s
          </span>
        )}
      </p>
      {!isLiveShot && (
        <p className={`text-[10px] uppercase tracking-wide mt-1 ${ui?.muted ?? 'text-[#6b6457]'}`}>Scale settling</p>
      )}
    </div>
  );
}

export const ShotTimerWeightReadout = memo(ShotTimerWeightReadoutInner);
