import { useId, useMemo, useState } from 'react';
import { ChevronDown, Star } from 'lucide-react';
import { buildShotProfile, observationAtTime } from '../utils/shotProfile.js';
import { ScaleFlowChart } from './ScaleFlowChart.jsx';
import { ShotInsights } from './ShotInsights.jsx';
import { ShotComparison } from './ShotComparison.jsx';
import { PressureFlowAnalytics } from './PressureFlowAnalytics.jsx';
import { PortableShotExport } from './PortableShotExport.jsx';
import { shotTasteRating } from '../utils/shotRatings.js';

const format = (value, unit, digits = 1) => value == null ? 'Not recorded' : `${value.toFixed(digits)} ${unit}`;
const formatTime = (value) => format(value, 's');

function TasteRating({ shot, ui, onRatingChange }) {
  const rating = shotTasteRating(shot);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (value) => {
    setSaving(true);
    setError('');
    try {
      if (!await onRatingChange(value)) setError('This shot is no longer in History.');
    } catch {
      setError('Could not save the taste rating. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset disabled={saving} className={`${ui.metricCell} min-w-0 rounded-lg px-2.5 py-1`}>
      <legend className="px-1 text-xs font-semibold">Taste rating (optional)</legend>
      <div className="flex flex-wrap items-center gap-x-2">
        <div className="flex">
          {[1, 2, 3, 4, 5].map((stars) => (
            <button key={stars} type="button" aria-label={`Rate ${stars} ${stars === 1 ? 'star' : 'stars'}`}
              aria-pressed={rating === stars} onClick={() => save(stars)}
              className={`inline-flex size-11 items-center justify-center rounded-lg ${stars <= rating ? ui.accentText : ui.muted}`}>
              <Star aria-hidden="true" className={`size-5 ${stars <= rating ? 'fill-current' : ''}`} />
            </button>
          ))}
        </div>
        {rating !== null ? (
          <button type="button" onClick={() => save(null)} className={`min-h-11 px-1 text-xs font-semibold ${ui.sub}`}>
            Clear rating
          </button>
        ) : <span className={`px-1 text-xs ${ui.sub}`}>Unrated</span>}
      </div>
      {error && <p role="alert" className="pb-1 text-xs">{error}</p>}
    </fieldset>
  );
}

function ProfileDetails({ shot, ui, onRatingChange, onOpenBeanConsistency }) {
  const profile = useMemo(() => buildShotProfile(shot), [shot]);
  const [selectedView, setView] = useState(null);
  const [cursor, setCursor] = useState(null);
  const timeId = useId();
  const views = [
    profile.pressure.length > 0 && ['pressure', 'Pressure'],
    profile.weight.length > 0 && ['weight', 'Weight'],
    profile.flow.length > 0 && ['flow', 'Flow'],
    profile.aligned && profile.pressure.length > 0 && profile.flow.length > 0 && ['combined', 'Combined'],
  ].filter(Boolean);
  const view = views.some(([key]) => key === selectedView) ? selectedView : views[0]?.[0];
  const selectTime = (time) => setCursor(Math.min(profile.maxTimeS, Math.max(profile.minTimeS, time)));
  const showObservations = cursor != null;
  const observations = [
    ['pressure', 'Pressure', 'bar', 'bar', 1],
    ['weight', 'Weight', 'weightG', 'g', 1],
    ['flow', 'Flow', 'flowGs', 'g/s', 2],
  ].filter(([key]) => showObservations && profile[key].length && (profile.aligned || view === key));
  const yieldLabel = profile.yieldSource === 'manual' ? 'Entered yield'
    : profile.yieldSource === 'scale' ? 'Scale yield' : 'Saved yield';
  const metrics = [
    ['Extraction time', formatTime(profile.durationS)],
    ['Saved dose', format(profile.doseG, 'g')],
    [yieldLabel, format(profile.yieldG, 'g')],
    ['Brew ratio', profile.ratio == null ? 'Not recorded' : `1:${profile.ratio.toFixed(1)}`],
    ...(profile.pressure.length ? [['Peak pressure', format(profile.peakPressureBar, 'bar')]] : []),
    ...(profile.weight.length ? [['Last scale weight', format(profile.finalWeightG, 'g')]] : []),
    ...(profile.flow.length ? [
      ['Avg flow (observed intervals)', format(profile.averageFlowGs, 'g/s', 2)],
      ['Peak flow (smoothed)', format(profile.peakFlowGs, 'g/s', 2)],
    ] : []),
  ];

  return (
    <div className={`space-y-3 pb-3 ${ui.text}`} data-testid="shot-profile-details">
      <TasteRating shot={shot} ui={ui} onRatingChange={onRatingChange} />
      <dl className="grid grid-cols-2 gap-2">
        {metrics.map(([label, value]) => (
          <div key={label} className={`${ui.metricCell} min-w-0 rounded-lg px-2.5 py-2`}>
            <dt className={`text-[11px] leading-tight ${ui.sub}`}>{label}</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <ul className={`flex flex-wrap gap-1.5 text-[11px] ${ui.sub}`} aria-label="Recording availability">
        {[
          !profile.pressure.length && 'Pressure not recorded',
          !profile.weight.length && 'No scale data',
          profile.weight.length > 0 && !profile.flow.length && 'Flow unavailable',
          profile.pressureInterrupted && 'Pressure recording interrupted',
          profile.scaleInterrupted && 'Scale recording interrupted',
          profile.approximate && 'Approximate alignment',
        ].filter(Boolean).map((label) => (
          <li key={label} className={`${ui.chip} rounded-full px-2 py-1`}>{label}</li>
        ))}
      </ul>
      <ShotInsights shot={shot} profile={profile} ui={ui} onOpenBeanConsistency={onOpenBeanConsistency} />
      {view && (
        <div className={`${ui.cardInset} min-w-0 rounded-xl p-2.5 space-y-2`}>
          {views.length > 1 && (
            <div className="grid auto-cols-fr grid-flow-col gap-1" role="group" aria-label="Chart measurement">
              {views.map(([key, label]) => (
                <button key={key} type="button" aria-pressed={view === key}
                  onClick={() => { setView(key); if (!profile.aligned) setCursor(null); }}
                  className={`min-h-11 rounded-lg text-[11px] font-semibold ${view === key ? ui.chartToggleActive : ui.chartToggleIdle}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <ScaleFlowChart profile={profile} view={view} cursorS={cursor} onPickTime={selectTime} />
          <div className={`flex flex-wrap gap-x-3 gap-y-1 text-[11px] ${ui.sub}`}>
            <span>{profile.aligned ? 'Time from shot timer start' : 'Sensor recording time'}</span>
            {profile.extractionStartS > 0 && <span>Shaded pre-infusion</span>}
            {profile.legacyPreS > 0 && <span>Estimated pre-infusion {formatTime(profile.legacyPreS)}</span>}
            {profile.extractionEndS != null && <span>Dashed extraction end</span>}
            {profile.settlementEndS != null && <span>Weight includes yield settling</span>}
          </div>
          <div className="space-y-1">
            <label htmlFor={timeId} className="block text-xs font-semibold">
              {cursor == null ? 'Explore time' : `Time ${formatTime(cursor)}`}
            </label>
            <input id={timeId} type="range" min={profile.minTimeS} max={profile.maxTimeS} step="0.01"
              value={cursor ?? profile.minTimeS} onChange={(event) => selectTime(Number(event.target.value))}
              aria-label="Explore shot time" aria-valuetext={formatTime(cursor ?? profile.minTimeS)}
              className="w-full min-h-8 accent-[#c88a4b] block" />
            {showObservations && (
              <dl className="grid grid-cols-3 gap-1 text-[11px] tabular-nums" data-testid="profile-observations">
                {observations.map(([key, label, valueKey, unit, digits]) => {
                  const point = observationAtTime(profile[key], cursor);
                  return (
                    <div key={key}>
                      <dt className={ui.sub}>{label}</dt>
                      <dd>{point ? format(point[valueKey], unit, digits) : 'No sample'}</dd>
                      {point && <dd className={ui.sub}>{formatTime(point.tS)}</dd>}
                    </div>
                  );
                })}
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReferenceComparison({ shot, referenceShot, referenceDate, ui }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={`flex min-h-11 cursor-pointer items-center text-sm font-semibold ${ui.accentText}`}>
        Compare with bean reference
      </summary>
      {open && <ShotComparison shot={shot} referenceShot={referenceShot} referenceDate={referenceDate} ui={ui} />}
    </details>
  );
}

export function ShotProfile({ shot, ui, settings, referenceShot, referenceDate, onReferenceChange, onRatingChange, onOpenBeanConsistency }) {
  const [open, setOpen] = useState(false);
  const isReference = referenceShot?.id === shot.id;
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}
      className={`group/profile ${ui.cardInset} rounded-xl px-3`} data-testid="history-shot-profile">
      <summary className={`flex cursor-pointer list-none items-center gap-2 min-h-11 text-sm font-bold ${ui.text}`}>
        <span>Shot profile</span>
        {isReference && <span className={`text-xs font-semibold ${ui.sub}`}>Bean reference</span>}
        <ChevronDown className="ml-auto size-4 transition-transform group-open/profile:rotate-180" aria-hidden="true" />
      </summary>
      {open && (
        <>
          <ProfileDetails shot={shot} ui={ui} onRatingChange={onRatingChange}
            onOpenBeanConsistency={onOpenBeanConsistency} />
          <PortableShotExport shotId={shot.id} settings={settings} ui={ui} />
          {(shot.labPressureCurve?.length > 0 || shot.scaleFlowCurve?.length > 0) && (
            <PressureFlowAnalytics shot={shot} ui={ui} />
          )}
          {onReferenceChange && (
            <div className={`border-t ${ui.modalDivider}`}>
              {referenceShot && !isReference && (
                <ReferenceComparison key={referenceShot.id} shot={shot} referenceShot={referenceShot}
                  referenceDate={referenceDate} ui={ui} />
              )}
              <button type="button" onClick={() => onReferenceChange(!isReference)}
                className={`min-h-11 text-xs font-semibold ${ui.sub}`}>
                {isReference ? 'Remove bean reference' : referenceShot ? 'Replace bean reference with this shot' : 'Use as bean reference'}
              </button>
            </div>
          )}
        </>
      )}
    </details>
  );
}
