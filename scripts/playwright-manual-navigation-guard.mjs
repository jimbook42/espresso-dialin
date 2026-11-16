import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';
import { MANUAL_SHOT_DRAFT_KEY } from '../src/utils/manualShotDraft.js';

const server = startPreviewServer(4193);
let browser;
const nav = (page, name) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true });
const input = (page, metric) => page.getByTestId(`dial-${metric}-tile`).locator('input');
const readDraft = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), MANUAL_SHOT_DRAFT_KEY);
const injectDraft = (page, draft) => page.evaluate(({ key, draft }) => {
  localStorage.setItem(key, JSON.stringify(draft));
}, { key: MANUAL_SHOT_DRAFT_KEY, draft });

async function expectMeasurements(page, time, yieldG) {
  await active(page, 'Dial');
  assert.equal(await input(page, 'time').inputValue(), time);
  assert.equal(await input(page, 'yield').inputValue(), yieldG);
}
const shots = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('EspressoDialDB');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const request = db.transaction('shots').objectStore('shots').getAll();
    request.onsuccess = () => { db.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
  };
}));
async function seed(page) {
  await page.goto(server.url);
  await page.waitForFunction(() => document.body.textContent.includes('grinder'));
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['settings', 'beans', 'recipes'], 'readwrite');
      tx.objectStore('settings').put({ id: 'global', grinderModel: 'Sette 270Wi', lastSelectedBeanId: 'bean', experiencePreference: 'combined', shotStartCountdown: 0 });
      tx.objectStore('beans').put({ id: 'bean', name: 'Test coffee', roastType: 'Medium' });
      tx.objectStore('recipes').put({ id: 'recipe', beanId: 'bean', targetTimeMinS: 27, targetTimeMaxS: 32, targetDoseG: 18, targetYieldG: 36 });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await nav(page, 'Dial').waitFor();
}
async function active(page, name) {
  await page.waitForFunction((label) => [...document.querySelectorAll('nav[aria-label="Main navigation"] button')].some((b) => b.textContent.trim() === label && b.getAttribute('aria-current') === 'page'), name);
}
try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: 'block' });
  context.setDefaultTimeout(8000);
  let page = await context.newPage();
  await seed(page);
  for (const [metric, value] of [['yield', '37'], ['time', '29']]) {
    await input(page, metric).fill(value);
    await page.waitForFunction(() => history.state?.shotBackGuard);
    if (metric === 'yield') {
      await page.reload();
    } else {
      await page.close();
      page = await context.newPage();
      await page.goto(server.url);
    }
    await expectMeasurements(page, metric === 'time' ? value : '', metric === 'yield' ? value : '');
    assert.deepEqual(await shots(page), []);
    console.log(`PASS manual ${metric} recovery after ${metric === 'yield' ? 'reload' : 'closing the page'}`);
    page.once('dialog', async (dialog) => { assert.equal(dialog.message(), 'Discard this unsaved shot?'); await dialog.dismiss(); });
    await nav(page, 'History').click();
    await active(page, 'Dial');
    assert.equal(await input(page, metric).inputValue(), value);
    assert.equal(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), true);
    await page.goBack();
    await page.waitForFunction(() => history.state?.dialTab === 'dial' && history.state?.shotBackGuard);
    assert.equal(await input(page, metric).inputValue(), value);
    page.once('dialog', (dialog) => dialog.accept());
    await nav(page, 'History').click();
    await active(page, 'History');
    assert.equal(await readDraft(page), null);
    assert.deepEqual(await shots(page), []);
    await nav(page, 'Dial').click();
    assert.equal(await input(page, 'time').inputValue(), '');
    assert.equal(await input(page, 'yield').inputValue(), '');
    assert.equal(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), false);
    console.log(`PASS manual ${metric}: cancel, unload, Back, confirmed discard and empty database`);
  }
  // Observe storage in the same JavaScript task as the input, before any lifecycle event.
  const immediateTime = await input(page, 'time').evaluate((element, key) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '30');
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return JSON.parse(localStorage.getItem(key))?.time;
  }, MANUAL_SHOT_DRAFT_KEY);
  assert.equal(immediateTime, '30');
  await page.close();
  page = await context.newPage();
  await page.goto(server.url);
  await expectMeasurements(page, '30', '');
  assert.deepEqual(await shots(page), []);
  console.log('PASS immediate exit after input');

  await input(page, 'time').fill('29');
  await input(page, 'yield').fill('37');
  await page.getByRole('button', { name: 'Balanced', exact: true }).click();
  await page.getByRole('button', { name: 'Rate shot 4 out of 5' }).click();
  await page.getByTestId('dial-notes-card').locator('input').fill('Test notes');
  await page.reload();
  await expectMeasurements(page, '29', '37');
  assert.equal(await page.getByRole('button', { name: 'Rate shot 4 out of 5' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByTestId('dial-notes-card').locator('input').inputValue(), 'Test notes');
  assert.deepEqual(await shots(page), []);
  const draftBeforeSave = await readDraft(page);
  console.log('PASS updated measurements and shot details recover together');

  await page.getByRole('button', { name: 'Log shot & calculate grind adjustment', exact: true }).click();
  await page.getByTestId('saved-share-shot').waitFor();
  const saved = await shots(page);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].actualTimeS, 29);
  assert.equal(saved[0].actualYieldG, 37);
  assert.equal(saved[0].notes, 'Test notes');
  assert.equal(saved[0].shotRating, 4);
  assert.equal(await readDraft(page), null);
  await page.waitForFunction(() => !history.state?.shotBackGuard);
  await nav(page, 'History').click();
  await active(page, 'History');
  await page.goBack();
  await active(page, 'Dial');
  await page.goForward();
  await active(page, 'History');
  console.log('PASS manual save, protection cleared, ordinary Back/Forward');

  await nav(page, 'Dial').click();
  await input(page, 'yield').fill('38');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Discard shot' }).click();
  await page.waitForFunction(() => !history.state?.shotBackGuard);
  assert.equal(await readDraft(page), null);
  await page.reload();
  await expectMeasurements(page, '', '');
  assert.deepEqual(await shots(page), saved);
  console.log('PASS explicit Discard clears recovery without creating a shot');

  for (const [reason, draft] of [
    ['already saved', draftBeforeSave],
    ['expired', { ...draftBeforeSave, id: 'expired', updatedAt: Date.now() - 25 * 60 * 60 * 1000 }],
    ['wrong bean', { ...draftBeforeSave, id: 'wrong-bean', beanId: 'other-bean' }],
  ]) {
    await injectDraft(page, draft);
    await page.reload();
    await expectMeasurements(page, '', '');
    assert.equal(await readDraft(page), null);
    assert.deepEqual(await shots(page), saved);
    console.log(`PASS ${reason} draft is ignored`);
  }
} finally {
  await browser?.close();
  await server.kill();
}
