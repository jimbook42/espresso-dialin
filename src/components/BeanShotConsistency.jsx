import { useMemo, useState } from 'react';

import {
  CONSISTENCY_MIN_SHOTS, RATING_COMPARISON_MIN_SHOTS, summarizeShotConsistency,
} from '../utils/shotConsistency.js';

function formatValue(metric, value) {
  const number = value.toFixed(metric.digits);
  return metric.key === 'ratio' ? `1:${number}` : `${number} ${metric.unit}`;
}

function ConsistencyDetails({ shots, ui, formatShotWhen }) {
  const { total, ratedCount, distribution, recent, metrics } = useMemo(() => summarizeShotConsistency(shots), [shots]);
  const sensorMetrics = metrics.filter(({ sensor }) => sensor);
  const comparisons = metrics.filter(({ groups }) => groups.length);
  return (
    <div className={`space-y-4 pb-3 text-xs ${ui.text}`} data-testid="bean-consistency-details">
      <section className="space-y-2">
        <h3 className="text-sm font-bold">Shot consistency</h3>
        <p className={ui.sub}>All {total} saved extractions for this bean. Each measurement needs {CONSISTENCY_MIN_SHOTS} comparable shots. Variation is the median distance from the median.</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {metrics.filter(({ sensor, stats }) => !sensor || stats).map((metric) => (
            <li key={metric.key} className={`${ui.metricCell} min-w-0 space-y-1 rounded-lg p-2.5`}>
              <h4 className="font-semibold">{metric.label}</h4>
              <p className={ui.sub}>
                {metric.count} comparable · {metric.missing} missing{metric.unsupported > 0 && ` · ${metric.unsupported} unsupported`}
              </p>
              {metric.stats ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 tabular-nums">
                  <dt>Median</dt><dd>{formatValue(metric, metric.stats.median)}</dd>
                  <dt>Range</dt><dd>{formatValue(metric, metric.stats.min)} – {formatValue(metric, metric.stats.max)}</dd>
                  <dt>Variation</dt><dd>{formatValue(metric, metric.stats.variation)}</dd>
                </dl>
              ) : <p>Too few comparable shots.</p>}
            </li>
          ))}
        </ul>
        {sensorMetrics.some(({ stats }) => !stats) && (
          <ul className={ui.sub}>
            {sensorMetrics.filter(({ stats }) => !stats).map(({ key, label, count, missing, unsupported }) => (
              <li key={key}>{label} unavailable · {count} comparable · {missing} missing{unsupported > 0 && ` · ${unsupported} unsupported`}</li>
            ))}
          </ul>
        )}
        {sensorMetrics.some(({ unsupported }) => unsupported > 0) && (
          <p className={ui.sub}>Pressure and flow need a verified device source and a continuous extraction recording.</p>
        )}
      </section>

      <section className={`space-y-2 border-t pt-3 ${ui.modalDivider}`}>
        <h3 className="text-sm font-bold">Taste ratings</h3>
        <p className={ui.sub}>{ratedCount} rated · {total - ratedCount} unrated</p>
        {ratedCount > 0 && (
          <dl className="grid grid-cols-5 gap-1 text-center tabular-nums" aria-label="Rating distribution">
            {distribution.map((count, index) => (
              <div key={index} className={`${ui.metricCell} rounded-lg py-1.5`}>
                <dt aria-label={`${index + 1} stars`}>{index + 1} ★</dt><dd>{count}</dd>
              </div>
            ))}
          </dl>
        )}
        {recent.length > 0 && (
          <div>
            <h4 className="font-semibold">Recent ratings · oldest to newest</h4>
            <ol className={`mt-1 space-y-1 ${ui.sub}`}>
              {recent.map(({ rating, timestamp }, index) => (
                <li key={index}>{formatShotWhen(timestamp)} · {rating} ★</li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <section className={`space-y-2 border-t pt-3 ${ui.modalDivider}`}>
        <h3 className="text-sm font-bold">Measurements by taste rating</h3>
        <p className={ui.sub}>Each comparison needs {RATING_COMPARISON_MIN_SHOTS} rated shots with the same measurement and at least two different ratings. Taste can reflect many factors, including the coffee and how it was prepared.</p>
        {comparisons.length ? (
          <dl className="space-y-2" aria-label="Median measurement by star rating">
            {comparisons.map((metric) => (
              <div key={metric.key}>
                <dt className="font-semibold">{metric.label} median</dt>
                {metric.groups.map(({ stars, count, median }) => (
                  <dd key={stars} className={ui.sub}>{stars} ★ · {formatValue(metric, median)} ({count} {count === 1 ? 'shot' : 'shots'})</dd>
                ))}
              </div>
            ))}
          </dl>
        ) : <p>No measurements meet the comparison threshold yet.</p>}
      </section>
    </div>
  );
}

export function BeanShotConsistency({ shots, ui, formatShotWhen, detailsRef }) {
  const [open, setOpen] = useState(false);
  return (
    <details ref={detailsRef} onToggle={(event) => setOpen(event.currentTarget.open)}
      className={`${ui.card} rounded-2xl px-3`}>
      <summary className={`min-h-11 cursor-pointer py-3 text-sm font-bold ${ui.text}`}>
        Bean consistency and ratings
      </summary>
      {open && <ConsistencyDetails shots={shots} ui={ui} formatShotWhen={formatShotWhen} />}
    </details>
  );
}
