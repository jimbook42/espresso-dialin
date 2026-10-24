import { useId } from 'react';
import { pressureChartPointsForDisplay } from '../flairPressureLab/pressureDisplaySmoothing.js';
import {
  shotPressureChartY,
  shotPressureChartYMax,
} from '../flairPressureLab/shotPressureChartLayout.js';
import { pressureLiveStroke } from '../flairPressureLab/shotLabPressureTokens.js';

/**
 * @param {{
 *   samples?: import('../flairPressureLab/pressureDisplaySmoothing.js').LabPressureRawSample[],
 *   compact?: boolean,
 *   peakBar?: number | null,
 *   phaseGoal?: {
 *     targetBar?: number | null,
 *     taperBand?: { lowBar: number, highBar: number } | null,
 *     chartMaxBar?: number | null,
 *   },
 * }} props
 */
export function ShotPressureChart({
  samples = [],
  compact = false,
  peakBar = null,
  phaseGoal = null,
}) {
  const labelId = useId();
  const points = pressureChartPointsForDisplay(samples);
  if (!points.length) return null;

  const w = compact ? 280 : 320;
  const h = compact ? 56 : 72;
  const padL = 8;
  const padR = 8;
  const padT = compact ? 10 : 12;
  const padB = compact ? 12 : 14;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const maxT = Math.max(...points.map((p) => p.tS), 1);
  const goalBars = [
    phaseGoal?.targetBar,
    phaseGoal?.taperBand?.lowBar,
    phaseGoal?.taperBand?.highBar,
  ].filter((v) => v != null && Number.isFinite(v));
  const yMax = shotPressureChartYMax({
    chartMaxBar: phaseGoal?.chartMaxBar,
    sampleBars: points.map((p) => p.bar),
    goalBars,
  });
  const x = (t) => padL + (t / maxT) * chartW;
  const y = (bar) => shotPressureChartY(bar, yMax, padT, chartH);

  let path = '';
  points.forEach((p, i) => {
    const cmd = i === 0 ? 'M' : 'L';
    path += `${cmd} ${x(p.tS).toFixed(1)} ${y(p.bar).toFixed(1)} `;
  });

  const hasDim = points.some((p) => p.dim);
  const peakLabel =
    peakBar != null && Number.isFinite(peakBar) ? `peak ${peakBar.toFixed(1)} bar` : null;

  const goalLineY =
    phaseGoal?.targetBar != null && Number.isFinite(phaseGoal.targetBar)
      ? y(phaseGoal.targetBar)
      : null;
  const taperLow =
    phaseGoal?.taperBand?.lowBar != null ? y(phaseGoal.taperBand.lowBar) : null;
  const taperHigh =
    phaseGoal?.taperBand?.highBar != null ? y(phaseGoal.taperBand.highBar) : null;

  return (
    <div className="space-y-0.5" data-testid="shot-pressure-chart">
      <div className="flex items-center justify-between gap-2">
        <span id={labelId} className="text-[9px] uppercase tracking-wider text-[#6b6457]">
          Camera pressure (bar)
        </span>
        {peakLabel && (
          <span className="text-[9px] font-semibold text-[#c97868] tabular-nums">{peakLabel}</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto"
        role="img"
        aria-labelledby={labelId}
      >
        {taperLow != null && taperHigh != null && (
          <rect
            x={padL}
            y={Math.min(taperLow, taperHigh)}
            width={chartW}
            height={Math.abs(taperHigh - taperLow)}
            fill="rgba(201, 120, 104, 0.08)"
          />
        )}
        {goalLineY != null && (
          <line
            x1={padL}
            x2={padL + chartW}
            y1={goalLineY}
            y2={goalLineY}
            stroke="rgba(201, 120, 104, 0.35)"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
        )}
        <path
          d={path.trim()}
          fill="none"
          stroke={pressureLiveStroke}
          strokeWidth="2"
          strokeLinejoin="round"
          opacity={hasDim ? 0.75 : 1}
        />
      </svg>
    </div>
  );
}
