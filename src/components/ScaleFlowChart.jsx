import { useId } from 'react';
import { flowRateSeriesFromWeightCurve } from '../scales/flowMetrics.js';

const AMBER = '#c88a4b';

/**
 * @param {{ flowCurve?: { tS: number, weightG: number }[], compact?: boolean, averageFlowRateGs?: number | null }} props
 */
export function ScaleFlowChart({ flowCurve = [], compact = false, averageFlowRateGs = null }) {
  const labelId = useId();
  if (!flowCurve?.length) return null;

  const flowSeries = flowRateSeriesFromWeightCurve(flowCurve);
  if (!flowSeries.length) return null;

  const w = compact ? 280 : 320;
  const h = compact ? 72 : 96;
  const padL = 8;
  const padR = 8;
  const padT = compact ? 12 : 14;
  const padB = compact ? 14 : 16;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const maxT = Math.max(...flowSeries.map((p) => p.tS), 1);
  const maxFlow = Math.max(...flowSeries.map((p) => p.flowGs), 0.5);
  const x = (t) => padL + (t / maxT) * chartW;
  const y = (flow) => padT + chartH - (flow / maxFlow) * chartH;

  const path = flowSeries
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.tS).toFixed(1)} ${y(p.flowGs).toFixed(1)}`)
    .join(' ');

  const avgLabel =
    averageFlowRateGs != null && Number.isFinite(averageFlowRateGs)
      ? `${averageFlowRateGs.toFixed(2)} g/s avg`
      : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span id={labelId} className="text-[9px] uppercase tracking-wider text-[#6b6457]">
          Scale flow (g/s vs time)
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
