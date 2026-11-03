import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

// A new browser context owns all test data; never connects to the user's profile.
const server = startPreviewServer(4181);
let browser;
let passed = 0;
try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.url);
  await page.waitForFunction(() => document.body.textContent.includes('grinder'));
  await page.evaluate(async () => {
    const idb = await new Promise((resolve, reject) => {
      const request = indexedDB.open('EspressoDialDB');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = idb.transaction(['settings', 'beans', 'recipes'], 'readwrite');
      tx.objectStore('settings').put({ id: 'global', grinderModel: 'Sette 270Wi', darkMode: true,
        lastSelectedBeanId: 'shot-screen-test-bean', preInfusionEnabled: false, shotStartCountdown: 0 });
      tx.objectStore('beans').put({ id: 'shot-screen-test-bean', name: 'Shot screen test coffee',
        roaster: 'Test roaster', roastType: 'Medium', roastDate: '2026-11-01', storageType: 'bag',
        isFinished: false, createdAt: '2026-11-01T00:00:00.000Z' });
      tx.objectStore('recipes').put({ id: 'shot-screen-test-recipe', beanId: 'shot-screen-test-bean',
        targetTimeMinS: 27, targetTimeMaxS: 32, targetDoseG: 18, targetYieldG: 36 });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  });
  await page.reload();
  await page.getByTestId('dial-bean-card').waitFor();
  const originalBean = await page.getByTestId('dial-bean-select').inputValue();
  await page.getByTitle('Settings', { exact: true }).click();
  const customiser = page.getByRole('region', { name: 'Shot screen customiser' });
  const preview = customiser.getByTestId('shot-screen-preview');
  const layout = async (expected) => {
    await page.waitForFunction((name) => document.querySelector('[data-testid="shot-screen-preview"] [data-layout]')?.dataset.layout === name, expected);
  };
  await layout('timer');
  await customiser.getByRole('switch', { name: 'Smart scale', exact: true }).click();
  await layout('scale');
  await customiser.getByRole('switch', { name: 'Pressure gauge via camera' }).click();
  await layout('gauge-scale');
  await customiser.getByRole('switch', { name: 'Smart scale', exact: true }).click();
  await layout('gauge');
  await customiser.getByRole('switch', { name: 'Show gauge', exact: true }).click();
  await preview.getByRole('button', { name: 'Hide gauge', exact: true }).first().waitFor();
  await preview.screenshot({ path: path.join(tmpdir(), 'shot-screen-trust-preview.png') });
  await customiser.getByRole('switch', { name: 'Minimal mode' }).click();
  await layout('minimal');
  await preview.getByRole('button', { name: 'Cycle big number' }).click();
  assert.equal(await preview.locator('[data-size="big"]').getAttribute('data-metric'), 'time');
  await customiser.getByRole('button', { name: 'Recommended for my setup' }).click();
  await layout('gauge');
  await customiser.getByRole('switch', { name: 'Timer only', exact: true }).click();
  await layout('timer');
  await customiser.getByRole('switch', { name: 'Minimal mode' }).click();
  await layout('minimal');
  passed++;
  console.log('PASS customiser: four setups, preview, Minimal cycle, trust toggle, reset');

  await page.reload();
  await page.getByTitle('Settings', { exact: true }).click();
  assert.equal(await customiser.getByRole('switch', { name: 'Minimal mode' }).getAttribute('aria-checked'), 'true');
  await page.getByRole('button', { name: '✕', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const live = page.getByTestId('adaptive-shot-screen');
  await live.waitFor();
  await page.waitForFunction(() => parseFloat(document.querySelector('[data-testid="adaptive-shot-screen"] [data-metric="time"]').textContent.replace('Time', '')) >= 1.2);
  await live.getByRole('button', { name: 'Cycle big number' }).click();
  assert.equal(await page.getByRole('button', { name: 'Stop shot', exact: true }).isVisible(), true);
  await page.screenshot({ path: path.join(tmpdir(), 'shot-screen-timer-mobile.png') });
  await page.getByRole('button', { name: 'Stop shot', exact: true }).click();
  assert.ok(Number(await page.getByTestId('dial-time-tile').locator('input').inputValue()) > 0);
  assert.equal(await page.getByTestId('dial-bean-select').inputValue(), originalBean);
  passed++;
  console.log('PASS timer: persists preferences, runs without sensors, cycles without stopping, fills time');

  await page.getByTestId('dial-yield-tile').locator('input').fill('36');
  await page.getByRole('button', { name: 'Balanced', exact: true }).click();
  await page.getByRole('button', { name: 'Log shot & calculate grind adjustment', exact: true }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByTestId('history-shot-card');
  await history.waitFor();
  assert.ok((await history.textContent()).includes('Shot screen test coffee'));
  const shots = await page.evaluate(async () => {
    const idb = await new Promise((resolve) => {
      const request = indexedDB.open('EspressoDialDB');
      request.onsuccess = () => resolve(request.result);
    });
    return new Promise((resolve, reject) => {
      const request = idb.transaction('shots').objectStore('shots').getAll();
      request.onsuccess = () => { idb.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    });
  });
  assert.equal(shots.length, 1);
  assert.equal(shots[0].beanId, originalBean);
  assert.equal(shots[0].actualDoseG, 18);
  assert.equal(shots[0].actualYieldG, 36);
  assert.ok(shots[0].actualTimeS > 0);
  assert.equal(shots[0].grinderModel, 'Sette 270Wi');
  assert.deepEqual(errors, []);
  passed++;
  console.log('PASS bean flow: saves the usual bean-linked shot and renders History without browser errors');
  console.log(`Shot screen browser smoke: ${passed} passed / 0 failed`);
} catch (error) {
  console.error(`Shot screen browser smoke: ${passed} passed / 1 failed`);
  throw error;
} finally {
  await browser?.close();
  await server.kill();
}
