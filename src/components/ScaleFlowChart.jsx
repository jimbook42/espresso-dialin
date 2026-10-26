import { useId } from 'react';
import { flowRateSeriesFromWeightCurve } from '../scales/flowMetrics.js';
import { pressureChartPointsForSavedCurve } from '../flairPressureLab/pressureDisplaySmoothing.js';
import { shotPressureChartY } from '../flairPressureLab/shotPressureChartLayout.js';
import { pressureLiveStroke } from '../flairPressureLab/shotLabPressureTokens.js';
import {
  historyPressureYMax,
  idealPressureSeriesForShot,
} from './scaleFlowPressureOverlay.js';

const AMBER = '#c88a4b';
const PROFILE_AMBER = 'rgba(200, 138, 75, 0.35)';

/**
 * @param {{
 *   flowCurve?: { tS: number, weightG: number }[],
 *   compact?: boolean,
 *   averageFlowRateGs?: number | null,
 *   pressureSamples?: import('../flairPressureLab/pressureDisplaySmoothing.js').LabPressureRawSample[] | null,
 *   pressurePeakBar?: number | null,
 *   flairProfile?: Record<string, unknown> | null,
 * }} props
 */
export function ScaleFlowChart({
  flowCurve = [],
  compact = false,
  averageFlowRateGs = null,
  pressureSamples = null,
  pressurePeakBar = null,
  flairProfile = null,
}) {
  const labelId = useId();
  if (!flowCurve?.length) return null;

  const flowSeries = flowRateSeriesFromWeightCurve(flowCurve);
  if (!flowSeries.length) return null;

  const pressurePoints = pressureSamples?.length
    ? pressureChartPointsForSavedCurve(pressureSamples)
    : [];
  const showPressure = pressurePoints.length > 0;

  const w = compact ? 280 : 320;
  const h = compact ? (showPressure ? 88 : 72) : showPressure ? 112 : 96;
  const padL = showPressure ? 22 : 8;
  const padR = showPressure ? 26 : 8;
  const padT = compact ? 12 : 14;
  const padB = compact ? 14 : 16;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const maxT = Math.max(
    ...flowSeries.map((p) => p.tS),
    ...(showPressure ? pressurePoints.map((p) => p.tS) : []),
    1,
  );
  const maxFlow = Math.max(...flowSeries.map((p) => p.flowGs), 0.5);
  const x = (t) => padL + (t / maxT) * chartW;
  const yFlow = (flow) => padT + chartH - (flow / maxFlow) * chartH;

  const flowPath = flowSeries
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.tS).toFixed(1)} ${yFlow(p.flowGs).toFixed(1)}`)
    .join(' ');

  const pressureYMax = showPressure ? historyPressureYMax(pressurePoints, flairProfile) : 1;
  const yBar = (bar) => shotPressureChartY(bar, pressureYMax, padT, chartH);

  let idealPath = '';
  if (showPressure && flairProfile) {
    const ideal = idealPressureSeriesForShot(flairProfile, maxT);
    if (ideal.length) {
      idealPath = ideal
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.tS).toFixed(1)} ${yBar(p.bar).toFixed(1)}`)
        .join(' ');
    }
  }

  let pressurePath = '';
  if (showPressure) {
    pressurePath = pressurePoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.tS).toFixed(1)} ${yBar(p.bar).toFixed(1)}`)
      .join(' ');
  }

  const hasDimPressure = showPressure && pressurePoints.some((p) => p.dim);

  const avgLabel =
    averageFlowRateGs != null && Number.isFinite(averageFlowRateGs)
      ? `${averageFlowRateGs.toFixed(2)} g/s avg`
      : null;

  const peakLabel =
    showPressure && pressurePeakBar != null && Number.isFinite(pressurePeakBar)
      ? `peak ${pressurePeakBar.toFixed(1)} bar`
      : null;

  return (
    <div className="space-y-1" data-testid="scale-flow-chart">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span id={labelId} className="text-[9px] uppercase tracking-wider text-[#6b6457]">
          Scale flow (g/s vs time)
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {showPressure && (
            <span className="text-[9px] uppercase tracking-wider text-[#6b6457]">
              <span className="inline-block w-2 h-0.5 align-middle mr-1" style={{ background: pressureLiveStroke }} />
              bar
            </span>
          )}
          {peakLabel && (
            <span className="text-[9px] font-semibold text-[#c97868] tabular-nums">{peakLabel}</span>
          )}
          {avgLabel && <span className="text-[9px] font-semibold text-[#c88a4b]">{avgLabel}</span>}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto"
        role="img"
        aria-labelledby={labelId}
        data-pressure-overlay={showPressure ? 'true' : 'false'}
      >
        {showPressure && (
          <>
            <text
              x={padL - 4}
              y={padT + 8}
              fill="#6b6457"
              fontSize="8"
              textAnchor="end"
              fontFamily="system-ui, sans-serif"
            >
              {pressureYMax.toFixed(0)}
            </text>
            <text
              x={padL - 4}
              y={padT + chartH}
              fill="#6b6457"
              fontSize="8"
              textAnchor="end"
              fontFamily="system-ui, sans-serif"
            >
              0
            </text>
          </>
        )}
        {idealPath && (
          <path
            d={idealPath}
            fill="none"
            stroke={PROFILE_AMBER}
            strokeWidth="1.5"
            strokeLinejoin="round"
            data-testid="history-ideal-pressure"
          />
        )}
        <path d={flowPath} fill="none" stroke={AMBER} strokeWidth="2" strokeLinejoin="round" />
        {pressurePath && (
          <path
            d={pressurePath}
            fill="none"
            stroke={pressureLiveStroke}
            strokeWidth="2"
            strokeLinejoin="round"
            opacity={hasDimPressure ? 0.75 : 1}
            data-testid="history-measured-pressure"
          />
        )}
      </svg>
    </div>
  );
}
