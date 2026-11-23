import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { parseCsvLine, parseShotsCsvText } from '../src/utils/csvImport.js';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const fixture = await readFile(new URL('../src/utils/fixtures/visualizer-sep-profitec-excerpt.csv', import.meta.url), 'utf8');
const samples = fixture.split(/\r?\n/).map(parseCsvLine);
const bean = { id: 'legacy-bean', name: '   ', roastType: 'Medium' };
const unknown = {
  id: 'legacy-shot', beanId: bean.id, timestamp: '2023-03-24T09:38:52.463Z',
  grinderModel: 'Sette 270Wi', setteMacro: 8, setteMicro: 'C',
  notes: 'Legacy recorded shot', actualDoseG: 18, actualYieldG: 36.2, actualTimeS: 58.536,
  labPressureCurve: samples.filter((row) => row.at(-1) === 'sample: pressure')
    .map((row) => ({ tS: Number(row[1]), bar: Number(row[2]) })),
  scaleFlowCurve: samples.filter((row) => row.at(-1) === 'sample: weight')
    .map((row) => ({ tS: Number(row[1]), weightG: Number(row[3]) })),
};
assert.ok(unknown.labPressureCurve.length && unknown.scaleFlowCurve.length);
const known = {
  ...unknown, id: 'known-shot', timestamp: '2023-03-25T09:38:52.463Z', notes: 'Known metadata shot',
  beanAgeDays: 0, storageType: 'bag', brewRatio: '1:2.011',
};
const reference = { beanId: bean.id, shotId: unknown.id };
const globalSettings = { id: 'global', experiencePreference: 'combined', grinderModel: 'Sette 270Wi' };
const press = (page, name) => page.getByRole('button', { name, exact: true }).click();
const settings = (page) => page.getByTitle('Settings', { exact: true }).click();
const preview = startPreviewServer(4291);
let browser;

async function storage(page, seed) {
  return page.evaluate((data) => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tables = ['beans', 'shots', 'settings', 'recipes'];
      const tx = db.transaction(tables, data ? 'readwrite' : 'readonly');
      const result = {};
      for (const table of tables) {
        const store = tx.objectStore(table);
        if (data) for (const record of data[table] ?? []) store.put(record);
        else {
          const read = store.getAll();
          read.onsuccess = () => { result[table] = read.result; };
        }
      }
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), seed);
}

async function offlinePage(seed) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(preview.url);
  await page.getByText(/choose|experience|grinder/i).first().waitFor();
  await storage(page, seed);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  return page;
}

async function download(page, label, scope = page) {
  const pending = page.waitForEvent('download');
  await press(scope, label);
  const file = await pending;
  return readFile(await file.path());
}

function csvColumns(bytes) {
  const { rows } = parseShotsCsvText(bytes.toString());
  const header = parseCsvLine(bytes.toString().split('\n')[0]);
  return ['Ratio', 'Bean Age (Days)', 'Storage', 'Rating'].map((name) => rows[0][header.indexOf(name)]);
}

try {
  await waitForServer(preview.url);
  browser = await chromium.launch();
  const page = await offlinePage({ beans: [bean], shots: [unknown, known], settings: [
    { ...globalSettings, lastSelectedBeanId: bean.id },
    { id: 'history-shot-selections', favouriteIds: [], references: [reference] },
  ] });
  await press(page, 'History');
  const card = page.getByTestId('history-shot-card').filter({ hasText: unknown.notes });
  const profile = card.getByTestId('history-shot-profile');
  await profile.getByText('Shot profile', { exact: true }).click();
  const share = card.getByRole('button', { name: 'Share shot', exact: true });
  const shareDialog = page.getByRole('dialog', { name: 'Share shot' });
  await share.click();
  const original = JSON.parse(await download(page, 'Export shot JSON', shareDialog));
  assert.equal(original.shots[0].measurements.rating, null);
  assert.deepEqual(original.selections.favouriteIds, []);
  await shareDialog.getByLabel('Show personal notes').check();
  await page.goBack();
  await shareDialog.waitFor({ state: 'hidden' });
  assert.equal(await profile.evaluate((node) => node.open), true);
  await press(profile, 'Rate 3 stars');
  await card.getByLabel('Taste rating 3 out of 5').waitFor();
  await press(card, 'Favourite shot');
  await card.getByRole('button', { name: 'Favourite shot', pressed: true }).waitFor();
  await share.click();
  assert.equal(await shareDialog.getByLabel('Show personal notes').isChecked(), true);
  const updated = JSON.parse(await download(page, 'Export shot JSON', shareDialog));
  assert.equal(updated.shots[0].measurements.rating, 3);
  assert.equal(updated.shots[0].measurements.ratio, 36.2 / 18);
  assert.deepEqual(updated.selections, { favouriteIds: [unknown.id], references: [reference] });
  const missingCsv = await download(page, 'Download shot CSV', shareDialog);
  assert.deepEqual(csvColumns(missingCsv), ['1:2.0', '', '', '3']);
  const png = await download(page, 'Download PNG', shareDialog);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  console.log('PASS reopened Share Shot exports rating 3 and favourite, with Back, privacy selection and PNG preserved');

  const knownCard = page.getByTestId('history-shot-card').filter({ hasText: known.notes });
  await press(shareDialog, 'Close');
  await shareDialog.waitFor({ state: 'hidden' });
  await press(knownCard, 'Share shot');
  const knownCsv = await download(page, 'Download shot CSV', shareDialog);
  assert.deepEqual(csvColumns(knownCsv).slice(0, 3), ['1:2.011', '0', 'bag']);
  await press(shareDialog, 'Close');
  await shareDialog.waitFor({ state: 'hidden' });
  await settings(page);
  const backup = await download(page, 'Download all shots as JSON');
  const before = await storage(page);

  const restored = await offlinePage({ settings: [globalSettings] });
  await settings(restored);
  await restored.getByLabel('Restore shot backup').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: backup });
  await restored.getByRole('region', { name: 'Shot restore preview' }).getByText(/2 new shots and 1 linked beans/).waitFor();
  assert.deepEqual((await storage(restored)).shots, []);
  await press(restored, 'Confirm shot restore');
  await restored.getByRole('status').filter({ hasText: 'Restored 2 new shots' }).waitFor();
  const after = await storage(restored);
  assert.deepEqual(after.beans, [bean]);
  assert.deepEqual(after.shots, before.shots);
  assert.deepEqual(after.settings.find((row) => row.id === 'history-shot-selections'),
    before.settings.find((row) => row.id === 'history-shot-selections'));
  assert.deepEqual(JSON.parse(await download(restored, 'Download all shots as JSON')), JSON.parse(backup));
  console.log('PASS legacy backup restores two equivalent shots, both measured curves, rating, linked bean, favourite and reference');

  const imported = await offlinePage({ settings: [globalSettings] });
  await settings(imported);
  for (const [index, bytes] of [missingCsv, knownCsv].entries()) {
    await imported.locator('input[accept=".csv,text/csv"]').setInputFiles({ name: `shot-${index}.csv`, mimeType: 'text/csv', buffer: bytes });
    await imported.waitForFunction((size) => new Promise((resolve) => {
      const request = indexedDB.open('EspressoDialDB');
      request.onsuccess = () => {
        const db = request.result;
        const count = db.transaction('shots').objectStore('shots').count();
        count.onsuccess = () => { db.close(); resolve(count.result === size); };
      };
    }), index + 1);
  }
  const rows = (await storage(imported)).shots.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  assert.equal(Object.hasOwn(rows[0], 'beanAgeDays'), false);
  assert.equal(Object.hasOwn(rows[0], 'storageType'), false);
  assert.deepEqual(rows.map(({ actualDoseG, actualYieldG, brewRatio }) => [actualDoseG, actualYieldG, brewRatio]),
    [[18, 36.2, '1:2.0'], [18, 36.2, '1:2.011']]);
  assert.deepEqual([rows[1].beanAgeDays, rows[1].storageType], [0, 'bag']);
  console.log('PASS browser CSV export/import preserves blanks, explicit 0/bag and both ratios');

  const dial = await offlinePage({
    beans: [{ ...bean, name: 'Manual logging test coffee' }],
    recipes: [{ id: 'manual-recipe', beanId: bean.id, targetDoseG: 18, targetYieldG: 36,
      targetTimeMinS: 27, targetTimeMaxS: 32 }],
    settings: [{ ...globalSettings, lastSelectedBeanId: bean.id, labCameraPressureEnabled: true }],
  });
  await dial.getByTestId('dial-time-tile').locator('input').fill('29');
  await dial.getByTestId('dial-yield-tile').locator('input').fill('37');
  await press(dial, 'Balanced');
  await press(dial, 'Log shot & calculate grind adjustment');
  await dial.getByTestId('saved-share-shot').waitFor();
  const manual = (await storage(dial)).shots;
  assert.equal(manual.length, 1);
  assert.deepEqual([manual[0].actualTimeS, manual[0].actualYieldG], [29, 37]);
  console.log('PASS manual Dial-In logging remains available offline with camera pressure enabled');

  const camera = await offlinePage({ settings: [{
    ...globalSettings, experiencePreference: 'pressure', labCameraPressureEnabled: true,
  }] });
  const offlineMessage = 'Pressure camera unavailable offline. Reconnect to the internet to try again.';
  await camera.getByText(offlineMessage, { exact: true }).waitFor();
  assert.equal(await camera.getByRole('button', { name: 'Start recording' }).isDisabled(), true);
  await press(camera, 'Calibrate gauge');
  await camera.getByText(offlineMessage, { exact: true }).last().waitFor();
  const assets = ['/flair-pressure-lab/opencv.js', '/flair-pressure-lab/needle.onnx',
    '/flair-pressure-lab/ort/ort-wasm-simd-threaded.wasm'];
  const responses = assets.map((asset) => camera.waitForResponse((response) => new URL(response.url()).pathname === asset && response.ok()));
  await camera.context().setOffline(false);
  await Promise.all(responses);
  await camera.getByText(offlineMessage, { exact: true }).first().waitFor({ state: 'hidden' });
  console.log('PASS cold offline Pressure Tracker and setup give guidance, then retry all three assets on reconnection');
} finally {
  await browser?.close();
  await preview.kill();
}
