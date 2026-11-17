import { TransferError } from './transferError.js';
import Dexie from 'dexie';
import { db } from '../utils/grinderLogic.js';
import { readReplayForTransfer, replaceReplayForTransfer } from '../flairPressureLab/labShotReplayDb.js';
import { BEANS_FINISHED_SECTION_OPEN_KEY } from '../utils/beansFinishedSectionPrefs.js';
import { MANUAL_SHOT_DRAFT_KEY } from '../utils/manualShotDraft.js';
import { rebuildGlobalSettingsCache } from '../settings/settingsLocalCache.js';
import { SHOT_SELECTIONS_ID } from '../utils/shotSelections.js';
import { isStandalonePressureShot } from '../flairPressureLab/standalonePressureShot.js';
import { buildArchive, DATASETS, fingerprintRecord, parseArchive } from './archive.js';

const tables = ['beans', 'recipes', 'shots', 'settings'];
const preferences = [BEANS_FINISHED_SECTION_OPEN_KEY, 'espresso-dialin.camera-facing-mode'];
const isId = (id) => (typeof id === 'string' && id.length > 0) || Number.isFinite(id);
const rowObject = (value) => value != null && Object.getPrototypeOf(value) === Object.prototype;
const valid = (condition, message) => { if (!condition) throw new TransferError(message); };

export function openTransferJournal(name = 'EspressoDialTransfer') {
  const journal = new Dexie(name, { chromeTransactionDurability: 'strict' });
  journal.version(1).stores({ transfer: '' });
  return journal;
}

function inspectSnapshot(snapshot) {
  const index = {};
  for (const name of tables) {
    index[name] = new Map();
    let previous;
    for (const row of snapshot[name]) {
      valid(rowObject(row) && isId(row.id), name + ' contains an invalid record ID.');
      valid(!index[name].has(row.id), name + ' contains a duplicate record ID.');
      valid(previous === undefined || indexedDB.cmp(previous, row.id) < 0, name + ' records are not in canonical ID order.');
      previous = row.id;
      index[name].set(row.id, row);
    }
  }
  const warnings = new Map();
  const flag = (key) => warnings.set(key, (warnings.get(key) || 0) + 1);
  for (const recipe of snapshot.recipes) {
    if (!index.beans.has(recipe.beanId)) flag('Recipes without a matching bean');
  }
  for (const shot of snapshot.shots) {
    if (!isStandalonePressureShot(shot) && !index.beans.has(shot.beanId)) flag('Shots without a matching bean');
    for (const key of ['labPressureCurve', 'scaleFlowCurve']) {
      valid(shot[key] == null || (Array.isArray(shot[key]) && shot[key].every(rowObject)), 'A shot contains an invalid sensor series.');
    }
    valid(shot.labGaugeSnapshotJpeg == null || (typeof shot.labGaugeSnapshotJpeg === 'string'
      && shot.labGaugeSnapshotJpeg.startsWith('data:image/jpeg;base64,')), 'A shot contains an invalid gauge image.');
  }
  const global = index.settings.get('global');
  if (global?.lastSelectedBeanId != null && global.lastSelectedBeanId !== '' && !index.beans.has(global.lastSelectedBeanId)) {
    flag('Last selected bean missing');
  }
  const selections = index.settings.get(SHOT_SELECTIONS_ID);
  if (selections) {
    valid(Array.isArray(selections.favouriteIds) && Array.isArray(selections.references)
      && selections.favouriteIds.every(isId)
      && selections.references.every((item) => rowObject(item) && isId(item.beanId) && isId(item.shotId)),
    'Shot selections contain invalid IDs.');
    for (const id of selections.favouriteIds) {
      if (!index.shots.has(id)) flag('Favourite selections without a matching shot');
    }
    for (const reference of selections.references) {
      const shot = index.shots.get(reference.shotId);
      if (!shot || !index.beans.has(reference.beanId) || shot.beanId !== reference.beanId || isStandalonePressureShot(shot)) {
        flag('Reference selections without a matching shot and bean');
      }
    }
  }
  const [replay] = snapshot.replay;
  valid(snapshot.replay.length < 2 && (!snapshot.replay.length || (rowObject(replay)
    && replay.blob instanceof Blob && replay.byteSize === replay.blob.size && isId(replay.shotId)
    && Array.isArray(replay.samples) && replay.samples.every(rowObject))), 'The saved replay record is invalid.');
  if (replay && !index.shots.has(replay.shotId)) flag('Replay without a matching shot');
  let previousPreference = -1;
  for (const pref of snapshot.preferences) {
    valid(rowObject(pref) && preferences.indexOf(pref.id) > previousPreference
      && (pref.id === BEANS_FINISHED_SECTION_OPEN_KEY ? ['0', '1'] : ['user', 'environment']).includes(pref.value),
    'The backup contains an unsupported or duplicate local preference.');
    previousPreference = preferences.indexOf(pref.id);
  }
  return Array.from(warnings, ([label, count]) => ({ label, count }));
}

const comparableManifest = (manifest) => JSON.stringify(manifest.datasets);
const compareDigests = (expected, actual) => DATASETS.map((name, index) => ({
  name, expected: expected.datasets[index].count, actual: actual.datasets[index].count,
  match: JSON.stringify(expected.datasets[index]) === JSON.stringify(actual.datasets[index]),
}));

async function replaceTables(database, snapshot) {
  const idb = database.backendDB();
  await new Promise((resolve, reject) => {
    const tx = idb.transaction(tables, 'readwrite', { durability: 'strict' });
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error('App data replacement was interrupted.'));
    try {
      for (const name of tables) {
        const store = tx.objectStore(name);
        store.clear();
        for (const row of snapshot[name]) store.add(row);
      }
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}

async function datasetConflicts(before, after, identicalSets) {
  const result = {};
  for (const [index, name] of DATASETS.entries()) {
    if (identicalSets[index].match) {
      result[name] = { changed: 0, removed: 0, added: 0 };
      continue;
    }
    const key = (row) => name === 'replay' ? 'last' : row.id;
    const existing = new Map(before[name].map((row) => [key(row), row]));
    const incoming = new Map(after[name].map((row) => [key(row), row]));
    let changed = 0;
    for (const [id, row] of incoming) {
      if (existing.has(id) && await fingerprintRecord(existing.get(id)) !== await fingerprintRecord(row)) changed++;
    }
    result[name] = { changed, removed: [...existing.keys()].filter((id) => !incoming.has(id)).length,
      added: [...incoming.keys()].filter((id) => !existing.has(id)).length };
  }
  return result;
}

export function createTransferStore({ database, journal, storage, readReplay, writeReplay, appVersion }) {
  const journalTable = journal.table('transfer');
  const readCurrent = async () => {
    // All four Dexie tables share one read transaction.
    const rows = await database.transaction('r', tables, () => Promise.all(tables.map((name) => database.table(name).toArray())));
    const replay = await readReplay();
    const prefs = preferences.flatMap((id) => {
      const value = storage.getItem(id);
      return value == null ? [] : [{ id, value }];
    });
    return Object.fromEntries([...tables.map((name, index) => [name, rows[index]]),
      ['replay', replay ? [replay] : []], ['preferences', prefs]]);
  };
  const capture = async () => {
    const snapshot = await readCurrent();
    inspectSnapshot(snapshot);
    return { snapshot, ...await buildArchive(snapshot, appVersion) };
  };
  const pending = () => journalTable.get('pending');
  const preview = async (file) => {
    const source = await parseArchive(file);
    const warnings = inspectSnapshot(source.snapshot);
    const destination = await capture();
    const comparisons = compareDigests(source.manifest, destination.manifest);
    const conflicts = await datasetConflicts(destination.snapshot, source.snapshot, comparisons);
    return { file, source: source.manifest, destination: destination.manifest, comparisons, conflicts, warnings };
  };
  const stage = async (plan) => {
    valid(!storage.getItem(MANUAL_SHOT_DRAFT_KEY), 'Save or discard the destination shot draft before restoring.');
    const destination = await capture();
    valid(comparableManifest(destination.manifest) === comparableManifest(plan.destination), 'Destination data changed. Review a fresh import preview.');
    const source = await parseArchive(plan.file);
    inspectSnapshot(source.snapshot);
    valid(comparableManifest(source.manifest) === comparableManifest(plan.source), 'The backup changed. Select it again.');
    // Source and rollback archives commit as one durable write before any data is touched.
    await journal.transaction('rw', journalTable, async () => {
      valid(!await pending(), 'A transfer is already pending.');
      await journalTable.add({ incoming: plan.file, previous: destination.file, before: destination.manifest,
        direction: 'restore', started: false }, 'pending');
    });
  };
  const applyPending = async () => {
    const operation = await pending();
    if (!operation) return null;
    const source = await parseArchive(operation.direction === 'rollback' ? operation.previous : operation.incoming);
    const warnings = inspectSnapshot(source.snapshot);
    if (!operation.started) {
      const actual = await capture();
      valid(!storage.getItem(MANUAL_SHOT_DRAFT_KEY)
        && comparableManifest(operation.before) === comparableManifest(actual.manifest),
      'Destination data changed before replacement. Cancel and preview the backup again.');
      await journalTable.put({ ...operation, started: true }, 'pending');
    }
    await replaceTables(database, source.snapshot);
    // A crash between databases is recoverable. The journal remains until the
    // Dexie transaction, replay transaction, preferences and read-back all pass.
    await writeReplay(source.snapshot.replay[0] ?? null);
    const wanted = new Map(source.snapshot.preferences.map(({ id, value }) => [id, value]));
    for (const id of preferences) {
      if (wanted.has(id)) storage.setItem(id, wanted.get(id));
      else storage.removeItem(id);
    }
    rebuildGlobalSettingsCache(storage, source.snapshot.settings.find(({ id }) => id === 'global'));
    const actual = await capture();
    const datasets = compareDigests(source.manifest, actual.manifest);
    valid(datasets.every(({ match }) => match), 'Stored data failed verification. The transfer can be retried or rolled back.');
    const report = { source: source.manifest, datasets, warnings, verifiedAt: new Date().toISOString(),
      direction: operation.direction };
    await journal.transaction('rw', journalTable, async () => {
      if (operation.direction === 'restore') await journalTable.put(operation.previous, 'rollback');
      await journalTable.put(report, 'report');
      await journalTable.delete('pending');
    });
    return report;
  };
  const verify = async () => {
    const report = await journalTable.get('report');
    if (!report) return null;
    const actual = await capture();
    const datasets = compareDigests(report.source, actual.manifest);
    return { ...report, datasets, warnings: inspectSnapshot(actual.snapshot), verifiedAt: new Date().toISOString() };
  };
  const rollbackPending = async () => {
    await journal.transaction('rw', journalTable, async () => {
      const operation = await pending();
      valid(operation, 'No recovery backup is pending.');
      if (operation.started) await journalTable.put({ ...operation, direction: 'rollback' }, 'pending');
      else await journalTable.delete('pending');
    });
  };
  return { capture, preview, stage, pending, applyPending, rollbackPending, verify,
    lastReport: () => journalTable.get('report'), rollbackFile: () => journalTable.get('rollback') };
}

let appStore;
export function appTransferStore() {
  appStore ??= createTransferStore({ database: db, journal: openTransferJournal(), storage: localStorage,
    readReplay: readReplayForTransfer, writeReplay: replaceReplayForTransfer,
    appVersion: import.meta.env.VITE_APP_VERSION });
  return appStore;
}

export async function recoverAndroidTransfer() {
  const store = appTransferStore();
  if (!await store.pending()) return;
  await store.applyPending();
  // Reloaded app should derive its landing tab from the restored experience.
  window.history.replaceState(null, '');
}
