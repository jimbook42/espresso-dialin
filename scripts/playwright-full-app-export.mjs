import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';
import { v1Bean, v1Recipe, v1Shot } from '../src/transfer/historicalFixtures.js';
import { parseArchive } from '../src/transfer/archive.js';

const server = startPreviewServer(4198);
let browser;
try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  await page.goto(server.url);
  await page.waitForFunction(() => document.body.textContent.includes('grinder'));
  const settings = { id: 'global', grinderModel: 'Sette 270Wi', experiencePreference: 'combined',
    lastSelectedBeanId: 'b', anonymousUsageStats: false };
  await page.evaluate(async ({ settings, v1Bean, v1Recipe, v1Shot }) => {
    const openDb = (name, version, upgrade) => new Promise((resolve, reject) => {
      const open = version ? indexedDB.open(name, version) : indexedDB.open(name);
      if (upgrade) open.onupgradeneeded = () => upgrade(open.result);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
    });
    const write = (db, stores, operation) => new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => reject(tx.error);
      operation(tx);
    });
    const db = await openDb('EspressoDialDB');
    await write(db, ['settings', 'beans', 'recipes', 'shots'], (tx) => {
      tx.objectStore('settings').add(settings);
      tx.objectStore('beans').add(v1Bean);
      tx.objectStore('recipes').add(v1Recipe);
      tx.objectStore('shots').add(v1Shot);
      tx.objectStore('beans').add({ id: 'b', name: 'Test bean' });
      tx.objectStore('beans').add({ id: 'unused', name: 'Unused bean' });
      tx.objectStore('recipes').add({ id: 'r', beanId: 'b', targetYieldG: 36 });
      tx.objectStore('shots').add({ id: 's', beanId: 'b', actualYieldG: 36.125, actualTimeS: 28.01,
        timestamp: '2026-07-04T00:00:00Z' });
    });
    const replay = await openDb('EspressoDialLabReplay', 1, (db) => db.createObjectStore('lastReplay'));
    await write(replay, ['lastReplay'], (tx) => tx.objectStore('lastReplay').put({
      shotId: 's', byteSize: 3, mimeType: 'video/webm', samples: [],
      blob: new Blob([new Uint8Array([3, 255, 9])], { type: 'video/webm' }),
    }, 'last'));
    localStorage.setItem('espresso-dialin.beans-finished-section-open', '1');
    localStorage.setItem('other-app-key', 'excluded');
  }, { settings, v1Bean, v1Recipe, v1Shot });
  await page.reload();
  await page.getByTitle('Settings', { exact: true }).click();
  const transfer = page.getByRole('region', { name: 'Transfer & Backup' });
  assert.equal(await transfer.getByRole('button', { name: 'Import existing app' }).count(), 0);
  const downloadReady = page.waitForEvent('download');
  await transfer.getByRole('button', { name: 'Export entire app' }).click();
  const download = await downloadReady;
  assert.match(download.suggestedFilename(), /^espresso-dial-in-.*\.dialinbackup$/);
  const archiveBytes = await readFile(await download.path());
  const { snapshot, manifest } = await parseArchive(new Blob([archiveBytes]));
  assert.equal(manifest.version, 1);
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.appVersion, version);
  assert.deepEqual(snapshot.settings, [settings]);
  assert.deepEqual(snapshot.beans.map(({ id }) => id), ['b', v1Bean.id, 'unused']);
  assert.equal(snapshot.shots[0].actualYieldG, 36.125);
  assert.deepEqual(snapshot.shots.find(({ id }) => id === v1Shot.id), v1Shot);
  assert.deepEqual(new Uint8Array(await snapshot.replay[0].blob.arrayBuffer()), new Uint8Array([3, 255, 9]));
  assert.deepEqual(snapshot.preferences, [{ id: 'espresso-dialin.beans-finished-section-open', value: '1' }]);
  assert.deepEqual(errors, []);
  console.log('PASS PWA Settings downloads a full archive with original records and replay bytes');

  // A separate Chromium profile exercises the Android startup and restore UI.
  // The platform hook here does not exercise the native file picker or bridge.
  const destination = await browser.newContext({ serviceWorkers: 'block' });
  await destination.addInitScript(() => { window.CapacitorCustomPlatform = { name: 'android' }; });
  const android = await destination.newPage();
  android.on('pageerror', (error) => { errors.push(error.message); });
  await android.goto(server.url);
  await android.waitForFunction(() => document.body.textContent.includes('grinder'));
  await android.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ id: 'global', grinderModel: 'Niche Zero', experiencePreference: 'brew',
        anonymousUsageStats: false });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => reject(tx.error);
    };
  }));
  await android.reload();
  const settingsButton = android.getByTitle('Settings', { exact: true });
  await settingsButton.click();
  const importSection = android.getByRole('region', { name: 'Transfer & Backup' });
  await importSection.locator('input[type=file]').setInputFiles({
    name: download.suggestedFilename(), mimeType: 'application/octet-stream', buffer: archiveBytes,
  });
  await importSection.getByText('Import preview', { exact: true }).waitFor();
  await importSection.getByRole('checkbox', { name: 'Replace supported Android data with the exact copy' }).check();
  await importSection.getByRole('button', { name: 'Confirm transfer' }).click();
  await importSection.waitFor({ state: 'hidden' });
  await settingsButton.waitFor();
  await android.getByRole('button', { name: 'History', exact: true }).click();
  await android.getByTestId('history-shot-card').nth(1).waitFor();
  assert.equal(await android.getByTestId('history-shot-card').count(), 2);
  assert.match(await android.getByTestId('history-shot-card').nth(1).innerText(), /13.?E/);
  await android.getByRole('button', { name: 'Stats', exact: true }).click();
  await android.getByRole('heading', { name: 'Extraction analytics & statistics' }).waitFor();
  assert.match(await android.getByText('Total', { exact: true }).locator('..').innerText(), /Total\s+2 shots/i);
  await android.reload();
  await settingsButton.click();
  await importSection.getByRole('button', { name: 'Verify imported data' }).click();
  await importSection.getByText('Transfer verification: PASS', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('shots', 'readwrite');
      const shots = tx.objectStore('shots');
      const read = shots.get('s');
      read.onsuccess = () => {
        const bytes = new Uint16Array([1, 257, 65530]);
        const metadata = { bytes, view: new DataView(bytes.buffer, 2, 4) };
        metadata.self = metadata;
        shots.put({ ...read.result, metadata });
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => reject(tx.error);
    };
  }));
  const secondDownload = page.waitForEvent('download');
  await transfer.getByRole('button', { name: 'Export entire app' }).click();
  const v2File = await secondDownload;
  const v2Bytes = await readFile(await v2File.path());
  const v2 = await parseArchive(new Blob([v2Bytes]));
  assert.equal(v2.manifest.version, 2);
  assert.equal(v2.manifest.appVersion, version);
  assert.deepEqual(v2.snapshot.shots.find(({ id }) => id === v1Shot.id), v1Shot);
  const metadata = v2.snapshot.shots.find(({ id }) => id === 's').metadata;
  assert.equal(metadata.self, metadata);
  assert.equal(metadata.view.buffer, metadata.bytes.buffer);

  await importSection.locator('input[type=file]').setInputFiles({
    name: v2File.suggestedFilename(), mimeType: 'application/octet-stream', buffer: v2Bytes,
  });
  await importSection.getByText('Import preview', { exact: true }).waitFor();
  await importSection.getByRole('checkbox', { name: 'Replace supported Android data with the exact copy' }).check();
  await importSection.getByRole('button', { name: 'Confirm transfer' }).click();
  await importSection.waitFor({ state: 'hidden' });
  await settingsButton.click();
  await importSection.getByRole('button', { name: 'Verify imported data' }).click();
  await importSection.getByText('Transfer verification: PASS', { exact: true }).waitFor();
  const persisted = await android.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('shots').objectStore('shots').get('s');
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => {
        db.close();
        const metadata = read.result.metadata;
        resolve({ bytes: Array.from(metadata.bytes), offset: metadata.view.byteOffset, span: metadata.view.byteLength,
          shared: metadata.view.buffer === metadata.bytes.buffer, cyclic: metadata.self === metadata });
      };
    };
  }));
  assert.deepEqual(persisted, { bytes: [1, 257, 65530], offset: 2, span: 4, shared: true, cyclic: true });
  assert.deepEqual(errors, []);
  console.log('PASS v2 PWA export and Android restore UI preserve typed views, offsets and cyclic metadata after reload');
  await destination.close();
  console.log('PASS Android restore UI in Chromium: conflict preview, exact copy, History, Stats and verification after reload');

} finally {
  await browser?.close();
  await server.kill();
}
