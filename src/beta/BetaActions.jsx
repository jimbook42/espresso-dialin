import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AndroidShell, isAndroidApp } from '../native/androidShell.js';
import { db } from '../utils/grinderLogic.js';
import { feedbackMailto } from '../feedbackShare.js';
import { buildShotDiagnosticDocument } from '../flairPressureLab/labShotReplayExport.js';
import { latestShotDeviceDiagnostics, shotDeviceDiagnosticsForShot } from '../scales/shotDeviceDiagnostics.js';
import { clearDiagnostics, recentDiagnostics } from './diagnosticLog.js';
import { buildProblemReport } from './problemReport.js';
import { betaJsonFile, saveLocalFile, shareLocalFile } from './localFileShare.js';

const button = (ui) => `min-h-11 rounded-lg px-3 text-xs font-semibold disabled:opacity-50 ${ui.secondaryBtn}`;
const noShots = [];

function BetaDialog({ title, ui, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={ref} aria-label={title}
    onKeyDown={(event) => event.stopPropagation()}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    className={`m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg space-y-3 overflow-y-auto rounded-2xl p-4 backdrop:bg-black/70 ${ui.card} ${ui.text}`}>
    <div className="flex items-center justify-between gap-2">
      <h2 className="font-bold">{title}</h2>
      <button type="button" className={button(ui)} onClick={onClose}>Close</button>
    </div>
    {children}
  </dialog>;
}

function ReviewShare({ payload, title, filename, ui }) {
  const [approved, setApproved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [feedback, setFeedback] = useState(false);
  const consent = approved === payload;
  const text = useMemo(() => JSON.stringify(payload, null, 2), [payload]);
  const send = async (save) => {
    if (busy || !consent) return;
    setBusy(true);
    setStatus('');
    try {
      const file = betaJsonFile(payload, filename);
      const result = save ? await saveLocalFile(file, { consent })
        : await shareLocalFile(file, { consent, title, feedback });
      setStatus({
        'chooser-opened': 'Share sheet opened. Choose an app and check whether it sent the file.',
        'share': 'File handed to the selected app. Delivery is not confirmed.',
        'saved': 'File saved. You can attach it to an email or send it using another app.',
        'download-started': 'Check Downloads for the file. You can attach it to an email.',
        'cancelled': 'Cancelled. You can share again or save the file.',
        'fallback': 'File sharing is unavailable. Use Save file and attach it manually.',
      }[result] ?? '');
    } catch {
      setStatus('Could not save the file. Check available storage and try again.');
    } finally {
      setBusy(false);
    }
  };
  return <section className="space-y-2 text-sm" aria-label="Review and share">
    <label className="block">File contents
      <textarea readOnly value={text} rows={7} spellCheck={false}
        className="mt-1 block w-full rounded border border-current bg-transparent p-2 font-mono text-xs" />
    </label>
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={consent} onChange={(event) => setApproved(event.target.checked ? payload : null)} />
      I agree to share the file shown above when I choose a recipient.
    </label>
    {isAndroidApp && <label className="flex items-center gap-2">
      <input type="checkbox" checked={feedback} onChange={(event) => setFeedback(event.target.checked)} />
      Suggest the developer's email address in the chosen email app
    </label>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button(ui)} disabled={!consent || busy} onClick={() => void send(false)}>Share file</button>
      <button type="button" className={button(ui)} disabled={!consent || busy} onClick={() => void send(true)}>Save file</button>
      {consent && <a className={`inline-flex items-center ${button(ui)}`} href={feedbackMailto(title, 'I will attach the file separately.')}>
        Email developer
      </a>}
    </div>
    {status && <p role="status">{status}</p>}
  </section>;
}

function ProblemReportDialog({ shot, ui, onClose }) {
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState(recentDiagnostics);
  const [device, setDevice] = useState(null);
  const [includeModel, setIncludeModel] = useState(false);
  const [includeShot, setIncludeShot] = useState(false);
  const [trace] = useState(() => shot ? shotDeviceDiagnosticsForShot(shot.id) : latestShotDeviceDiagnostics());
  useEffect(() => {
    if (!isAndroidApp) return undefined;
    let active = true;
    AndroidShell.getDiagnosticDevice().then((info) => { if (active) setDevice(info); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const payload = useMemo(() => {
    const report = buildProblemReport({
      platform: isAndroidApp ? 'android' : 'web', device: device ? { androidVersion: device.androidVersion,
        model: includeModel ? device.model : null } : null, events, trace, description,
    });
    return includeShot && shot
      ? { ...report, detailedShot: buildShotDiagnosticDocument(shot, undefined, { includeSavedFlow: true }) }
      : report;
  }, [shot, includeShot, device, includeModel, events, trace, description]);
  return <BetaDialog title="Report a problem" ui={ui} onClose={onClose}>
    <p className="text-sm">Review the recent app, camera and scale events. The default report excludes private notes, device addresses, recordings and shot samples.</p>
    <label className="block text-sm">Describe the problem (optional)
      <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000}
        className="mt-1 block w-full rounded border border-current bg-transparent p-2" rows={2} />
    </label>
    {device?.model && <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={includeModel} onChange={(event) => setIncludeModel(event.target.checked)} />
      Include my device model
    </label>}
    {shot && <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={includeShot} onChange={(event) => setIncludeShot(event.target.checked)} />
      Include detailed shot diagnostics, which may contain shot IDs, notes and readings
    </label>}
    <button type="button" className={button(ui)} onClick={() => { clearDiagnostics(); setEvents([]); }}>Clear local event history</button>
    <ReviewShare payload={payload} title="Espresso Dial-In problem report" filename="espresso-problem-report.json" ui={ui} />
  </BetaDialog>;
}

function ContributionsDialog({ shot, ui, onClose }) {
  const data = useLiveQuery(() => db.transaction('r', db.shots, db.beans, async () => {
    const shots = shot ? await db.shots.bulkGet([shot.id]) : await db.shots.toArray();
    if (!shot) shots.sort((a, b) => (typeof b.timestamp === 'string' ? b.timestamp : '')
      .localeCompare(typeof a.timestamp === 'string' ? a.timestamp : ''));
    return { shots: shots.filter(Boolean), beans: await db.beans.toArray() };
  }), [shot?.id]);
  const shots = data?.shots ?? noShots;
  const [selected, setSelected] = useState(() => new Set(shot ? [shot.id] : []));
  const [all, setAll] = useState(false);
  const [testerId, setTesterId] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = all ? shots : shots.filter(({ id }) => selected.has(id));
  const prepare = async () => {
    setBusy(true);
    setPreview(null);
    setError('');
    try {
      const { createContribution } = await import('./contribution.js');
      setPreview(await createContribution(chosen, data.beans, { testerId }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return <BetaDialog title="Contribute shot data" ui={ui} onClose={onClose}>
    <p className="text-sm">Voluntary contributions help evaluate and improve Espresso Dial-In’s recommendation, consistency, pressure and flow analysis. The file omits names, private notes, device addresses, photos and video.</p>
    {!data && <p role="status">Loading saved shots…</p>}
    {data && !shots.length && <p>No saved shots available.</p>}
    {!shot && shots.length > 0 && <fieldset disabled={busy} className="space-y-1 text-sm">
      <legend>Select saved shots</legend>
      <label className="flex items-center gap-2"><input type="checkbox" checked={all}
        onChange={(event) => { setAll(event.target.checked); setPreview(null); }} />All eligible saved shots ({shots.length})</label>
      {!all && <div className="max-h-40 space-y-1 overflow-y-auto">
        {shots.map((entry, index) => <label key={entry.id} className="flex items-center gap-2">
          <input type="checkbox" checked={selected.has(entry.id)} onChange={(event) => {
            const checked = event.target.checked;
            setSelected((ids) => {
              const next = new Set(ids);
              if (checked) next.add(entry.id);
              else next.delete(entry.id);
              return next;
            });
            setPreview(null);
          }} />
          Shot {index + 1}{entry.timestamp ? ' · ' + String(entry.timestamp).slice(0, 10) : ''}
          {entry.actualTimeS == null ? '' : ` · ${entry.actualTimeS}s`}
        </label>)}
      </div>}
    </fieldset>}
    <label className="block text-sm">Tester alias (optional)
      <input type="text" value={testerId} maxLength={32} disabled={busy}
        onChange={(event) => { setTesterId(event.target.value); setPreview(null); }}
        className="mt-1 w-full rounded border border-current bg-transparent p-2" />
    </label>
    <button type="button" className={button(ui)} disabled={!chosen.length || busy} onClick={() => void prepare()}>
      {busy ? 'Preparing…' : `Preview contribution (${chosen.length})`}
    </button>
    {error && <p role="alert">{error}</p>}
    {preview && <ReviewShare payload={preview} title="Espresso Dial-In shot contribution"
      filename={`espresso-contribution-${preview.exportId}.json`} ui={ui} />}
  </BetaDialog>;
}

export function BetaActions({ ui, shot }) {
  const [open, setOpen] = useState(null);
  return <div className="flex flex-wrap gap-2">
    <button type="button" className={button(ui)} onClick={() => setOpen('report')}>
      {shot ? 'Share diagnostic report' : 'Report a problem'}
    </button>
    <button type="button" className={button(ui)} onClick={() => setOpen('contribute')}>Contribute shot data</button>
    {open === 'report' && <ProblemReportDialog ui={ui} shot={shot} onClose={() => setOpen(null)} />}
    {open === 'contribute' && <ContributionsDialog ui={ui} shot={shot} onClose={() => setOpen(null)} />}
  </div>;
}
