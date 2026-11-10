import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

// A new browser context owns all test data; never connects to the user's profile.
const server = startPreviewServer(4191);
const viewports = [{ width: 320, height: 640 }, { width: 412, height: 915 }];
let browser;
let passed = 0;
const errors = [];

function installStandaloneDisplayMode(context) {
  return context.addInitScript(() => {
    const match = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (String(query).includes('display-mode: standalone')) {
        return {
          matches: true, media: String(query), onchange: null,
          addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
          dispatchEvent() { return false; },
        };
      }
      return match(query);
    };
  });
}

async function readSettings(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('settings').objectStore('settings').get('global');
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    };
  }));
}

async function startShot(page) {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await Promise.race([
    page.getByTestId('adaptive-shot-screen').waitFor(),
    page.getByRole('button', { name: 'Yes, start shot' }).waitFor(),
  ]);
  const yes = page.getByRole('button', { name: 'Yes, start shot' });
  if (await yes.count()) await yes.click();
  await page.getByTestId('adaptive-shot-screen').waitFor();
}

async function stopAndDiscard(page) {
  await page.getByRole('button', { name: 'Stop shot', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Discard shot', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).waitFor();
}

async function openSettings(page) {
  await page.getByTitle('Settings', { exact: true }).evaluate((node) => node.click());
  await page.getByRole('region', { name: 'Shot screen customiser' }).waitFor({ state: 'attached' });
}

async function closeSettings(page) {
  await page.getByRole('button', { name: 'Close settings', exact: true }).evaluate((node) => node.click());
  await page.getByRole('dialog', { name: 'Preferences & Settings' }).waitFor({ state: 'detached' });
}

async function expectChoice(page, visible) {
  const live = page.getByTestId('adaptive-shot-screen');
  const label = visible ? 'Hide gauge' : 'Show gauge';
  await live.locator('.shot-gauge-toggle', { hasText: label }).waitFor();
  assert.equal(await live.locator('.shot-trust-camera--open').count(), visible ? 1 : 0);
  assert.equal(await live.locator('[data-metric="pressure"]').count(), 1);
  assert.equal(await page.locator('[data-testid="shot-reader-video"]').count(), 1);
}

async function expectViewport(page, viewport, visible) {
  await page.setViewportSize(viewport);
  await expectChoice(page, visible);
  const box = await page.evaluate((gaugeVisible) => {
    const rect = (node) => {
      if (!node) return null;
      const bounds = node.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom, height: bounds.height, width: bounds.width };
    };
    const stop = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Stop shot');
    const reading = gaugeVisible
      ? document.querySelector('[data-testid="shot-camera-pressure"]')
      : document.querySelector('[data-metric="pressure"]');
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      toggle: rect(document.querySelector('.shot-camera-toolbar .shot-gauge-toggle')),
      reading: rect(reading),
      stop: rect(stop),
      reader: Boolean(document.querySelector('[data-testid="shot-reader-video"]')),
    };
  }, visible);
  assert.equal(box.reader, true, JSON.stringify({ viewport, box }));
  assert.ok(box.scrollWidth <= box.innerWidth + 1, JSON.stringify({ viewport, box }));
  for (const name of ['toggle', 'reading', 'stop']) {
    const item = box[name];
    assert.ok(item && item.height > 0 && item.width > 0, JSON.stringify({ viewport, name, box }));
    assert.ok(item.top >= -1 && item.bottom <= box.innerHeight + 1, JSON.stringify({ viewport, name, box }));
  }
}

try {
  await waitForServer(server.url);
  browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const context = await browser.newContext({
    viewport: viewports[1],
    permissions: ['camera'],
  });
  await installStandaloneDisplayMode(context);
  const page = await context.newPage();
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
      tx.objectStore('settings').put({
        id: 'global',
        experiencePreference: 'combined',
        grinderModel: 'Sette 270Wi',
        darkMode: true,
        lastSelectedBeanId: 'gauge-visibility-bean',
        preInfusionEnabled: false,
        shotStartCountdown: 0,
        labCameraPressureEnabled: true,
        labPressureCameraPreviewEnabled: true,
        // Geometry only, so the existing start gate can open the shot screen.
        // It has no needle angle and does not supply a pressure reading.
        labGaugeTapCalibration: {
          calibration: {
            compatibility: 'original-flair-58-v1',
            hub: { x: 160, y: 160 },
            radius: 120,
            rotationDeg: 0,
            five: { x: 160, y: 40 },
            ten: { x: 280, y: 160 },
          },
          viewMoved: false,
        },
        shotScreen: { cameraPreview: false, chart: true, bigNumber: 'time' },
      });
      tx.objectStore('beans').put({
        id: 'gauge-visibility-bean', name: 'Gauge visibility coffee', roaster: 'Test roaster',
        roastType: 'Medium', roastDate: '2026-11-01', storageType: 'bag', isFinished: false,
        createdAt: '2026-11-01T00:00:00.000Z',
      });
      tx.objectStore('recipes').put({
        id: 'gauge-visibility-recipe', beanId: 'gauge-visibility-bean',
        targetTimeMinS: 27, targetTimeMaxS: 32, targetDoseG: 18, targetYieldG: 36,
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  });
  await page.reload();
  await page.getByTestId('dial-bean-card').waitFor();

  await startShot(page);
  await expectChoice(page, false);
  for (const viewport of viewports) await expectViewport(page, viewport, false);
  await page.getByTestId('adaptive-shot-screen').locator('.shot-gauge-toggle', { hasText: 'Show gauge' }).click();
  await expectChoice(page, true);
  for (const viewport of viewports) await expectViewport(page, viewport, true);
  await openSettings(page);
  const customiser = page.getByRole('region', { name: 'Shot screen customiser' });
  assert.equal(await customiser.getByRole('switch', { name: 'Show gauge', exact: true }).getAttribute('aria-checked'), 'true');
  assert.equal(await customiser.getByRole('switch', { name: 'Camera preview', exact: true }).getAttribute('aria-checked'), 'false');
  const settingsDialog = page.getByRole('dialog', { name: 'Preferences & Settings' });
  assert.equal(await settingsDialog.getByRole('switch', { name: 'Gauge setup camera preview', exact: true }).getAttribute('aria-checked'), 'true');
  await closeSettings(page);
  await page.getByTestId('adaptive-shot-screen').locator('.shot-gauge-toggle', { hasText: 'Hide gauge' }).click();
  await expectChoice(page, false);
  await stopAndDiscard(page);
  passed++;
  console.log('PASS show then hide updates the open shot and the customiser');

  await startShot(page);
  await expectChoice(page, false);
  await page.getByTestId('adaptive-shot-screen').locator('.shot-gauge-toggle', { hasText: 'Show gauge' }).click();
  await expectChoice(page, true);
  await stopAndDiscard(page);
  await startShot(page);
  await expectChoice(page, true);
  await stopAndDiscard(page);
  passed++;
  console.log('PASS next shot stays on the last Show gauge choice');

  await page.reload();
  await page.getByTestId('dial-bean-card').waitFor();
  await startShot(page);
  await expectChoice(page, true);
  await stopAndDiscard(page);
  const restarted = await context.newPage();
  restarted.on('pageerror', (error) => errors.push(error.message));
  await restarted.goto(server.url);
  await restarted.getByTestId('dial-bean-card').waitFor();
  await startShot(restarted);
  await expectChoice(restarted, true);
  await restarted.getByTestId('adaptive-shot-screen').locator('.shot-gauge-toggle', { hasText: 'Hide gauge' }).click();
  await expectChoice(restarted, false);
  await stopAndDiscard(restarted);
  await restarted.reload();
  await restarted.getByTestId('dial-bean-card').waitFor();
  await startShot(restarted);
  await expectChoice(restarted, false);
  await openSettings(restarted);
  const reloadedCustomiser = restarted.getByRole('region', { name: 'Shot screen customiser' });
  assert.equal(await reloadedCustomiser.getByRole('switch', { name: 'Show gauge', exact: true }).getAttribute('aria-checked'), 'false');
  assert.equal(await reloadedCustomiser.getByRole('switch', { name: 'Camera preview', exact: true }).getAttribute('aria-checked'), 'false');
  assert.equal(await restarted.getByRole('switch', { name: 'Gauge setup camera preview', exact: true }).getAttribute('aria-checked'), 'true');
  const stored = await readSettings(restarted);
  assert.equal(stored.grinderModel, 'Sette 270Wi');
  assert.equal(stored.lastSelectedBeanId, 'gauge-visibility-bean');
  assert.equal(stored.experiencePreference, 'combined');
  assert.equal(stored.labPressureCameraPreviewEnabled, true);
  assert.equal(stored.shotScreen.cameraPreview, false);
  assert.equal(stored.shotScreen.showGauge, false);
  await closeSettings(restarted);
  await stopAndDiscard(restarted);
  passed++;
  console.log('PASS choice survives reload and a new page, and existing settings stay intact');

  await openSettings(restarted);
  await restarted.getByRole('radio', { name: 'Pressure Tracker', exact: true }).check();
  await restarted.getByRole('button', { name: 'Save & Close' }).click();
  await restarted.getByRole('heading', { name: 'Pressure Tracker' }).waitFor();
  await restarted.getByRole('button', { name: 'Start recording' }).waitFor();
  await openSettings(restarted);
  await restarted.getByRole('radio', { name: 'Combined', exact: true }).check();
  await restarted.getByRole('button', { name: 'Save & Close' }).click();
  await restarted.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Dial', exact: true }).click();
  await restarted.getByTestId('dial-bean-card').waitFor();
  await startShot(restarted);
  await expectChoice(restarted, false);
  await stopAndDiscard(restarted);
  passed++;
  console.log('PASS standalone Pressure Tracker and Combined dial still open');

  assert.deepEqual(errors, []);
  console.log(`Gauge visibility smoke: ${passed} passed / 0 failed`);
} catch (error) {
  console.error(`Gauge visibility smoke: ${passed} passed / 1 failed`);
  if (errors.length) console.error(errors);
  throw error;
} finally {
  await browser?.close();
  await server.kill();
}
