import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const server = startPreviewServer(4185);
const profile = await mkdtemp(join(tmpdir(), 'dialin-experience-'));
const galaxy = { width: 412, height: 915 };
const small = { width: 320, height: 640 };
const recording = JSON.parse(await readFile(new URL(
  './pressure-label/fixtures/batch-2026-11-03/source/lab-replay-a1efe497-pressure.json',
  import.meta.url,
), 'utf8'));
const savedRows = {
  settings: { id: 'global', grinderModel: 'Sette 270Wi', lastSelectedBeanId: 'legacy-bean', brewGuideEnabled: true,
    brewGuideIntroSeen: true, smartScaleDeviceId: 'manual', labCameraPressureEnabled: true,
    labGaugeTapCalibration: { viewMoved: true } },
  beans: { id: 'legacy-bean', name: 'Legacy coffee', isFinished: false, storageType: 'bag' },
  recipes: { id: 'legacy-recipe', beanId: 'legacy-bean', targetDoseG: 18, targetYieldG: 36, targetTimeMinS: 27, targetTimeMaxS: 32 },
  shots: { id: recording.shotId, beanId: 'legacy-bean', grinderModel: 'Sette 270Wi', timestamp: '2026-11-03T00:00:00Z',
    actualTimeS: 30, actualDoseG: 18, actualYieldG: 36, tasteProfile: 'balanced', shotRating: 4,
    labPressureCurve: recording.labPressureCurve },
};

function accessRows(page, rows = null) {
  return page.evaluate(({ rows, stores }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(stores, rows ? 'readwrite' : 'readonly');
      const result = {};
      for (const store of stores) {
        if (rows) tx.objectStore(store).put(rows[store]);
        else {
          const request = tx.objectStore(store).getAll();
          request.onsuccess = () => { result[store] = request.result; };
        }
      }
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), { rows, stores: Object.keys(savedRows) });
}

async function visit(page) {
  await page.addInitScript(() => {
    window.mediaRequests = [];
    const devices = navigator.mediaDevices;
    const request = devices.getUserMedia.bind(devices);
    devices.getUserMedia = (constraints) => {
      window.mediaRequests.push(constraints);
      return request(constraints);
    };
  });
  await page.goto(server.url);
}

function nav(page, name) {
  return page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true });
}

async function current(page, name) {
  await page.waitForFunction((name) => (
    document.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]')?.textContent === name
  ), name);
}

async function chooseInSettings(page, label) {
  const settings = page.getByRole('dialog', { name: 'Preferences & Settings' });
  await settings.getByRole('radio', { name: label, exact: true }).check();
  await settings.getByRole('button', { name: 'Save & Close' }).click();
  await settings.waitFor({ state: 'hidden' });
}

async function checkMobile(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  for (const button of await navigation.getByRole('button').all()) {
    const box = await button.boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44);
  }
}

let browser;
let persistent;
try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  const brew = await browser.newPage({ viewport: small, isMobile: true, hasTouch: true });
  await visit(brew);
  const defaultChoice = brew.getByRole('radio', { name: 'Brew & Dial-In', exact: true });
  await defaultChoice.focus();
  await defaultChoice.press('ArrowDown');
  assert.equal(await brew.getByRole('radio', { name: 'Pressure Tracker', exact: true }).isChecked(), true);
  await brew.getByRole('radio', { name: 'Brew & Dial-In', exact: true }).check();
  await brew.getByRole('button', { name: 'Continue', exact: true }).click();
  await current(brew, 'Dial');
  await brew.getByRole('button', { name: 'Add Your First Bean' }).waitFor();
  assert.equal(await nav(brew, 'Pressure').count(), 0);
  await checkMobile(brew);
  await brew.reload();
  await current(brew, 'Dial');
  await brew.getByTitle('Settings', { exact: true }).click();
  assert.equal(await brew.getByRole('radio', { name: 'Brew & Dial-In', exact: true }).isChecked(), true);
  assert.equal(await brew.getByRole('switch', { name: 'Pressure from camera (beta)' }).isVisible(), false);
  await chooseInSettings(brew, 'Combined');
  await nav(brew, 'Pressure').click();
  await current(brew, 'Pressure');
  await checkMobile(brew);
  assert.deepEqual(await brew.evaluate(() => window.mediaRequests), []);
  console.log('PASS keyboard onboarding, simple Brew, mobile navigation and Settings switch at 320×640');

  const combined = await browser.newPage({ viewport: galaxy, isMobile: true, hasTouch: true });
  await visit(combined);
  await combined.getByRole('radio', { name: 'Combined', exact: true }).check();
  await combined.getByRole('button', { name: 'Set up equipment first' }).click();
  await combined.getByLabel('Primary grinder').selectOption('Sette 270Wi');
  await combined.getByRole('button', { name: 'Next', exact: true }).click();
  await combined.getByRole('button', { name: 'Next', exact: true }).click();
  await combined.getByRole('button', { name: 'Finish', exact: true }).click();
  await current(combined, 'Dial');
  await nav(combined, 'Brew Guide').waitFor();
  await nav(combined, 'Pressure').waitFor();
  const combinedRows = await accessRows(combined);
  assert.equal(combinedRows.settings[0].experiencePreference, 'combined');
  assert.equal(combinedRows.settings[0].grinderModel, 'Sette 270Wi');
  console.log('PASS Combined onboarding preserves optional grinder, scale and Brew Guide setup');

  const legacy = await browser.newPage({ viewport: galaxy, isMobile: true, hasTouch: true });
  await visit(legacy);
  await legacy.getByRole('heading', { name: 'Welcome' }).waitFor();
  await accessRows(legacy, savedRows);
  await legacy.reload();
  await current(legacy, 'Dial');
  await legacy.getByTestId('dial-bean-card').waitFor();
  await nav(legacy, 'Brew Guide').waitFor();
  await nav(legacy, 'Pressure').waitFor();
  const beforeSwitch = await accessRows(legacy);
  await legacy.getByTitle('Settings', { exact: true }).click();
  assert.equal(await legacy.getByRole('radio', { name: 'Combined', exact: true }).isChecked(), true);
  await chooseInSettings(legacy, 'Pressure Tracker');
  await current(legacy, 'Pressure');
  await checkMobile(legacy);
  await legacy.getByRole('button', { name: 'View shot history' }).click();
  await current(legacy, 'History');
  await legacy.getByTestId('history-shot-card').getByText('Legacy coffee', { exact: false }).waitFor();
  await legacy.getByTestId('history-shot-card').getByText('4', { exact: true }).waitFor();
  await legacy.getByTitle('Settings', { exact: true }).click();
  await chooseInSettings(legacy, 'Brew & Dial-In');
  const afterSwitch = await accessRows(legacy);
  assert.deepEqual(afterSwitch, { ...beforeSwitch,
    settings: [{ ...beforeSwitch.settings[0], experiencePreference: 'brew' }] });
  assert.deepEqual(await legacy.evaluate(() => window.mediaRequests), []);
  console.log('PASS legacy Dial and Brew Guide, rated History and unchanged stored data at 412×915');

  for (let launch = 0; launch < 3; launch += 1) {
    persistent = await chromium.launchPersistentContext(profile, { viewport: galaxy, isMobile: true, hasTouch: true });
    const pressure = persistent.pages()[0];
    await visit(pressure);
    if (launch === 0) {
      await pressure.getByRole('radio', { name: 'Pressure Tracker', exact: true }).check();
      await pressure.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await current(pressure, 'Pressure');
    const start = pressure.getByRole('button', { name: 'Start recording', exact: true });
    await start.waitFor();
    assert.equal(await start.isEnabled(), false);
    await pressure.getByRole('button', { name: 'Pressure settings' }).click();
    assert.equal(await pressure.getByRole('switch', { name: 'Pressure from camera (beta)' }).isChecked(), false);
    assert.deepEqual(await pressure.evaluate(() => window.mediaRequests), []);
    const { beans, recipes, shots, settings } = await accessRows(pressure);
    assert.deepEqual({ beans, recipes, shots }, { beans: [], recipes: [], shots: [] });
    assert.deepEqual(settings, [{ id: 'global', experiencePreference: 'pressure' }]);
    await pressure.evaluate(() => navigator.serviceWorker.ready);
    await persistent.close();
    persistent = null;
  }
  console.log('PASS Pressure onboarding without beans, grinder or camera requests across three browser launches');
} finally {
  await persistent?.close();
  await browser?.close();
  await server.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
