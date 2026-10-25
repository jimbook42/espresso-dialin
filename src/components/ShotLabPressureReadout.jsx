import { memo } from 'react';
import { labPressureReadoutState } from '../flairPressureLab/pressureDisplaySmoothing.js';
import {
  pressureLiveBorderClass,
  pressureLiveTextClass,
} from '../flairPressureLab/shotLabPressureTokens.js';
import { ShotPressureChart } from './ShotPressureChart.jsx';
import { DIAL_RECALIBRATE_HINT } from '../flairPressureLab/hooks/useShotLabPressure.js';

/**
 * @param {{
 *   displayBar: number | null,
 *   hold: { held?: boolean, gap?: boolean },
 *   readerUncertain?: boolean,
 *   peakBar: number | null,
 *   samples: import('../flairPressureLab/pressureDisplaySmoothing.js').LabPressureRawSample[],
 *   variant: 'inline' | 'fullscreen' | 'weighing',
 *   viewportWidth?: number,
 *   phaseGoal?: { targetBar?: number | null, taperBand?: { lowBar: number, highBar: number } | null },
 *   testingLabel?: string | null,
 *   dialRecalibrateHint?: boolean,
 *   ui?: { muted?: string, accentText?: string, text?: string },
 * }} props
 */
function ShotLabPressureReadoutInner({
  displayBar,
  hold = {},
  readerUncertain = false,
  peakBar,
  samples,
  variant,
  viewportWidth,
  phaseGoal,
  testingLabel,
  dialRecalibrateHint = false,
  ui,
}) {
  const uncertain = readerUncertain === true;
  const readout = labPressureReadoutState(uncertain ? null : displayBar, {
    held: hold.held === true,
    gap: hold.gap === true || uncertain,
  });
  const muted = ui?.muted ?? 'text-[#6b6457]';
  const accent = ui?.accentText ?? pressureLiveTextClass;

  const barClass =
    variant === 'fullscreen' || variant === 'weighing'
      ? `font-bold tabular-nums tracking-tight leading-none text-[clamp(1.75rem,10vw,2.75rem)] ${
          readout.dim ? 'text-[#5a5754] opacity-70' : pressureLiveTextClass
        }`
      : `font-black tabular-nums text-[clamp(1.25rem,6vw,1.75rem)] leading-none ${
          readout.dim ? `${muted} opacity-70` : accent
        }`;

  const peakChip =
    peakBar != null && Number.isFinite(peakBar) ? (
      <span
        className={`shrink-0 whitespace-nowrap text-[10px] font-semibold px-2 py-0.5 rounded-full border ${pressureLiveBorderClass} ${
          readout.dim ? 'opacity-60' : accent
        } tabular-nums`}
        data-testid="shot-pressure-peak-chip"
      >
        {peakBar.toFixed(1)} peak
      </span>
    ) : null;

  return (
    <div
      className={`${
        variant === 'weighing'
          ? 'mt-1 w-full max-w-xs shrink-0'
          : variant === 'fullscreen'
            ? 'mt-2 w-full max-w-sm shrink-0'
            : 'mt-2'
      } space-y-1`}
      data-testid="shot-lab-pressure-readout"
      role="status"
      aria-live="polite"
    >
      {testingLabel && (
        <span
          className="text-[9px] uppercase tracking-wider text-[#6b6457]"
          data-testid="shot-lab-pressure-testing-label"
        >
          {testingLabel}
        </span>
      )}
      {dialRecalibrateHint && (
        <p
          className="text-[10px] leading-snug text-amber-700/90"
          data-testid="shot-lab-dial-recalibrate-hint"
        >
          {DIAL_RECALIBRATE_HINT}
        </p>
      )}
      <div className="flex flex-nowrap items-end justify-between gap-2 w-full min-w-0">
        <div className="flex flex-nowrap items-baseline gap-1.5 min-w-0">
          <span className={`text-[9px] uppercase tracking-wider shrink-0 ${muted}`}>Bar</span>
          <span className={barClass} aria-label={`Pressure ${readout.text} bar`}>
            {readout.text}
          </span>
        </div>
        {peakChip}
      </div>
      <ShotPressureChart
        samples={samples}
        compact={variant === 'inline' || variant === 'weighing'}
        peakBar={null}
        phaseGoal={phaseGoal}
      />
    </div>
  );
}

export const ShotLabPressureReadout = memo(ShotLabPressureReadoutInner);
