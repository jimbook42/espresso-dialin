import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const server = startPreviewServer(4183);
let browser;
try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.url);
  await page.waitForFunction(() => document.body.textContent.includes('grinder'));
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('EspressoDialDB');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = Date.now();
    const brewShot = {
      id: 'b09-insights-brew-shot', beanId: 'b09-insights-bean',
      timestamp: new Date(now - 60_000).toISOString(), grinderModel: 'Sette 270Wi',
      actualTimeS: 30, actualDoseG: 18, actualYieldG: 36, tasteProfile: 'sour',
      targetTimeMinS: 27, targetTimeMaxS: 32, targetDoseG: 18, targetYieldG: 36,
      recommendation: {
        recommendedSetting: { macro: 15, micro: 'C' },
        reason: 'GO 1 STEP FINER — Shot is in range but tastes sour.',
      },
    };
    const pressureShot = {
      id: 'b09-insights-pressure-shot', recordType: 'standalone-pressure',
      timestamp: new Date(now).toISOString(), actualTimeS: 7,
      shotName: 'B09 pressure record without sensor samples',
    };
    await new Promise((resolve, reject) => {
      const tx = database.transaction(['settings', 'beans', 'recipes', 'shots'], 'readwrite');
      tx.objectStore('settings').put({ id: 'global', experiencePreference: 'brew', darkMode: true });
      tx.objectStore('beans').put({ id: 'b09-insights-bean', name: 'B09 insight test coffee', roastType: 'Medium' });
      tx.objectStore('recipes').put({ id: 'b09-insights-recipe', beanId: 'b09-insights-bean',
        targetTimeMinS: 27, targetTimeMaxS: 32, targetDoseG: 18, targetYieldG: 36 });
      tx.objectStore('shots').put(brewShot);
      tx.objectStore('shots').put(pressureShot);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });

  await page.reload();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const brewCard = page.getByTestId('history-shot-card').filter({ hasText: 'B09 insight test coffee' });
  await brewCard.getByText('Shot profile', { exact: true }).click();
  const brewInsights = brewCard.getByTestId('shot-insights');
  await brewInsights.getByText('Main takeaway', { exact: true }).waitFor();
  assert.ok((await brewInsights.textContent()).includes('within the saved 27 s–32 s time range'));
  assert.ok((await brewInsights.textContent()).includes('You described this shot as sour.'));
  assert.ok((await brewInsights.textContent()).includes('At the time, the app recommended macro 15, micro C.'));
  assert.ok((await brewInsights.textContent()).includes('Next step'));

  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('EspressoDialDB');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const current = await new Promise((resolve, reject) => {
      const request = database.transaction('settings').objectStore('settings').get('global');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = database.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ ...current, experiencePreference: 'pressure' });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  await page.reload();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const pressureCard = page.getByTestId('history-shot-card').filter({ hasText: 'B09 pressure record without sensor samples' });
  await pressureCard.getByText('Shot profile', { exact: true }).click();
  const pressureInsights = pressureCard.getByTestId('shot-insights');
  await pressureInsights.getByText('Main takeaway', { exact: true }).waitFor();
  assert.ok((await pressureInsights.textContent()).includes('No pressure or scale measurements are available'));
  assert.equal(await pressureInsights.getByText('Next step', { exact: true }).count(), 0);
  assert.ok((await pressureCard.textContent()).includes('Pressure not recorded'));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log('Shot insights browser smoke: Brew and standalone Pressure Tracker passed; 320×640; no page errors.');
} finally {
  await browser?.close();
  await server.kill();
}
