import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const fixture = await readFile(new URL('../src/utils/fixtures/visualizer-sep-profitec-excerpt.csv', import.meta.url), 'utf8');
const pressure = fixture.split(/\r?\n/).filter((row) => row.endsWith('sample: pressure')).map((row) => {
  const [, seconds, bar] = row.split(',');
  return { tS: Number(seconds), bar: Number(bar) };
});
const bean = { id: 'portable-bean', name: 'Portable test coffee', roastType: 'Medium' };
const shot = {
  id: 'portable-shot', beanId: bean.id, timestamp: '2023-03-24T09:38:52.463Z',
  grinderModel: 'Sette 270Wi', setteMacro: 8, setteMicro: 'C',
  notes: 'Portable test extraction', actualDoseG: 18.6, actualYieldG: 38.35, actualTimeS: 58.536, shotRating: 4,
  labPressureCurve: pressure,
  shotProfileTiming: { version: 1, clockDriftMs: 0, pressureOriginMs: 0, extractionStartMs: 0, pressureSource: 'camera' },
};
// Use the recorded SEP excerpt unchanged, including its measured zeros and gap.
const weight = fixture.split(/\r?\n/).filter((row) => row.endsWith('sample: weight')).map((row) => {
  const [, seconds, , grams] = row.split(',');
  return { tS: Number(seconds), weightG: Number(grams) };
});
const recorded = {
  ...shot, id: 'card-recorded', notes: 'Recorded card QA fixture', scaleFlowCurve: weight,
  shotProfileTiming: { ...shot.shotProfileTiming, scaleOriginMs: 0, scaleSource: 'web-bluetooth', extractionEndMs: 58536 },
};
const manual = { id: 'card-manual', beanId: bean.id, timestamp: '2024-01-05T12:00:00Z',
  actualDoseG: 18, actualYieldG: 36, actualTimeS: 30, notes: 'Manual tasting note' };
const { labPressureCurve } = JSON.parse(await readFile(new URL(
  './pressure-label/fixtures/batch-2026-11-03/source/lab-replay-a1efe497-pressure.json', import.meta.url,
), 'utf8'));
const reference = { ...shot, id: 'card-reference', timestamp: '2023-03-24T09:38:52.463Z',
  actualDoseG: undefined, actualYieldG: undefined, actualTimeS: undefined, labPressureCurve, shotProfileTiming: undefined };
const errors = [];
const preview = startPreviewServer(4195);
let browser;

async function openOfflinePage(seedShot, extra = []) {
  const context = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 320, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(preview.url);
  await page.getByText(/choose|experience|grinder/i).first().waitFor();
  await page.evaluate(({ bean, shot, seedShot, extra }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('EspressoDialDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['beans', 'settings', 'shots'], 'readwrite');
      tx.objectStore('settings').put({ id: 'global', experiencePreference: 'brew', grinderModel: 'Sette 270Wi' });
      if (seedShot) {
        tx.objectStore('beans').put(bean);
        tx.objectStore('shots').put(shot);
        tx.objectStore('settings').put({ id: 'history-shot-selections', favouriteIds: [shot.id],
          references: [{ beanId: bean.id, shotId: shot.id }] });
      }
      for (const record of extra) tx.objectStore('shots').put(record);
      if (extra.length) tx.objectStore('settings').put({ id: 'history-shot-selections', favouriteIds: [],
        references: [{ beanId: bean.id, shotId: 'card-reference' }] });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { bean, shot, seedShot, extra });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  return page;
}

async function grabDownload(page, label, scope = page) {
  const pending = page.waitForEvent('download');
  await scope.getByRole('button', { name: label, exact: true }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

async function shotCount(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('EspressoDialDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const count = db.transaction('shots').objectStore('shots').count();
      count.onsuccess = () => { db.close(); resolve(count.result); };
      count.onerror = () => { db.close(); reject(count.error); };
    };
  }));
}

try {
  await waitForServer(preview.url);
  browser = await chromium.launch();
  const source = await openOfflinePage(true);
  await source.getByRole('button', { name: 'History', exact: true }).click();
  const profile = source.getByTestId('history-shot-profile');
  await profile.getByText('Shot profile', { exact: true }).click();
  await profile.getByText('Share Shot', { exact: true }).click();
  await profile.getByAltText('Preview of shot card').waitFor();
  assert.equal(await profile.getByRole('button', { name: /Beanconqueror|Visualizer/ }).count(), 0);
  const single = await grabDownload(source, 'Download shot JSON');
  const parsed = JSON.parse(single.bytes.toString());
  assert.deepEqual(parsed.shots[0].record, shot);
  assert.equal(parsed.shots[0].measurements.rating, 4);
  assert.deepEqual(parsed.selections.favouriteIds, [shot.id]);
  assert.deepEqual(parsed.selections.references, [{ beanId: bean.id, shotId: shot.id }]);
  const summary = await grabDownload(source, 'Download shot CSV');
  assert.match(summary.bytes.toString(), /^"Timestamp \(ISO\)","Timestamp \(Epoch Ms\)"/);
  assert.match(summary.bytes.toString(), /"Portable test coffee"/);
  const sep = await grabDownload(source, 'Download SEP CSV');
  assert.match(sep.bytes.toString(), /^information_type,elapsed,pressure,/);
  assert.match(sep.bytes.toString(), /"moment","0\.336","0\.41368543682058806"/);

  await source.getByTitle('Settings', { exact: true }).click();
  const backup = await grabDownload(source, 'Download all shots as JSON');
  assert.equal(backup.bytes.toString(), single.bytes.toString());

  const target = await openOfflinePage(false);
  await target.getByTitle('Settings', { exact: true }).click();
  const input = target.getByLabel('Restore shot backup');
  const invalid = { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') };
  await input.setInputFiles(invalid);
  await target.getByRole('alert').filter({ hasText: 'readable UTF-8 JSON' }).waitFor();
  const file = { name: backup.name, mimeType: 'application/json', buffer: backup.bytes };
  await input.setInputFiles(file);
  const plan = target.getByRole('region', { name: 'Shot restore preview' });
  await plan.getByText(/1 new shots.*1 linked beans/).waitFor();
  assert.equal(await shotCount(target), 0);
  await plan.getByRole('button', { name: 'Close preview' }).click();
  assert.equal(await shotCount(target), 0);
  await input.setInputFiles(file);
  await plan.getByRole('button', { name: 'Confirm shot restore' }).click();
  await target.getByRole('status').filter({ hasText: 'Restored 1 new shots' }).waitFor();
  assert.equal(await shotCount(target), 1);

  await input.setInputFiles(file);
  await plan.getByText(/1 identical shots already saved/).waitFor();
  assert.equal(await plan.getByRole('button', { name: 'Confirm shot restore' }).count(), 0);
  await target.reload();
  await target.getByRole('button', { name: 'History', exact: true }).click();
  const card = target.getByTestId('history-shot-card');
  await card.getByLabel('Taste rating 4 out of 5').waitFor();
  await card.getByText('Bean reference', { exact: true }).waitFor();
  await card.getByRole('button', { name: 'Favourite shot', pressed: true }).waitFor();
  const cards = await openOfflinePage(true, [recorded, manual, reference]);
  await cards.getByRole('button', { name: 'History', exact: true }).click();
  const openCard = async (notes) => {
    const card = cards.getByTestId('history-shot-card').filter({ hasText: notes });
    const details = card.getByTestId('history-shot-profile');
    await details.locator('summary').first().click();
    await details.getByText('Share Shot', { exact: true }).click();
    return details;
  };
  const output = await mkdtemp(join(tmpdir(), 'espresso-b14-png-'));
  const saveCard = async (details, name, height) => {
    const img = details.getByAltText('Preview of shot card');
    await img.waitFor();
    const previewBytes = await img.evaluate(async (el) => Array.from(new Uint8Array(
      await (await fetch(el.src)).arrayBuffer(),
    )));
    const { bytes } = await grabDownload(cards, 'Download PNG', details);
    assert.deepEqual(bytes, Buffer.from(previewBytes));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), 1200);
    assert.equal(bytes.readUInt32BE(20), height);
    assert.ok((await img.boundingBox()).width <= 320);
    await writeFile(join(output, name + '.png'), bytes);
    return bytes;
  };
  const manualCard = await openCard(manual.notes);
  await saveCard(manualCard, 'manual', 575);
  assert.equal(await manualCard.getByRole('button', { name: 'Download SEP CSV' }).count(), 0);
  const recordedCard = await openCard('Recorded card QA fixture');
  const redacted = await saveCard(recordedCard, 'redacted', 1115);
  for (const label of ['Show bean name', 'Show grinder', 'Show date', 'Show personal notes']) {
    await recordedCard.getByLabel(label).check();
  }
  const visible = await saveCard(recordedCard, 'visible', 1215);
  assert.notDeepEqual(visible, redacted);
  for (const label of ['Show bean name', 'Show grinder', 'Show date', 'Show personal notes']) {
    await recordedCard.getByLabel(label).uncheck();
  }
  assert.deepEqual(await saveCard(recordedCard, 'redacted-again', 1115), redacted);
  await recordedCard.getByLabel('Show bean name').check();
  await cards.goBack();
  await recordedCard.getByText('Share Shot', { exact: true }).click();
  assert.equal(await recordedCard.getByLabel('Show bean name').isChecked(), true);
  await recordedCard.getByLabel('Show bean name').uncheck();
  await recordedCard.locator('summary').first().click();
  await recordedCard.locator('summary').first().click();
  await recordedCard.getByText('Share Shot', { exact: true }).click();
  assert.equal(await recordedCard.getByLabel('Show bean name').isChecked(), false);
  await cards.getByRole('button', { name: 'Dial In', exact: true }).click();
  await cards.getByRole('button', { name: 'History', exact: true }).click();
  const reopened = await openCard('Recorded card QA fixture');
  assert.equal(await reopened.getByLabel('Show bean name').isChecked(), false);
  const other = await openCard(manual.notes);
  assert.equal(await other.getByLabel('Show bean name').isChecked(), false);
  await reopened.getByLabel('Show branding').uncheck();
  await recordedCard.getByLabel('Include bean reference').check();
  await saveCard(recordedCard, 'reference', 1635);
  console.log('B14 PNGs inspected by the smoke at ' + output);
  const report = cards.getByTestId('history-shot-card').filter({ hasText: 'Recorded card QA fixture' });
  await report.getByRole('button', { name: 'Report issue using diagnostic JSON' }).click();
  await cards.getByRole('heading', { name: 'Report issue' }).waitFor();
  await cards.getByText(/diagnostic JSON may contain personal information/).waitFor();
  assert.deepEqual(errors, []);
  console.log('B13-A offline browser smoke passed on the 320px Android viewport.');
} finally {
  await browser?.close();
  await preview.kill();
}
