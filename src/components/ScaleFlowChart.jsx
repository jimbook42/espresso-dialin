import { pressureGapBridges } from './pressureGapBridges.js';
import { useId } from 'react';
import { flowRateSeriesFromWeightCurve, FLOW_PLOT_SMOOTH_WINDOW_S, SCALE_FLOW_MAX_SAMPLE_GAP_S } from '../scales/flowMetrics.js';
import { pressureChartPointsForDisplay, labPressureCurvePlotTimeS } from '../flairPressureLab/pressureDisplaySmoothing.js';
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
  profile = null,
  view = 'flow',
  cursorS = null,
  onPickTime,
}) {
  const labelId = useId();
  if (!profile && !flowCurve?.length) return null;

  const flowSeries = profile?.flow ?? flowRateSeriesFromWeightCurve(flowCurve, FLOW_PLOT_SMOOTH_WINDOW_S, SCALE_FLOW_MAX_SAMPLE_GAP_S).map((point) => ({
    ...point,
    tS: point.tS + flowTimeOffsetSec,
  }));

  const pressurePoints = profile?.displayPressure ?? (pressureSamples?.length
    ? pressureChartPointsForDisplay(pressureSamples)
    : []);
  const hasRecordedPressure = Boolean(pressureSamples?.length);
  const showIdealPressure = !profile && Boolean(flairProfile) && !hasRecordedPressure;
  const showPressure = profile ? view === 'pressure' || view === 'combined' : pressurePoints.length > 0 || showIdealPressure;
  const showPrimary = !profile || view !== 'pressure';
  const isWeight = view === 'weight';
  const primaryKey = isWeight ? 'weightG' : 'flowGs';
  const primaryPoints = isWeight ? profile.weight : flowSeries;
  const primaryUnit = isWeight ? 'g' : 'g/s';
  const label = { pressure: 'Pressure (bar)', weight: 'Scale weight (g)',
    flow: 'Flow rate (g/s)', combined: 'Pressure (bar) and flow (g/s)' };

  const w = compact ? 280 : 320;
  const h = profile ? 160 : compact ? (showPressure ? 104 : 88) : showPressure ? 128 : 112;
  const padL = compact ? 32 : 38;
  const padR = showPressure && showPrimary ? (compact ? 30 : 36) : profile ? 16 : 8;
  const padT = compact ? 14 : 16;
  const padB = compact ? 22 : 24;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const maxT = profile?.maxTimeS ?? Math.max(
    ...flowCurve.map((p) => p.tS + flowTimeOffsetSec),
    ...(showPressure ? pressurePoints.map((p) => labPressureCurvePlotTimeS(p.tS)) : []),
    1,
  );
  const timeAxisMin = profile ? Math.floor(profile.minTimeS) : 0;
  const timeStep = profile ? Math.max(1, Math.ceil((maxT - timeAxisMin) / 5)) : 10;
  const timeAxisMax = Math.max(timeStep, Math.ceil(maxT / timeStep) * timeStep);
  const [primaryMin, primaryMax] = primaryPoints.reduce(([min, max], p) =>
    [Math.min(min, p[primaryKey]), Math.max(max, p[primaryKey])], [0, 0.5]);
  const primaryStep = profile ? Math.max(isWeight ? 1 : 0.5, Math.ceil((primaryMax - primaryMin) / 2)) : 5;
  const yMin = Math.floor(primaryMin / primaryStep) * primaryStep;
  const yMax = Math.ceil(primaryMax / primaryStep) * primaryStep;
  const x = (t) => padL + ((t - timeAxisMin) / (timeAxisMax - timeAxisMin)) * chartW;
  const yPrimary = (value) => padT + chartH - ((value - yMin) / (yMax - yMin)) * chartH;

  const pathFor = (points, key, xAt, yAt) => points
    .map((p, i) => `${i === 0 || p.breakBefore ? 'M' : 'L'} ${xAt(p.tS).toFixed(1)} ${yAt(p[key]).toFixed(1)}`)
    .join(' ');
  const primaryPath = showPrimary ? pathFor(primaryPoints, primaryKey, x, yPrimary) : '';

  const pressureYMax = showPressure
    ? Math.max(10, historyPressureYMax(pressurePoints, flairProfile))
    : 1;
  const yBar = (bar) => shotPressureChartY(bar, pressureYMax, padT, chartH);
  const primaryTicks = Array.from(
    { length: Math.min(16, Math.round((yMax - yMin) / primaryStep) + 1) },
    (_, i) => yMin + i * primaryStep,
  );
  const timeTicks = Array.from(
    { length: Math.min(16, Math.floor(timeAxisMax / timeStep) + 1 + Number(timeAxisMin < 0)) },
    (_, i) => timeAxisMin < 0 ? (i === 0 ? timeAxisMin : (i - 1) * timeStep) : i * timeStep,
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

  const pressureX = profile ? x : (tS) => x(labPressureCurvePlotTimeS(tS));
  const bridges = pressureGapBridges(pressurePoints);

  const pressurePath = showPressure ? pathFor(pressurePoints, 'bar', pressureX, yBar) : '';
  const isolatedPoints = (points) => points.filter((p, i) => (i === 0 || p.breakBefore)
    && (!points[i + 1] || points[i + 1].breakBefore));

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
    <div className="space-y-1" data-testid={view === 'pressure' ? 'shot-pressure-chart' : 'scale-flow-chart'}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span id={labelId} className={profile ? 'text-xs font-semibold' : 'text-[9px] uppercase tracking-wider text-[#6b6457]'}>
          {profile ? label[view] : 'Scale flow (g/s vs time)'}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {showPressure && showPrimary && (
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
        onClick={onPickTime && ((event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const fraction = ((event.clientX - bounds.left) * w / bounds.width - padL) / chartW;
          onPickTime(timeAxisMin + fraction * (timeAxisMax - timeAxisMin));
        })}
      >
        {showPrimary && <g data-testid="history-flow-axis" fill={profile ? 'currentColor' : AXIS} fontSize={profile ? 10 : 8} fontFamily="system-ui, sans-serif">
          <line x1={padL} y1={padT} x2={padL} y2={axisBottom} stroke={AXIS} strokeWidth="0.75" />
          {primaryTicks.map((tick) => {
            const y = yPrimary(tick);
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
            {primaryUnit}
          </text>
        </g>}
        <g data-testid="history-time-axis" fill={profile ? 'currentColor' : AXIS} fontSize={profile ? 10 : 8} fontFamily="system-ui, sans-serif">
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
          <g data-testid="history-pressure-axis" fill={profile ? 'currentColor' : AXIS} fontSize={profile ? 10 : 8} fontFamily="system-ui, sans-serif">
            <line x1={showPrimary ? axisRight : padL} y1={padT} x2={showPrimary ? axisRight : padL} y2={axisBottom} stroke={AXIS} strokeWidth="0.75" />
            {(profile ? [0, pressureYMax / 2, pressureYMax] : [0, 5, 10]).map((tick) => {
              const y = yBar(tick);
              const axisX = showPrimary ? axisRight : padL;
              return (
                <g key={tick}>
                  <line x1={axisX} y1={y} x2={axisX + (showPrimary ? 3 : -3)} y2={y} stroke={AXIS} strokeWidth="0.75" />
                  <text
                    x={axisX + (showPrimary ? 5 : -5)}
                    y={y + 2.5}
                    textAnchor={showPrimary ? 'start' : 'end'}
                    data-testid="history-pressure-tick"
                  >
                    {tick}
                  </text>
                </g>
              );
            })}
          </g>
        )}
        {profile?.extractionStartS > 0 && (
          <rect x={x(0)} y={padT} width={x(profile.extractionStartS) - x(0)} height={chartH} fill="currentColor" opacity="0.08" />
        )}
        {profile?.extractionEndS != null && (
          <line x1={x(profile.extractionEndS)} x2={x(profile.extractionEndS)} y1={padT} y2={axisBottom}
            stroke="currentColor" opacity="0.45" strokeDasharray="4 3" data-testid="profile-extraction-end" />
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
        {showPrimary && <path
          d={primaryPath}
          fill="none"
          stroke={AMBER}
          strokeWidth="2"
          strokeLinejoin="round"
          data-testid={isWeight ? 'history-weight' : 'history-flow'}
        />}
        {showPressure && bridges.map(([before, after], index) => (
          <path
            key={index}
            d={`M ${pressureX(before.tS).toFixed(1)} ${yBar(before.bar).toFixed(1)} L ${pressureX(after.tS).toFixed(1)} ${yBar(after.bar).toFixed(1)}`}
            fill="none"
            stroke={pressureLiveStroke}
            strokeWidth="1"
            strokeDasharray="1 3"
            strokeLinecap="round"
            opacity={hasDimPressure ? 0.75 : 1}
            data-testid="pressure-gap-bridge"
          />
        ))}
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
        {profile && showPrimary && isolatedPoints(primaryPoints).map((p) => (
          <circle key={p.tS} cx={x(p.tS)} cy={yPrimary(p[primaryKey])} r="2" fill={AMBER} />
        ))}
        {profile && showPressure && isolatedPoints(pressurePoints).map((p, i) => (
          <circle key={i} cx={pressureX(p.tS)} cy={yBar(p.bar)} r="2" fill={pressureLiveStroke} />
        ))}
        {cursorS != null && (
          <line x1={x(cursorS)} x2={x(cursorS)} y1={padT} y2={axisBottom}
            stroke="currentColor" strokeWidth="1" opacity="0.8" data-testid="profile-time-cursor" />
        )}
      </svg>
    </div>
  );
}
