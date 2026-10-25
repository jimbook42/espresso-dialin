import { memo } from 'react';
import { shotScreenWeightGoalText } from '../flairPressureLab/shotScreenWeightGoalText.js';

/**
 * @param {{
 *   enabled: boolean,
 *   scaleConnected: boolean,
 *   scaleFeatureEnabled?: boolean,
 *   flairProfile?: Record<string, unknown> | null,
 *   targetYieldG?: string | number,
 *   timerRunning?: boolean,
 *   timerUsePreInfusion?: boolean,
 *   preInfusionPhase?: boolean,
 *   extractionElapsedS?: number,
 *   liveRelativeWeightG?: number,
 *   targetTimeMaxS?: string | number,
 * }} props
 */
function ShotTimerWeightGoalLineInner({
  enabled,
  scaleConnected,
  scaleFeatureEnabled = true,
  flairProfile,
  targetYieldG,
  timerRunning = false,
  timerUsePreInfusion = false,
  preInfusionPhase = false,
  extractionElapsedS = 0,
  liveRelativeWeightG = 0,
  targetTimeMaxS,
}) {
  const line = shotScreenWeightGoalText({
    flairProfile,
    targetYieldG,
    settingEnabled: enabled,
    scaleConnected,
    scaleFeatureEnabled,
    timerRunning,
    timerUsePreInfusion,
    preInfusionPhase,
    extractionElapsedS,
    liveRelativeWeightG,
    targetTimeMaxS,
  });
  if (!line) return null;

  return (
    <p
      className="shot-timer-weight-goals mt-1.5 text-center text-[14px] font-semibold leading-tight text-[#d4cfc4] shrink-0 max-w-sm px-1"
      data-testid="shot-timer-weight-goals"
    >
      {line}
    </p>
  );
}

export const ShotTimerWeightGoalLine = memo(ShotTimerWeightGoalLineInner);
