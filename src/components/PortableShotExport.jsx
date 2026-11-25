import { BetaActions } from '../beta/BetaActions.jsx';
import { saveLocalFile, shareLocalFile } from '../beta/localFileShare.js';
import { isAndroidApp, saveAndroidFile } from '../native/androidShell.js';
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useOverlayHistoryClose } from '../hooks/useOverlayHistoryClose.js';
import { ShotCardPreview } from './ShotCardPreview.jsx';
import { formatShotGrindForHistory } from '../grinders/grinderRegistry.js';
import { downloadCsvFile } from '../utils/csvExport.js';
import { db, knownIssueReasonLabel } from '../utils/grinderLogic.js';
import { MAX_PORTABLE_SHOT_BYTES, parsePortableShotFile, previewPortableRestore, restorePortableShots } from '../utils/portableShotRestore.js';
import { readPortableShots, readShotForSharing } from '../utils/portableShots.js';
import { formatRecFollowedForCsv } from '../utils/recommendationFollowed.js';
import { buildSepShotFile, shotSummaryCsv } from '../utils/shotExportFormats.js';
import { normalizeTasteProfile } from '../utils/tasteProfile.js';
import { smoothFlowGraphs } from '../settings/flowGraphPreference.js';

const buttonClass = 'min-h-11 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50';

function downloadFile(name, blob) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function downloadBackup(snapshot, filename) {
  if (!snapshot.shots.length) throw new Error('No saved shots are available to export.');
  const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
  if (blob.size > MAX_PORTABLE_SHOT_BYTES) {
    throw new Error('The backup exceeds 64 MiB. Export individual shots using Share shot in History.');
  }
  if (isAndroidApp) return saveAndroidFile(blob, filename);
  downloadFile(filename, blob);
}

function savedGrind(shot, settings) {
  const hasSetting = ['setteMacro', 'setteMicro', 'sunbeamSetting', 'nicheZeroSetting', 'customGrindValue']
    .some((key) => shot[key] != null && shot[key] !== '');
  return hasSetting ? formatShotGrindForHistory(shot, settings) : '';
}

export function PortableShotExport({ shotId, settings, ui, cardOptions, onCardOptionsChange, onClose }) {
  const ref = useRef(null);
  const requestClose = useOverlayHistoryClose(true, onClose);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} aria-label="Share shot" onCancel={(event) => event.preventDefault()}
      className={`m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg space-y-3 overflow-y-auto rounded-2xl p-4 backdrop:bg-black/70 ${ui.card} ${ui.text}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">Share shot</h2>
        <button type="button" className={`${buttonClass} ${ui.secondaryBtn}`} onClick={requestClose}>Close</button>
      </div>
      <ShotShareOptions shotId={shotId} settings={settings} ui={ui}
        cardOptions={cardOptions} onCardOptionsChange={onCardOptionsChange} />
    </dialog>
  );
}

function ShotShareOptions({ shotId, settings, ui, cardOptions, onCardOptionsChange }) {
  const [error, setError] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const data = useLiveQuery(async () => {
    try {
      return await readShotForSharing(db, shotId);
    } catch (err) {
      return { error: err.message };
    }
  }, [shotId]);
  const { snapshot, referenceShot } = data ?? {};
  const shot = snapshot?.shots[0];
  const bean = snapshot?.beans.find(({ id }) => id === shot.record.beanId);
  const sep = shot && buildSepShotFile(shot, { bean, grind: savedGrind(shot.record, settings) });
  const missing = shot && ['doseG', 'yieldG', 'durationS', 'ratio', 'rating'].filter((key) => shot.measurements[key] == null);
  const fieldNames = { doseG: 'dose', yieldG: 'yield', durationS: 'extraction time', ratio: 'brew ratio', rating: 'taste rating' };
  const filename = 'espresso-shot-' + String(shotId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const deliverSep = async (share) => {
    setShareStatus('');
    const file = new File([sep.blob], filename + '-sep.csv', { type: 'text/csv' });
    try {
      const result = share ? await shareLocalFile(file, { consent: true, title: 'Espresso Dial-In SEP CSV' })
        : await saveLocalFile(file, { consent: true });
      if (result === 'fallback') setShareStatus('Share sheet unavailable. Use Export SEP CSV.');
      if (result === 'chooser-opened') setShareStatus('Share sheet opened. Import depends on the app you choose.');
    } catch {
      setShareStatus('Could not save the SEP CSV.');
    }
  };
  const saveJson = async () => {
    try {
      const result = await downloadBackup(snapshot, filename + '.json');
      if (result) setShareStatus(result.cancelled ? 'Save cancelled.' : 'Shot JSON saved.');
    } catch (err) {
      setError(err.message);
    }
  };
  const saveCsv = async () => {
    const name = filename + '.csv';
    const csv = shotSummaryCsv(snapshot, {
      formatShotGrindForHistory: (record) => savedGrind(record, settings),
      normalizeTasteProfile, formatRecFollowedForCsv, knownIssueReasonLabel,
    });
    if (!isAndroidApp) {
      downloadCsvFile(name, csv);
      return;
    }
    try {
      const result = await saveLocalFile(new File([csv], name, { type: 'text/csv' }), { consent: true });
      setShareStatus(result === 'cancelled' ? 'Save cancelled.' : 'Shot CSV saved.');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      {(error || data?.error || data === null) && (
        <p role="alert" className="pb-2 text-xs">{error || data?.error || 'This shot is no longer in History.'}</p>
      )}
      {data === undefined && <p className="pb-2 text-xs">Loading saved shot…</p>}
      {shot && (
        <div className="space-y-3 pb-3 text-xs">
          <ShotCardPreview options={cardOptions} setOptions={onCardOptionsChange} shot={shot.record} bean={bean} grind={shot.record.grinderModel} referenceShot={referenceShot} filename={filename} ui={ui} onError={setError} smoothFlow={smoothFlowGraphs(settings)} />
          <div className="space-y-1">
            <p className="font-semibold">Local downloads</p>
            <p className={ui.sub}>
              JSON includes the saved shot, linked bean, rating, selections, sensor data and gauge image when available.
              CSV contains the shot summary.
            </p>
            <p className={ui.sub}>
              {[
                ['pressure', shot.pressure.observedIndices.length],
                ['weight', shot.weight.observedIndices.length],
                ['flow', shot.flow.intervals.length],
              ].map(([label, count]) => `${label} ${count ? 'available' : 'unavailable'}`).join(' · ')}
            </p>
            {missing.length > 0 && <p className={ui.sub}>Missing from this shot: {missing.map((key) => fieldNames[key]).join(', ')}.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`${buttonClass} ${ui.secondaryBtn}`} onClick={saveJson}>Export shot JSON</button>
              <button type="button" className={`${buttonClass} ${ui.secondaryBtn}`} onClick={saveCsv}>Download shot CSV</button>
            </div>
          </div>
          <div className={`border-t pt-2 space-y-1 ${ui.modalDivider}`}>
            <p className="font-semibold">External app formats</p>
            {sep.blob ? (
              <>
                <p className={ui.sub}>
                  SEP CSV contains recorded {sep.tracks.join(' and ')} samples. It can be used as a Visualizer upload file.
                  SEP mobile import still needs a device check.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={`${buttonClass} ${ui.secondaryBtn}`}
                    onClick={() => void deliverSep(false)}>Export SEP CSV</button>
                  {isAndroidApp && <button type="button" className={`${buttonClass} ${ui.secondaryBtn}`}
                    onClick={() => void deliverSep(true)}>Share to compatible app (SEP CSV)</button>}
                </div>
              </>
            ) : <p className={ui.sub}>SEP and Visualizer unavailable. {sep.reason}</p>}
            {shareStatus && <p role="status">{shareStatus}</p>}
          </div>
          <div className={`border-t pt-2 ${ui.modalDivider}`}><BetaActions ui={ui} shot={shot.record} /></div>
        </div>
      )}
    </>
  );
}

export function PortableShotBackup({ ui }) {
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const backupAll = async () => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const snapshot = await readPortableShots(db);
      await downloadBackup(snapshot, `espresso-shots-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const previewFile = async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setBusy(true);
    setPending(null);
    setStatus('');
    setError('');
    try {
      const snapshot = await parsePortableShotFile(file);
      setPending({ snapshot, summary: await previewPortableRestore(db, snapshot), filename: file.name });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await restorePortableShots(db, pending.snapshot, pending.summary);
      setPending(null);
      setStatus(`Restored ${result.newShots} new shots, ${result.favouritesAdded} favourites and ${result.referencesAdded} bean references.`);
    } catch (err) {
      setError(err.message);
      try {
        setPending({ ...pending, summary: await previewPortableRestore(db, pending.snapshot) });
      } catch {
        setPending(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const summary = pending?.summary;
  const canRestore = summary && (summary.newShots || summary.newBeans || summary.favouritesAdded || summary.referencesAdded);
  return (
    <div className="space-y-2 text-xs">
      <button type="button" disabled={busy} onClick={backupAll} className={`w-full ${buttonClass} ${ui.secondaryBtn}`}>
        Download all shots as JSON
      </button>
      <label className="block space-y-1">
        <span className="block font-semibold">Restore shot backup</span>
        <input type="file" accept=".json,application/json" disabled={busy}
          className="block w-full text-xs file:mr-2 file:min-h-11 file:cursor-pointer" onChange={previewFile} />
      </label>
      {summary && (
        <section aria-label="Shot restore preview" className={`space-y-2 rounded-lg p-3 ${ui.cardInset}`}>
          <p className="break-all font-semibold">{pending.filename}</p>
          <p>{summary.shotsInFile} shots in file, including {summary.ratingsInFile} with ratings. {summary.newShots} new shots and {summary.newBeans} linked beans to add.</p>
          <p>{summary.identicalShots} identical shots already saved. {summary.conflictingShots} shot ID conflicts and {summary.conflictingBeans} bean ID conflicts. Existing records are kept.</p>
          <p>{summary.favouritesAdded} favourites and {summary.referencesAdded} bean references to add. {summary.skippedSelections} conflicting selections skipped.</p>
          {summary.shotsWithoutLinkedBean > 0 && <p>{summary.shotsWithoutLinkedBean} shots have no linked bean in the backup.</p>}
          <div className="flex flex-wrap gap-2">
            {Boolean(canRestore) && <button type="button" disabled={busy} onClick={restore}
              className={`${buttonClass} ${ui.secondaryBtn}`}>Confirm shot restore</button>}
            <button type="button" disabled={busy} onClick={() => { setPending(null); setError(''); }}
              className={`${buttonClass} ${ui.secondaryBtn}`}>Close preview</button>
          </div>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
    </div>
  );
}
