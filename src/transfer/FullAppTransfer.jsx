import { transferErrorMessage } from './transferError.js';
import { useEffect, useRef, useState } from 'react';
import { isAndroidApp, saveAndroidBackup } from '../native/androidShell.js';
import { BACKUP_EXTENSION } from './archive.js';
import { appTransferStore } from './transferStore.js';

const labels = { beans: 'Beans', recipes: 'Recipes', shots: 'Shots', settings: 'Settings rows',
  replay: 'Saved replay', preferences: 'Local preferences' };
const filename = (suffix = '') => 'espresso-dial-in-' + new Date().toISOString().slice(0, 10) + suffix + BACKUP_EXTENSION;

async function saveArchive(file, name) {
  if (isAndroidApp) return saveAndroidBackup(file, name);
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

function RelationshipWarnings({ warnings }) {
  if (!warnings?.length) return <p>Relationship checks passed.</p>;
  return <ul className="list-disc pl-4" aria-label="Relationship warnings">
    {warnings.map(({ label, count }) => <li key={label}>{label} ({count})</li>)}
  </ul>;
}

export function FullAppTransfer({ ui, blocked }) {
  const [plan, setPlan] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const store = useRef(null);
  const input = useRef(null);
  const getStore = () => (store.current ??= appTransferStore());

  useEffect(() => {
    if (!isAndroidApp) return undefined;
    let alive = true;
    getStore().lastReport().then((last) => { if (alive) setReport(last); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const run = async (label, action) => {
    setBusy(label);
    setError('');
    setStatus('');
    try {
      await action();
    } catch (err) {
      setError(transferErrorMessage(err, 'Transfer failed. Check available storage and try again.'));
    } finally {
      setBusy('');
    }
  };

  const exportApp = () => run('Creating full backup…', async () => {
    const { file } = await getStore().capture();
    if (await saveArchive(file, filename())) {
      setStatus(isAndroidApp ? 'Full backup saved.' : 'Check Downloads for the full backup file.');
    }
  });

  const selectFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPlan(null);
    setConfirmed(false);
    void run('Validating file and comparing data…', async () => setPlan(await getStore().preview(file)));
  };

  const restore = () => run('Saving local recovery copies…', async () => {
    if (!plan || blocked || !confirmed) return;
    await getStore().stage(plan);
    window.location.reload();
  });

  const verify = () => run('Reading back the stored records and files…', async () => {
    const current = await getStore().verify();
    setReport(current);
    if (!current) setStatus('There is no completed transfer to verify.');
  });

  const backupPrevious = () => run('Saving the previous Android backup…', async () => {
    const file = await getStore().rollbackFile();
    if (!file) return setStatus('There is no previous Android backup.');
    if (await saveArchive(file, filename('-before-transfer'))) setStatus('Previous Android backup saved.');
  });

  const button = `min-h-11 rounded-lg px-3 text-xs font-semibold disabled:opacity-50 ${ui.secondaryBtn}`;
  const identical = plan?.comparisons.every(({ match }) => match);
  const checksPass = report?.datasets.every(({ match }) => match);
  const verdict = checksPass
    ? (report.warnings.length ? 'PASS with existing relationship warnings' : 'PASS')
    : 'FAIL (data differs from the restored backup)';
  return <section className={`space-y-2 border-t pt-2 text-xs ${ui.modalDivider}`} aria-label="Transfer & Backup">
    <p className={`font-bold uppercase tracking-wider ${ui.text}`}>Transfer &amp; Backup</p>
    <p className={ui.muted}>Includes saved shots, beans, recipes, settings and the latest saved replay. Store the file on this device. It can contain private notes and video.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={!!busy || blocked} onClick={exportApp}>Export entire app</button>
      {isAndroidApp && <>
        <input ref={input} type="file" className="hidden" onChange={selectFile} />
        <button type="button" className={button} disabled={!!busy || blocked} onClick={() => input.current?.click()}>Import existing app</button>
        <button type="button" className={button} disabled={!!busy || blocked} onClick={verify}>Verify imported data</button>
      </>}
    </div>
    {blocked && <p>Finish or discard the current shot before transferring data.</p>}
    {busy && <p role="status">{busy}</p>}
    {error && <p role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    {plan && <div className={`space-y-2 rounded-lg p-3 ${ui.cardInset}`}>
      <p className="font-semibold">Import preview</p>
      <p>Source version {plan.source.appVersion}, exported {new Date(plan.source.exportedAt).toLocaleString()}.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead><tr>{['Dataset', 'Source', 'Android', 'Changed IDs', 'Removed'].map((label) => <th key={label} className="pr-2">{label}</th>)}</tr></thead>
          <tbody>{plan.comparisons.map(({ name, expected, actual }) =>
            <tr key={name}><th scope="row" className="pr-2">{labels[name]}</th><td>{expected}</td><td>{actual}</td>
              <td>{plan.conflicts[name].changed}</td><td>{plan.conflicts[name].removed}</td></tr>)}</tbody>
        </table>
      </div>
      <RelationshipWarnings warnings={plan.warnings} />
      {plan.warnings.length > 0 && <p>Existing missing links will be preserved. Review them before continuing.</p>}
      <p>{identical ? 'The supported records already match. You can confirm to record a verified transfer.' :
        'Exact copy replaces the supported Android records with this file and saves the current Android data as a recovery backup.'}</p>
      <p>Pair your scale again on Android. Android asks for camera permission when you use it.</p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        Replace supported Android data with the exact copy
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={!confirmed || !!busy || blocked} onClick={restore}>Confirm transfer</button>
        <button type="button" className={button} disabled={!!busy} onClick={() => setPlan(null)}>Cancel</button>
      </div>
    </div>}
    {report && <div className={`space-y-2 rounded-lg p-3 ${ui.cardInset}`} aria-label="Transfer verification">
      <p className="font-semibold">{report.direction === 'rollback' ? 'Recovery backup' : 'Transfer'} verification:
        {' '}{verdict}</p>
      <p>{new Date(report.verifiedAt).toLocaleString()}. Counts are stored / expected.</p>
      <ul>{report.datasets.map(({ name, expected, actual, match }) =>
        <li key={name}>{labels[name]}: {actual} / {expected} · {match ? 'checksum matches' : 'checksum differs'}</li>)}</ul>
      <RelationshipWarnings warnings={report.warnings} />
      <button type="button" className={button} disabled={!!busy} onClick={backupPrevious}>Save previous Android backup</button>
    </div>}
  </section>;
}
