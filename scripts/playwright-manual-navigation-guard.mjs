import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const server = startPreviewServer(4193);
let browser;
const nav = (page, name) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true });
const input = (page, metric) => page.getByTestId(`dial-${metric}-tile`).locator('input');
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
  const page = await browser.newPage({ serviceWorkers: 'block' });
  page.setDefaultTimeout(8000);
  await seed(page);
  for (const [metric, value] of [['yield', '37'], ['time', '29']]) {
    await input(page, metric).fill(value);
    await page.waitForFunction(() => history.state?.shotBackGuard);
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
    assert.deepEqual(await shots(page), []);
    await nav(page, 'Dial').click();
    assert.equal(await input(page, 'time').inputValue(), '');
    assert.equal(await input(page, 'yield').inputValue(), '');
    assert.equal(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), false);
    console.log(`PASS manual ${metric}: cancel, unload, Back, confirmed discard and empty database`);
  }
  await input(page, 'time').fill('29');
  await input(page, 'yield').fill('37');
  await page.getByRole('button', { name: 'Balanced', exact: true }).click();
  await page.getByRole('button', { name: 'Log shot & calculate grind adjustment', exact: true }).click();
  await page.getByTestId('saved-share-shot').waitFor();
  const saved = await shots(page);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].actualTimeS, 29);
  assert.equal(saved[0].actualYieldG, 37);
  await page.waitForFunction(() => !history.state?.shotBackGuard);
  await nav(page, 'History').click();
  await active(page, 'History');
  await page.goBack();
  await active(page, 'Dial');
  await page.goForward();
  await active(page, 'History');
  console.log('PASS manual save, protection cleared, ordinary Back/Forward');
} finally {
  await browser?.close();
  await server.kill();
}
