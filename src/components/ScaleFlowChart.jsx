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
const AXIS = '#6b6457';

/**
 * @param {{
 *   flowCurve?: { tS: number, weightG: number }[],
 *   flowTimeOffsetSec?: number,
 *   compact?: boolean,
 *   averageFlowRateGs?: number | null,
 *   pressureSamples?: import('../flairPressureLab/pressureDisplaySmoothing.js').LabPressureRawSample[] | null,
 *   pressurePeakBar?: number | null,
 *   flairProfile?: Record<string, unknown> | null,
 * }} props
 */
export function ScaleFlowChart({
  flowCurve = [],
  flowTimeOffsetSec = 0,
  compact = false,
  averageFlowRateGs = null,
  pressureSamples = null,
  pressurePeakBar = null,
  flairProfile = null,
}) {
  const labelId = useId();
  if (!flowCurve?.length) return null;

  const flowSeries = flowRateSeriesFromWeightCurve(flowCurve).map((point) => ({
    ...point,
    tS: point.tS + flowTimeOffsetSec,
  }));
  if (!flowSeries.length) return null;

  const pressurePoints = pressureSamples?.length
    ? pressureChartPointsForSavedCurve(pressureSamples)
    : [];
  const hasRecordedPressure = Boolean(pressureSamples?.length);
  const showIdealPressure = Boolean(flairProfile) && !hasRecordedPressure;
  const showPressure = pressurePoints.length > 0 || showIdealPressure;

  const w = compact ? 280 : 320;
  const h = compact ? (showPressure ? 104 : 88) : showPressure ? 128 : 112;
  const padL = compact ? 32 : 38;
  const padR = showPressure ? (compact ? 30 : 36) : 8;
  const padT = compact ? 14 : 16;
  const padB = compact ? 22 : 24;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const maxT = Math.max(
    ...flowSeries.map((p) => p.tS),
    ...(showPressure ? pressurePoints.map((p) => p.tS) : []),
    1,
  );
  const timeAxisMax = Math.max(10, Math.ceil(maxT / 10) * 10);
  const maxFlow = Math.max(...flowSeries.map((p) => p.flowGs), 0.5);
  const flowAxisMax = Math.max(5, Math.ceil(maxFlow / 5) * 5);
  const x = (t) => padL + (t / timeAxisMax) * chartW;
  const yFlow = (flow) => padT + chartH - (flow / flowAxisMax) * chartH;

  const flowPath = flowSeries
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.tS).toFixed(1)} ${yFlow(p.flowGs).toFixed(1)}`)
    .join(' ');

  const pressureYMax = showPressure
    ? Math.max(10, historyPressureYMax(pressurePoints, flairProfile))
    : 1;
  const yBar = (bar) => shotPressureChartY(bar, pressureYMax, padT, chartH);
  const flowTicks = Array.from(
    { length: flowAxisMax / 5 + 1 },
    (_, i) => i * 5,
  );
  const timeTicks = Array.from(
    { length: timeAxisMax / 10 + 1 },
    (_, i) => i * 10,
  );
  const axisBottom = padT + chartH;
  const axisRight = padL + chartW;

  let idealPath = '';
  if (showPressure && showIdealPressure) {
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
      .map((p, i) => `${i === 0 || p.breakBefore ? 'M' : 'L'} ${x(p.tS).toFixed(1)} ${yBar(p.bar).toFixed(1)}`)
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
        <g data-testid="history-flow-axis" fill={AXIS} fontSize="8" fontFamily="system-ui, sans-serif">
          <line x1={padL} y1={padT} x2={padL} y2={axisBottom} stroke={AXIS} strokeWidth="0.75" />
          {flowTicks.map((tick) => {
            const y = yFlow(tick);
            return (
              <g key={tick}>
                <line x1={padL - 3} y1={y} x2={padL} y2={y} stroke={AXIS} strokeWidth="0.75" />
                <text
                  x={padL - 5}
                  y={y + 2.5}
                  textAnchor="end"
                  data-testid="history-flow-tick"
                >
                  {tick}
                </text>
              </g>
            );
          })}
          <text
            x="8"
            y={padT + chartH / 2}
            textAnchor="middle"
            transform={`rotate(-90 8 ${padT + chartH / 2})`}
            data-testid="history-flow-axis-label"
          >
            g/s
          </text>
        </g>
        <g data-testid="history-time-axis" fill={AXIS} fontSize="8" fontFamily="system-ui, sans-serif">
          <line x1={padL} y1={axisBottom} x2={axisRight} y2={axisBottom} stroke={AXIS} strokeWidth="0.75" />
          {timeTicks.map((tick) => {
            const tickX = x(tick);
            return (
              <g key={tick}>
                <line x1={tickX} y1={axisBottom} x2={tickX} y2={axisBottom + 3} stroke={AXIS} strokeWidth="0.75" />
                <text
                  x={tickX}
                  y={axisBottom + 12}
                  textAnchor="middle"
                  data-testid="history-time-tick"
                >
                  {tick}s
                </text>
              </g>
            );
          })}
        </g>
        {showPressure && (
          <g data-testid="history-pressure-axis" fill={AXIS} fontSize="8" fontFamily="system-ui, sans-serif">
            <line x1={axisRight} y1={padT} x2={axisRight} y2={axisBottom} stroke={AXIS} strokeWidth="0.75" />
            {[0, 5, 10].map((tick) => {
              const y = yBar(tick);
              return (
                <g key={tick}>
                  <line x1={axisRight} y1={y} x2={axisRight + 3} y2={y} stroke={AXIS} strokeWidth="0.75" />
                  <text
                    x={axisRight + 5}
                    y={y + 2.5}
                    textAnchor="start"
                    data-testid="history-pressure-tick"
                  >
                    {tick}
                  </text>
                </g>
              );
            })}
          </g>
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
        <path
          d={flowPath}
          fill="none"
          stroke={AMBER}
          strokeWidth="2"
          strokeLinejoin="round"
          data-testid="history-flow"
        />
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
