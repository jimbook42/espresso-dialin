import { useMemo, useState } from 'react';
import { flowPointsForPlot, FLOW_STROKE, LIVE_FLOW_STROKE, splitFlowPlot, typicalFlowRange } from '../scales/flowPlotRange.js';
import { buildComparisonProfile, buildExtractionFlowPlot } from '../utils/shotProfile.js';

const measurements = [
  { id: 'pressure', label: 'Pressure', key: 'bar', unit: 'bar' },
  { id: 'weight', label: 'Weight', key: 'weightG', unit: 'g' },
  { id: 'flow', label: 'Flow', key: 'flowGs', unit: 'g/s' },
];
const seriesStyles = [
  { label: 'Selected shot', stroke: '#b87333' },
  { label: 'Bean reference', stroke: '#508cbf', dash: '5 3' },
];
const metric = (value, unit) => value == null ? '—' : `${value} ${unit}`;
const measurementStroke = (id, index) => id === 'flow'
  ? [FLOW_STROKE, LIVE_FLOW_STROKE][index] : seriesStyles[index].stroke;

function axis(min, max, count, minimumStep) {
  const step = Math.max(minimumStep, Math.ceil((max - min) / count / minimumStep) * minimumStep);
  const first = Math.floor(min / step) * step;
  const last = Math.max(first + step, Math.ceil(max / step) * step);
  return { first, last, ticks: Array.from({ length: Math.round((last - first) / step) + 1 }, (_, i) => first + i * step) };
}

function ComparisonChart({ seriesByShot, measurement, timeAxis, timeLabel }) {
  const { id, label, key, unit } = measurement;
  const [min, max] = id === 'flow'
    ? seriesByShot.map((series) => typicalFlowRange(series)).reduce(([lo, hi], [low, high]) =>
      [Math.min(lo, low), Math.max(hi, high)], [0, 0])
    : seriesByShot.flat().reduce(([lo, hi], point) => [Math.min(lo, point[key]), Math.max(hi, point[key])], [0, 0]);
  const values = axis(min, max, 3, 0.5);
  const x = (time) => 36 + 268 * (time - timeAxis.first) / (timeAxis.last - timeAxis.first);
  const y = (value) => 113 - 100 * (value - values.first) / (values.last - values.first);

  return (
    <svg viewBox="0 0 320 153" role="img" aria-label={`${label} (${unit}) — ${timeLabel}`}
      className="mx-auto block w-full max-w-xl">
      <text x="4" y="10" fill="currentColor" fontSize="9">{unit}</text>
      {values.ticks.map((value) => (
        <g key={value}>
          <text x="31" y={y(value) + 3} textAnchor="end" fill="currentColor" fontSize="9">{value}</text>
          <line x1="36" x2="304" y1={y(value)} y2={y(value)} stroke="currentColor" opacity="0.17" />
        </g>
      ))}
      {timeAxis.ticks.map((time) => (
        <text key={time} x={x(time)} y="128" textAnchor="middle" fill="currentColor" fontSize="9">{time}</text>
      ))}
      <text x="170" y="145" textAnchor="middle" fill="currentColor" fontSize="10">{timeLabel} (s)</text>
      {seriesByShot.map((series, index) => {
        if (!series.length) return null;
        const { label: name, dash } = seriesStyles[index];
        const stroke = measurementStroke(id, index);
        const { visible, outliers } = id === 'flow' ? splitFlowPlot(series, values.first, values.last)
          : { visible: series, outliers: [] };
        const trace = id === 'flow' ? flowPointsForPlot(visible, timeAxis.first, timeAxis.last, 268) : visible;
        return (
          <g key={name} data-testid={`comparison-${index === 0 ? 'selected' : 'reference'}-series`}>
            <path d={trace.map((point, i) =>
              `${i === 0 || point.breakBefore ? 'M' : 'L'}${x(point.tS).toFixed(2)},${y(point[key]).toFixed(2)}`).join(' ')}
              stroke={stroke} strokeWidth="2" strokeDasharray={dash} fill="none" />
            {trace.filter((point, i) => (i === 0 || point.breakBefore)
              && (i === trace.length - 1 || trace[i + 1].breakBefore)).map((point) => (
              <circle key={point.tS} cx={x(point.tS)} cy={y(point[key])} r="2.4" fill={stroke} />
            ))}
            {outliers.map(({ tS, flowGs }) => (
              <circle key={tS} cx={x(tS)} cy={y(flowGs > values.last ? values.last : values.first)}
                r="3" fill={stroke}><title>{flowGs.toFixed(2)} g/s at {tS.toFixed(2)} s</title></circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function isApproximate(profile, id) {
  return id === 'pressure' ? profile.pressureTimingUnavailable : profile.scaleTimingApproximate;
}

function recordingSeries(profile, id) {
  return id === 'pressure' && profile.pressureTimingUnavailable ? profile.recordingPressure : profile[id];
}

export function ShotComparison({ shot, referenceShot, referenceDate, ui, smoothFlow = true }) {
  const profiles = useMemo(() => [shot, referenceShot].map((item) => ({
    ...buildComparisonProfile(item),
    flow: buildExtractionFlowPlot(item, smoothFlow),
  })), [shot, referenceShot, smoothFlow]);
  const [view, setView] = useState(null);
  const available = measurements.filter(({ id }) => profiles.some((profile) => recordingSeries(profile, id).length > 0));
  const measurement = available.find(({ id }) => id === view) ?? available[0];
  const [minTime, maxTime] = profiles.reduce(([min, max], profile) => measurements.reduce(([lo, hi], { id }) => (
    isApproximate(profile, id) ? [lo, hi] : [
      Math.min(lo, profile[id][0]?.tS ?? 0), Math.max(hi, profile[id].at(-1)?.tS ?? 0),
    ]
  ), [min, max]), [0, 0]);
  const timeAxis = axis(minTime, maxTime, 5, 1);
  const alignedSeries = measurement ? profiles.map((profile) => isApproximate(profile, measurement.id)
    ? [] : profile[measurement.id]) : [];

  return (
    <div className={`space-y-2 pb-3 ${ui.text}`} data-testid="shot-comparison">
      <div className="grid grid-cols-2 gap-2">
        {profiles.map(({ durationS, doseG, yieldG }, index) => {
          const { label, dash } = seriesStyles[index];
          const stroke = measurementStroke(measurement?.id, index);
          return (
            <div key={label} className={`min-w-0 rounded-lg p-2 text-xs ${ui.metricCell}`}>
              <div className="flex flex-wrap items-center gap-x-1.5 font-semibold">
                <svg width="22" height="8" aria-hidden="true">
                  <line x1="0" x2="22" y1="4" y2="4" stroke={stroke} strokeWidth="2" strokeDasharray={dash} />
                </svg>
                {label}
              </div>
              {index === 1 && <p className={ui.sub}>{referenceDate}</p>}
              <dl className="mt-1 space-y-0.5 tabular-nums">
                {[
                  ['Time', metric(durationS, 's')], ['Dose', metric(doseG, 'g')], ['Yield', metric(yieldG, 'g')],
                ].map(([name, value]) => (
                  <div key={name} className="flex flex-wrap justify-between gap-x-1">
                    <dt className={ui.sub}>{name}</dt><dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
      {measurement ? (
        <>
          {available.length > 1 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Comparison measurement">
              {available.map(({ id, label }) => (
                <button key={id} type="button" aria-pressed={measurement.id === id} onClick={() => setView(id)}
                  className={`min-h-11 flex-1 rounded-lg px-2 text-xs font-semibold ${measurement.id === id ? ui.chartToggleActive : ui.chartToggleIdle}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {alignedSeries.some((series) => series.length > 0) && (
            <ComparisonChart seriesByShot={alignedSeries} measurement={measurement} timeAxis={timeAxis}
              timeLabel="Time from extraction start" />
          )}
          {profiles.map((profile, index) => {
            const { id, label } = measurement;
            const series = recordingSeries(profile, id);
            const approximate = isApproximate(profile, id);
            const verified = profile.sources[id === 'pressure' ? 'pressure' : 'scale'];
            const disconnected = id !== 'pressure' && profile.scaleDisconnected && profile.weight.length > 0;
            const status = [
              series.length === 0 && `${label.toLowerCase()} unavailable`,
              disconnected && 'scale disconnected',
              series.length > 0 && (verified ? 'measured source' : 'device source unverified'),
              series.length > 0 && approximate && 'approximate alignment to extraction',
            ].filter(Boolean);
            return (
              <div key={index} className={`text-xs ${ui.sub}`}>
                <p>{seriesStyles[index].label}: {status.join(' · ')}.</p>
                {approximate && series.length > 0 && (
                  <ComparisonChart seriesByShot={profiles.map((_, i) => i === index ? series : [])}
                    measurement={measurement} timeAxis={axis(0, series.at(-1).tS, 5, 1)} timeLabel="Sensor recording time" />
                )}
              </div>
            );
          })}
        </>
      ) : <p className={`text-xs ${ui.sub}`}>No sensor curves available for comparison.</p>}
    </div>
  );
}
