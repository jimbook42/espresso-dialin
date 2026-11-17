import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildArchive, DATASETS, parseArchive } from './archive.js';
import { createTransferStore, openTransferJournal } from './transferStore.js';
import { readReplayForTransfer, replaceReplayForTransfer } from '../flairPressureLab/labShotReplayDb.js';
import { BEANS_FINISHED_SECTION_OPEN_KEY } from '../utils/beansFinishedSectionPrefs.js';
import { MANUAL_SHOT_DRAFT_KEY } from '../utils/manualShotDraft.js';

const appVersion = '4.15.2';
const tables = ['beans', 'recipes', 'shots', 'settings'];
const cacheKey = 'espresso-dialin.global-settings-v1';
const cameraKey = 'espresso-dialin.camera-facing-mode';
const cleanup = [];
const empty = () => Object.fromEntries(DATASETS.map((name) => [name, []]));

function example() {
  return {
    beans: [
      { id: 'b1', roastDate: '2026-01-05', name: 'Bourbon', isFinished: true, completedAt: 1700000000000 },
      { id: 'unused', name: 'Unopened', details: { absent: undefined, date: new Date(1234), values: [null, -0, NaN, 1n] } },
    ],
    recipes: [{ id: 'r1', beanId: 'b1', targetDoseG: 18.01, targetYieldG: 36.3, flairProfile: { preinfusionTime: 8 } }],
    shots: [
      { id: 's1', beanId: 'b1', timestamp: '2026-01-10T00:00:00.123Z', actualDoseG: 18.01, actualYieldG: 36.3789,
        actualTimeS: 28.1234, shotRating: 4, notes: 'Notes with café ☕', excludeFromLearning: true,
        labPressureCurve: [{ tS: 0.019, bar: 0.23456789, confident: true }],
        scaleFlowCurve: [{ tS: 0.03, weightG: 0.123456789 }, { tS: 0.18, weightG: 0.41 }],
        scaleFlowRateGs: 1.23, labGaugeSnapshotJpeg: 'data:image/jpeg;base64,/9j/AAAA' },
      { id: 's2', recordType: 'standalone-pressure', timestamp: '2026-02-01T00:00:00Z', labPressureCurve: [{ tS: 1, bar: 3 }] },
    ],
    settings: [{ id: 'global', grinderModel: 'custom', customGrinder: { label: 'My grinder', step: 0.1 },
      grindUiByBeanGrinder: { 'b1::custom': { customGrindValue: '3.12' } }, experiencePreference: 'pressure',
      darkMode: false, statsForNerdsEnabled: true, smartScaleDeviceId: 'bookoo-themis',
      labGaugeTapCalibration: { pivot: [0.12, 0.34], tick5: [0.56, 0.78] }, shotScreen: { showGauge: true } },
    { id: 'history-shot-selections', favouriteIds: ['s2', 's1'], references: [{ beanId: 'b1', shotId: 's1' }] },
    { id: 'other-settings', sourceData: 'preserve whole row' }],
    replay: [{ shotId: 's1', blob: new Blob([new Uint8Array([0, 255, 186, 0, 9])], { type: 'video/webm' }),
      byteSize: 5, mimeType: 'video/webm', videoW: 640, videoH: 480, durationS: 2.1234, savedAt: '2026-01-10T00:00:01Z',
      samples: [{ tS: 1.12, pressureBar: 2.3456, weightG: 3.4567, targetBar: 3 }], extra: { model: 'r7' } }],
    preferences: [{ id: BEANS_FINISHED_SECTION_OPEN_KEY, value: '1' }, { id: cameraKey, value: 'environment' }],
  };
}

async function setup(initial = empty(), { realReplay = false } = {}) {
  const database = new Dexie('transfer-test-' + crypto.randomUUID());
  database.version(17).stores(Object.fromEntries(tables.map((name) => [name, 'id'])));
  const journal = openTransferJournal(database.name + '-journal');
  const memory = new Map();
  const storage = { getItem: (name) => memory.get(name) ?? null,
    setItem: (name, value) => memory.set(name, value), removeItem: (name) => memory.delete(name) };
  let replay = initial.replay[0] ?? null;
  const writeReplay = vi.fn(realReplay ? replaceReplayForTransfer : async (row) => { replay = row; });
  if (realReplay) {
    await replaceReplayForTransfer(replay);
    cleanup.push(() => replaceReplayForTransfer(null));
  }
  cleanup.push(() => database.delete(), () => journal.delete());
  for (const name of tables) await database.table(name).bulkAdd(initial[name]);
  for (const { id, value } of initial.preferences) storage.setItem(id, value);
  const openStore = (override = {}) => createTransferStore({ database, journal, storage,
    readReplay: realReplay ? readReplayForTransfer : async () => replay, writeReplay, appVersion, ...override });
  return { database, journal, storage, writeReplay, openStore, store: openStore() };
}

afterEach(async () => {
  for (const remove of cleanup.splice(0)) await remove();
});

describe('full app transfer', () => {
  it('restores whole records, original IDs, preferences and the binary replay, then verifies after reopening', async () => {
    const original = example();
    const source = await setup(original);
    source.storage.setItem('dialin.android.scale.bookoo-themis', 'private device identifier');
    source.storage.setItem(MANUAL_SHOT_DRAFT_KEY, 'temporary draft');
    source.storage.setItem('unrelated-key', 'do not export');
    const exported = await source.store.capture();
    const destination = await setup(empty(), { realReplay: true });
    destination.storage.setItem('dialin.android.scale.bookoo-themis', 'destination-local pairing');
    const plan = await destination.store.preview(exported.file);
    expect(plan.warnings).toEqual([]);
    expect(plan.comparisons.map(({ expected, actual }) => [expected, actual])).toEqual([[2,0],[1,0],[2,0],[3,0],[1,0],[2,0]]);
    await destination.store.stage(plan);
    expect(await destination.database.shots.count()).toBe(0);
    destination.database.close();
    destination.journal.close();
    await destination.database.open();
    await destination.journal.open();
    const reopened = destination.openStore();
    const report = await reopened.applyPending();
    expect(report.datasets.every(({ match }) => match)).toBe(true);
    const restored = (await reopened.capture()).snapshot;
    expect(restored.beans).toEqual(original.beans);
    expect(restored.recipes).toEqual(original.recipes);
    expect(restored.shots).toEqual(original.shots);
    expect(restored.settings).toEqual(original.settings);
    expect(restored.preferences).toEqual(original.preferences);
    expect(restored.replay[0]).toMatchObject({ ...original.replay[0], blob: expect.any(Blob) });
    expect(new Uint8Array(await restored.replay[0].blob.arrayBuffer())).toEqual(new Uint8Array([0, 255, 186, 0, 9]));
    expect(destination.storage.getItem(MANUAL_SHOT_DRAFT_KEY)).toBeNull();
    expect(destination.storage.getItem('unrelated-key')).toBeNull();
    expect(destination.storage.getItem('dialin.android.scale.bookoo-themis')).toBe('destination-local pairing');
    expect(JSON.parse(destination.storage.getItem(cacheKey))).toEqual(original.settings[0]);
    expect((await source.database.shots.toArray())).toEqual(original.shots);
    destination.database.close();
    destination.journal.close();
    await destination.database.open();
    await destination.journal.open();
    expect((await destination.openStore().verify()).datasets.every(({ match }) => match)).toBe(true);
    await destination.database.shots.update('s1', { notes: 'a later change' });
    expect((await reopened.verify()).datasets.filter(({ match }) => !match).map(({ name }) => name)).toEqual(['shots']);
  });

  it('previews conflicts, keeps a recovery archive, replaces without merging and re-imports exactly', async () => {
    const data = example();
    const target = await setup({ ...empty(), beans: [{ id: 'b1', name: 'Conflict' }, { id: 'extra', name: 'Local only' }] });
    const { file } = await buildArchive(data, appVersion);
    const plan = await target.store.preview(file);
    expect(plan.conflicts.beans).toEqual({ changed: 1, removed: 1, added: 1 });
    await target.store.stage(plan);
    expect((await target.store.applyPending()).datasets.every(({ match }) => match)).toBe(true);
    expect((await parseArchive(await target.store.rollbackFile())).snapshot.beans.map(({ id }) => id)).toEqual(['b1', 'extra']);
    const again = await target.store.preview(file);
    expect(again.conflicts.beans).toEqual({ changed: 0, removed: 0, added: 0 });
    await target.store.stage(again);
    expect((await target.store.applyPending()).datasets.every(({ match }) => match)).toBe(true);
    expect(await target.database.shots.count()).toBe(2);
  });

  it('handles an empty archive and clears derived cache after confirmed replacement', async () => {
    const target = await setup(example());
    target.storage.setItem(cacheKey, '{"id":"global","darkMode":true}');
    const { file } = await buildArchive(empty(), appVersion);
    await target.store.stage(await target.store.preview(file));
    const report = await target.store.applyPending();
    expect(report.datasets.every(({ match, actual }) => match && actual === 0)).toBe(true);
    expect(target.storage.getItem(cacheKey)).toBeNull();
  });

  it('reports broken existing relationships without repairing or dropping records', async () => {
    const data = example();
    data.shots[0].beanId = 'gone';
    data.recipes[0].beanId = 'gone';
    data.settings[1].favouriteIds.push('missing');
    const target = await setup();
    const { file } = await buildArchive(data, appVersion);
    const plan = await target.store.preview(file);
    expect(plan.warnings.map(({ label }) => label)).toEqual([
      'Recipes without a matching bean', 'Shots without a matching bean', 'Favourite selections without a matching shot',
      'Reference selections without a matching shot and bean',
    ]);
    await target.store.stage(plan);
    expect((await target.store.applyPending()).warnings).toEqual(plan.warnings);
    expect((await target.database.shots.get('s1')).beanId).toBe('gone');
  });

  it('rejects duplicate records and leaves the destination untouched if staging fails or becomes stale', async () => {
    const target = await setup();
    const data = example();
    data.beans.push(data.beans[0]);
    await expect(target.store.preview((await buildArchive(data, appVersion)).file)).rejects.toThrow('duplicate');
    const { file } = await buildArchive(example(), appVersion);
    const plan = await target.store.preview(file);
    target.storage.setItem(MANUAL_SHOT_DRAFT_KEY, '{}');
    await expect(target.store.stage(plan)).rejects.toThrow('draft');
    target.storage.removeItem(MANUAL_SHOT_DRAFT_KEY);
    await target.store.stage(plan);
    await target.database.beans.add({ id: 'changed', name: 'Changed after staging' });
    await expect(target.store.applyPending()).rejects.toThrow('changed');
    await target.store.rollbackPending();
    expect(await target.store.pending()).toBeUndefined();
    expect(await target.database.beans.count()).toBe(1);
  });

  it('resumes after replay write interruption and also supports restoring the previous copy', async () => {
    const target = await setup({ ...empty(), beans: [{ id: 'local', name: 'Before' }] });
    const { file } = await buildArchive(example(), appVersion);
    await target.store.stage(await target.store.preview(file));
    target.writeReplay.mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
    await expect(target.store.applyPending()).rejects.toHaveProperty('name', 'QuotaExceededError');
    expect((await target.store.pending()).started).toBe(true);
    expect(await target.store.lastReport()).toBeUndefined();
    expect((await target.openStore().applyPending()).datasets.every(({ match }) => match)).toBe(true);
    const emptyFile = (await buildArchive(empty(), appVersion)).file;
    await target.store.stage(await target.store.preview(emptyFile));
    target.writeReplay.mockRejectedValueOnce(new Error('Interrupted'));
    await expect(target.store.applyPending()).rejects.toThrow('Interrupted');
    await target.store.rollbackPending();
    const rollback = await target.openStore().applyPending();
    expect(rollback.direction).toBe('rollback');
    expect(rollback.datasets.every(({ match }) => match)).toBe(true);
    expect(await target.database.shots.count()).toBe(2);
  });

  it('aborts the multi-table write as a unit on a failing store request', async () => {
    const target = await setup({ ...empty(), beans: [{ id: 'kept', name: 'Before' }] });
    const { file } = await buildArchive(example(), appVersion);
    await target.store.stage(await target.store.preview(file));
    const transaction = target.database.backendDB().transaction.bind(target.database.backendDB());
    const intercept = vi.spyOn(target.database.backendDB(), 'transaction').mockImplementation((names, mode, options) => {
      const tx = transaction(names, mode, options);
      if (mode === 'readwrite') {
        const objectStore = tx.objectStore.bind(tx);
        vi.spyOn(tx, 'objectStore').mockImplementation((name) => {
          const store = objectStore(name);
          if (name === 'recipes') vi.spyOn(store, 'add').mockImplementation(() => { throw new Error('Write interrupted'); });
          return store;
        });
      }
      return tx;
    });
    await expect(target.store.applyPending()).rejects.toThrow('interrupted');
    expect(await target.database.beans.get('kept')).toBeTruthy();
    expect(await target.database.shots.count()).toBe(0);
    intercept.mockRestore();
    expect((await target.store.applyPending()).datasets.every(({ match }) => match)).toBe(true);
  });

  it('hashes an asset across block boundaries and refuses a failed recovery journal write', async () => {
    const data = example();
    const size = 9 * 1024 * 1024;
    const bytes = new Uint8Array(size);
    bytes[4 * 1024 * 1024] = 222;
    data.replay[0].blob = new Blob([bytes], { type: 'video/webm' });
    data.replay[0].byteSize = size;
    const { file } = await buildArchive(data, appVersion);
    const { snapshot } = await parseArchive(file);
    expect(snapshot.replay[0].blob.size).toBe(size);
    expect(new Uint8Array(await snapshot.replay[0].blob.slice(4 * 1024 * 1024, 4 * 1024 * 1024 + 1).arrayBuffer())[0]).toBe(222);
    const target = await setup({ ...empty(), beans: [{ id: 'local', name: 'Before' }] });
    const plan = await target.store.preview(file);
    const add = vi.spyOn(target.journal.table('transfer'), 'add').mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
    await expect(target.store.stage(plan)).rejects.toHaveProperty('name', 'QuotaExceededError');
    add.mockRestore();
    expect(await target.store.pending()).toBeUndefined();
    expect(await target.database.beans.count()).toBe(1);
  });

  it('rejects corrupted, truncated, unsupported, or unsafe archives', async () => {
    const { file } = await buildArchive(example(), appVersion);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const corrupt = bytes.slice();
    corrupt[corrupt.length - 1] ^= 1;
    await expect(parseArchive(new Blob([corrupt]))).rejects.toThrow('checksum');
    await expect(parseArchive(file.slice(0, -5))).rejects.toThrow('truncated');
    await expect(parseArchive(new Blob([file, 'x']))).rejects.toThrow('trailing');
    const badVersion = bytes.slice();
    const manifestLength = new DataView(bytes.buffer).getUint32(8, true);
    const manifest = new TextDecoder().decode(bytes.slice(44, 44 + manifestLength));
    const payload = new TextEncoder().encode(manifest.replace('"version":1', '"version":2'));
    badVersion.set(payload, 44);
    badVersion.set(new Uint8Array(await crypto.subtle.digest('SHA-256', payload)), 12);
    await expect(parseArchive(new Blob([badVersion]))).rejects.toThrow('Unsupported backup version');
    const data = example();
    data.beans[0].file = new File(['asset'], '../gauge.jpg');
    await expect(buildArchive(data, appVersion)).rejects.toThrow('unsafe filename');
  });
});
