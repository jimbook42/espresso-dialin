import { useId } from 'react';

const AMBER = '#c88a4b';

/**
 * @param {{ flowCurve?: { tS: number, weightG: number }[], compact?: boolean, averageFlowRateGs?: number | null }} props
 */
export function ScaleFlowChart({ flowCurve = [], compact = false, averageFlowRateGs = null }) {
  const labelId = useId();
  if (!flowCurve?.length) return null;

  const w = compact ? 280 : 320;
  const h = compact ? 72 : 96;
  const padL = 8;
  const padR = 8;
  const padT = compact ? 12 : 14;
  const padB = compact ? 14 : 16;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const maxT = Math.max(...flowCurve.map((p) => p.tS), 1);
  const maxW = Math.max(...flowCurve.map((p) => p.weightG), 1);
  const x = (t) => padL + (t / maxT) * chartW;
  const y = (g) => padT + chartH - (g / maxW) * chartH;

  const path = flowCurve
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.tS).toFixed(1)} ${y(p.weightG).toFixed(1)}`)
    .join(' ');

  const avgLabel =
    averageFlowRateGs != null && Number.isFinite(averageFlowRateGs)
      ? `${averageFlowRateGs.toFixed(2)} g/s avg`
      : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span id={labelId} className="text-[9px] uppercase tracking-wider text-[#6b6457]">
          Scale flow (yield vs time)
        </span>
        {avgLabel && <span className="text-[9px] font-semibold text-[#c88a4b]">{avgLabel}</span>}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto"
        role="img"
        aria-labelledby={labelId}
      >
        <path d={path} fill="none" stroke={AMBER} strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
