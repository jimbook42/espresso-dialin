import { useState } from 'react';
import { buildPressureFlowAnalytics } from '../utils/pressureFlowAnalytics.js';
import { ScaleFlowChart } from './ScaleFlowChart.jsx';

function AnalysisDetails({ shot, ui }) {
  const analysis = buildPressureFlowAnalytics(shot);
  const { pressure, flow, displayFlow, bands, durationS, observedPeakBar, averageBar, fullExtractionAverageBar,
    timeToPeakS, preinfusionS, pressureCoverage } = analysis;
  const view = pressure.length && displayFlow.length ? 'combined' : pressure.length ? 'pressure' : 'flow';
  const metrics = [
    ['Observed extraction peak', observedPeakBar, 'bar'],
    [fullExtractionAverageBar != null ? 'Extraction average (near-complete coverage)' : 'Average pressure over observed intervals',
      averageBar, 'bar', pressureCoverage?.averageUnavailableReason],
    ['Time to observed peak', timeToPeakS, 's'],
    ...(preinfusionS != null ? [['Timed pre-infusion', preinfusionS, 's']] : []),
  ];

  return (
    <div className={`space-y-2 pb-3 text-xs ${ui.text}`} data-testid="pressure-flow-analytics">
      {(pressure.length > 0 || displayFlow.length > 0) && (
        <>
          <ScaleFlowChart view={view} profile={{
            displayPressure: pressure, flow: displayFlow, pressureDots: true,
            minTimeS: 0, maxTimeS: durationS, extractionEndS: durationS,
          }} />
          <p className={ui.sub}>
            Time from extraction start (s).{pressure.length > 0 && ' Dots show camera readings.'}
            {displayFlow.length > 0 && ' Plotted flow uses weight changes over 0.2–0.5 s.'}
          </p>
        </>
      )}
      {[analysis.pressureStatus, analysis.flowStatus].filter(Boolean).map((status) => <p key={status} className={ui.sub}>{status}.</p>)}
      {flow.length > 0 && !displayFlow.length && <p className={ui.sub}>Too few consecutive scale readings to plot flow.</p>}
      {pressureCoverage && (
        <p className={ui.sub}>
          Camera coverage {pressureCoverage.observedS.toFixed(2)} of {durationS.toFixed(2)} s
          {' '}({(pressureCoverage.observedFraction * 100).toFixed(1)}%).
          {pressureCoverage.interruptions > 0 && ` ${pressureCoverage.interruptions} reading interruption${pressureCoverage.interruptions === 1 ? '' : 's'}.`}
          {pressureCoverage.peakMayBeMissed && ' Higher pressure may have occurred in unobserved periods.'}
        </p>
      )}
      {(pressure.length > 0 || preinfusionS != null) && (
        <dl className="grid grid-cols-2 gap-2">
          {metrics.filter(([, value]) => value != null || pressure.length).map(([label, value, unit, reason]) => (
            <div key={label} className={`rounded-lg p-2 ${ui.metricCell}`}>
              <dt className={ui.sub}>{label}</dt>
              <dd className="font-semibold tabular-nums">{value == null ? reason : `${value.toFixed(1)} ${unit}`}</dd>
            </div>
          ))}
        </dl>
      )}
      {pressure.length > 0 && flow.length > 0 && (
        <section className="space-y-1">
          <h3 className="font-semibold">Measured flow by observed pressure</h3>
          {bands.length ? (
            <dl>
              {bands.map(({ minBar, maxBar, count, averageFlowGs }) => (
                <div key={minBar} className="flex flex-wrap items-baseline justify-between gap-x-2 py-1">
                  <dt>{minBar} to &lt;{maxBar} bar</dt>
                  <dd className="tabular-nums">{averageFlowGs.toFixed(1)} g/s <span className={ui.sub}>· {count} intervals</span></dd>
                </div>
              ))}
            </dl>
          ) : <p className={ui.sub}>Insufficient paired readings within a pressure range.</p>}
          <p className={ui.sub}>Each range needs at least two scale intervals covered by camera readings. Averages are weighted by time.</p>
        </section>
      )}
    </div>
  );
}

export function PressureFlowAnalytics({ shot, ui }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={`border-t ${ui.modalDivider}`} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={`min-h-11 cursor-pointer py-3 text-sm font-semibold ${ui.accentText}`}>
        Advanced pressure and flow
      </summary>
      {open && <AnalysisDetails shot={shot} ui={ui} />}
    </details>
  );
}
