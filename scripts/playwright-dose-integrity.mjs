import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const server = startPreviewServer(4197);
const nav = (page, name) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true });
const dose = (page) => page.getByText('Dose (g)', { exact: true }).locator('..').locator('input');
const shots = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('EspressoDialDB');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const request = db.transaction('shots').objectStore('shots').getAll();
    request.onsuccess = () => { db.close(); resolve(request.result); };
    request.onerror = () => { db.close(); reject(request.error); };
  };
}));

let browser;
try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await page.addInitScript(() => {
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    window.shotCardText = [];
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (this.canvas.width === 1200) window.shotCardText.push(text);
      return fillText.call(this, text, ...args);
    };
  });
  await page.goto(server.url);
  await page.getByText(/Choose how you want to use Espresso Dial-In/).waitFor();
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['settings', 'beans', 'recipes'], 'readwrite');
      tx.objectStore('settings').put({ id: 'global', grinderModel: 'Sette 270Wi', experiencePreference: 'combined', lastSelectedBeanId: 'dose-a' });
      for (const [id, name, targetDoseG] of [['dose-a', 'Dose test coffee', 18.5], ['dose-b', 'Second coffee', 20.25]]) {
        tx.objectStore('beans').put({ id, name, roastType: 'Medium' });
        tx.objectStore('recipes').put({ id: id + '-recipe', beanId: id, targetDoseG, targetYieldG: 32, targetTimeMinS: 24, targetTimeMaxS: 28 });
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  const finish = async () => {
    await page.getByRole('button', { name: 'Balanced', exact: true }).click();
    await page.getByRole('button', { name: 'Log shot & calculate grind adjustment' }).click();
    await page.getByTestId('saved-share-shot').waitFor();
  };
  const enterMeasurements = async (time = '26') => {
    await page.getByTestId('dial-yield-tile').locator('input').fill('31.8');
    await page.getByTestId('dial-time-tile').locator('input').fill(time);
  };
  await page.reload();
  await dose(page).waitFor();
  await page.getByText('18.5g', { exact: true }).first().waitFor();
  const displayed = await dose(page).inputValue();
  await enterMeasurements();
  await finish();
  const [saved] = await shots(page);
  assert.deepEqual([displayed, saved.targetDoseG, saved.actualDoseG, saved.brewRatio], ['18.5', 18.5, 18.5, '1:1.7']);

  await page.reload();
  await nav(page, 'History').click();
  const card = page.getByTestId('history-shot-card');
  await card.getByText(/18\.5\/31\.8g/).waitFor();
  await card.getByText('Shot profile', { exact: true }).click();
  await card.getByText('18.5 g', { exact: true }).waitFor();
  await card.getByRole('button', { name: 'Share shot', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Share shot' });
  await share.getByAltText('Preview of shot card').waitFor();
  assert.ok(await page.evaluate(() => window.shotCardText.includes('18.5 g')));
  const pngDownload = page.waitForEvent('download');
  await share.getByRole('button', { name: 'Download PNG' }).click();
  assert.equal((await readFile(await (await pngDownload).path())).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const download = page.waitForEvent('download');
  await share.getByRole('button', { name: 'Export shot JSON' }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8')).shots[0];
  assert.equal(exported.measurements.doseG, 18.5);
  assert.equal(exported.record.actualDoseG, 18.5);
  assert.equal(exported.record.targetDoseG, 18.5);
  await share.getByRole('button', { name: 'Close' }).click();

  await nav(page, 'Dial').click();
  const select = page.getByTestId('dial-bean-select');
  await select.selectOption('dose-b');
  assert.equal(await dose(page).inputValue(), '20.25');
  await select.selectOption('dose-a');
  assert.equal(await dose(page).inputValue(), '18.5');
  await dose(page).fill('18.73');
  await enterMeasurements('27');
  await page.reload();
  await dose(page).waitFor();
  assert.equal(await dose(page).inputValue(), '18.73');
  await finish();
  const updated = await shots(page);
  assert.deepEqual(updated.find((shot) => shot.id === saved.id), saved);
  const manual = updated.find((shot) => shot.id !== saved.id);
  assert.equal(manual.actualDoseG, 18.73);
  assert.equal(manual.targetDoseG, 18.5);
  assert.equal(await dose(page).inputValue(), '18.5');
  await enterMeasurements('28');
  await finish();
  assert.equal((await shots(page)).find((shot) => shot.actualTimeS === 28).actualDoseG, 18.5);
  console.log('PASS cold dose, IndexedDB, reopened History, exported PNG and JSON, recipe switching, manual draft and next shot');
} finally {
  await browser?.close();
  await server.kill();
}
