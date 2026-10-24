import { useId } from 'react';
import { pressureChartPointsFromRaw } from '../flairPressureLab/pressureDisplaySmoothing.js';

const PRESSURE_STROKE = '#7eb8da';

/**
 * @param {{
 *   samples?: import('../flairPressureLab/pressureDisplaySmoothing.js').LabPressureRawSample[],
 *   compact?: boolean,
 *   peakBar?: number | null,
 * }} props
 */
export function ShotPressureChart({ samples = [], compact = false, peakBar = null }) {
  const labelId = useId();
  const points = pressureChartPointsFromRaw(samples);
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
  const maxBar = Math.max(...points.map((p) => p.bar), 1);
  const x = (t) => padL + (t / maxT) * chartW;
  const y = (bar) => padT + chartH - (bar / maxBar) * chartH;

  let path = '';
  points.forEach((p, i) => {
    const cmd = i === 0 ? 'M' : 'L';
    const opacity = p.dim ? 0.45 : 1;
    path += `${cmd} ${x(p.tS).toFixed(1)} ${y(p.bar).toFixed(1)} `;
    if (p.dim && i > 0) {
      // dim segments still connect; stroke opacity handled on whole path below
    }
  });

  const hasDim = points.some((p) => p.dim);
  const peakLabel =
    peakBar != null && Number.isFinite(peakBar) ? `peak ${peakBar.toFixed(1)} bar` : null;

  return (
    <div className="space-y-0.5" data-testid="shot-pressure-chart">
      <div className="flex items-center justify-between gap-2">
        <span id={labelId} className="text-[9px] uppercase tracking-wider text-[#6b6457]">
          Camera pressure (bar)
        </span>
        {peakLabel && (
          <span className="text-[9px] font-semibold text-[#7eb8da] tabular-nums">{peakLabel}</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto"
        role="img"
        aria-labelledby={labelId}
      >
        <path
          d={path.trim()}
          fill="none"
          stroke={PRESSURE_STROKE}
          strokeWidth="2"
          strokeLinejoin="round"
          opacity={hasDim ? 0.75 : 1}
        />
      </svg>
    </div>
  );
}
