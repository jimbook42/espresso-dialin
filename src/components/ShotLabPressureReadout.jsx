import { memo } from 'react';
import { labPressureReadoutState } from '../flairPressureLab/pressureDisplaySmoothing.js';
import { shotLabPressureStacked } from '../flairPressureLab/shotLabPressureLayout.js';
import { ShotPressureChart } from './ShotPressureChart.jsx';

/**
 * @param {{
 *   displayBar: number | null,
 *   hold: { held?: boolean, gap?: boolean },
 *   peakBar: number | null,
 *   samples: import('../flairPressureLab/pressureDisplaySmoothing.js').LabPressureRawSample[],
 *   variant: 'inline' | 'fullscreen' | 'weighing',
 *   viewportWidth?: number,
 *   ui?: { muted?: string, accentText?: string, text?: string },
 * }} props
 */
function ShotLabPressureReadoutInner({
  displayBar,
  hold = {},
  peakBar,
  samples,
  variant,
  viewportWidth,
  ui,
}) {
  const readout = labPressureReadoutState(displayBar, {
    held: hold.held === true,
    gap: hold.gap === true,
  });
  const stacked = shotLabPressureStacked(viewportWidth);
  const muted = ui?.muted ?? 'text-[#6b6457]';
  const accent = ui?.accentText ?? 'text-[#7eb8da]';

  const barClass =
    variant === 'fullscreen' || variant === 'weighing'
      ? `font-bold tabular-nums tracking-tight leading-none text-[clamp(1.75rem,10vw,2.75rem)] ${
          readout.dim ? 'text-[#5a5754] opacity-70' : 'text-[#7eb8da]'
        }`
      : `font-black tabular-nums text-[clamp(1.25rem,6vw,1.75rem)] leading-none ${
          readout.dim ? `${muted} opacity-70` : accent
        }`;

  const peakChip =
    peakBar != null && Number.isFinite(peakBar) ? (
      <span
        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border border-[#7eb8da]/35 ${
          readout.dim ? 'opacity-60' : ''
        } ${accent} tabular-nums`}
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
            ? 'mt-3 w-full max-w-sm'
            : 'mt-2'
      } space-y-1`}
      data-testid="shot-lab-pressure-readout"
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex items-end gap-2 ${stacked ? 'flex-col items-start' : 'justify-between'}`}
      >
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className={`text-[9px] uppercase tracking-wider ${muted}`}>Bar</span>
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
      />
    </div>
  );
}

export const ShotLabPressureReadout = memo(ShotLabPressureReadoutInner);
