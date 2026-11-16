import { useMemo, useState } from 'react';
import { buildComparisonProfile } from '../utils/shotProfile.js';

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

function axis(min, max, count, minimumStep) {
  const step = Math.max(minimumStep, Math.ceil((max - min) / count / minimumStep) * minimumStep);
  const first = Math.floor(min / step) * step;
  const last = Math.max(first + step, Math.ceil(max / step) * step);
  return { first, last, ticks: Array.from({ length: Math.round((last - first) / step) + 1 }, (_, i) => first + i * step) };
}

function ComparisonChart({ profiles, measurement, timeAxis }) {
  const { id, label, key, unit } = measurement;
  const points = profiles.flatMap((profile) => profile[id]);
  const [min, max] = points.reduce(([lo, hi], point) => [Math.min(lo, point[key]), Math.max(hi, point[key])], [0, 0]);
  const values = axis(min, max, 3, 0.5);
  const x = (time) => 36 + 268 * (time - timeAxis.first) / (timeAxis.last - timeAxis.first);
  const y = (value) => 113 - 100 * (value - values.first) / (values.last - values.first);

  return (
    <svg viewBox="0 0 320 153" role="img" aria-label={`${label} (${unit}) by time from extraction start`}
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
      <text x="170" y="145" textAnchor="middle" fill="currentColor" fontSize="10">From extraction start (s)</text>
      {profiles.map((profile, index) => {
        const series = profile[id];
        if (!series.length) return null;
        const { label: name, stroke, dash } = seriesStyles[index];
        return (
          <g key={name} data-testid={`comparison-${index === 0 ? 'selected' : 'reference'}-series`}>
            <path d={series.map((point, i) =>
              `${i === 0 || point.breakBefore ? 'M' : 'L'}${x(point.tS).toFixed(2)},${y(point[key]).toFixed(2)}`).join(' ')}
              stroke={stroke} strokeWidth="2" strokeDasharray={dash} fill="none" />
            {series.filter((point, i) => (i === 0 || point.breakBefore)
              && (i === series.length - 1 || series[i + 1].breakBefore)).map((point) => (
              <circle key={point.tS} cx={x(point.tS)} cy={y(point[key])} r="2.4" fill={stroke} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function ShotComparison({ shot, referenceShot, referenceDate, ui }) {
  const profiles = useMemo(() => [buildComparisonProfile(shot), buildComparisonProfile(referenceShot)], [shot, referenceShot]);
  const [view, setView] = useState(null);
  const available = measurements.filter(({ id }) => profiles.some((profile) => profile[id].length > 0));
  const measurement = available.find(({ id }) => id === view) ?? available[0];
  const [minTime, maxTime] = profiles.reduce(([min, max], profile) => measurements.reduce(([lo, hi], { id }) => [
    Math.min(lo, profile[id][0]?.tS ?? 0), Math.max(hi, profile[id].at(-1)?.tS ?? 0),
  ], [min, max]), [0, 0]);
  const timeAxis = axis(minTime, maxTime, 5, 1);

  return (
    <div className={`space-y-2 pb-3 ${ui.text}`} data-testid="shot-comparison">
      <div className="grid grid-cols-2 gap-2">
        {profiles.map(({ durationS, doseG, yieldG }, index) => {
          const { label, stroke, dash } = seriesStyles[index];
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
          <ComparisonChart profiles={profiles} measurement={measurement} timeAxis={timeAxis} />
          {measurement.id === 'flow' && <p className={`text-xs ${ui.sub}`}>Flow is calculated between consecutive scale readings.</p>}
          {profiles.map((profile, index) => !profile[measurement.id].length && (
            <p key={index} className={`text-xs ${ui.sub}`}>
              {seriesStyles[index].label}: {measurement.label.toLowerCase()} unavailable.
            </p>
          ))}
        </>
      ) : <p className={`text-xs ${ui.sub}`}>No sensor curves available for comparison.</p>}
      {profiles.map((profile, index) => profile.pressureTimingUnavailable && (
        <p key={index} className={`text-xs ${ui.sub}`}>{seriesStyles[index].label}: pressure recording has no reliable extraction timing.</p>
      ))}
    </div>
  );
}
