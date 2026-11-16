import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const server = startPreviewServer(4193);
const previous = 'data:text/html,Before%20onboarding';
const button = (root, name) => root.getByRole('button', { name, exact: true });

function rows(page, table) {
  return page.evaluate((table) => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction(table).objectStore(table).getAll();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }), table);
}

async function current(page, tab) {
  const label = tab === 'pressure' ? 'Pressure' : 'History';
  await page.getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: label, exact: true }).and(page.locator('[aria-current="page"]')).waitFor();
  await page.waitForFunction((tab) => history.state?.dialTab === tab && !history.state?.overlay, tab);
}

async function openSettings(page) {
  await button(page, 'Pressure settings').click();
  const settings = page.getByRole('dialog', { name: 'Preferences & Settings' });
  await settings.waitFor();
  await page.waitForFunction(() => history.state?.overlay && history.state?.dialTab === 'pressure');
  return settings;
}

async function checkRecording(page, complete) {
  await button(page, 'Start recording').click();
  const elapsed = page.getByLabel('Elapsed time', { exact: true });
  await elapsed.waitFor();
  const before = await elapsed.textContent();
  await page.goBack();
  await page.waitForFunction(() => history.state?.shotBackGuard && history.state?.dialTab === 'pressure');
  await page.clock.runFor(2100);
  assert.notEqual(await elapsed.textContent(), before);
  await button(page, 'Stop recording').click();
  const review = page.getByRole('heading', { name: 'Review recording' });
  await review.waitFor();
  await page.goBack();
  await page.waitForFunction(() => history.state?.shotBackGuard && history.state?.dialTab === 'pressure');
  assert.equal(await review.isVisible(), true);
  assert.deepEqual(await rows(page, 'shots'), []);
  await button(page, complete).click();
}

async function checkPressureRoot(browser, viewport) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    await page.goto(previous);
    await page.goto(server.url);
    const choice = page.getByRole('radio', { name: 'Pressure Tracker', exact: true });
    await choice.waitFor();
    const rootLength = await page.evaluate(() => history.length);
    assert.equal(await page.evaluate(() => history.state?.dialTab), undefined);
    if (viewport.width === 412) {
      // Reproduce an old Dial entry left in history before onboarding was completed.
      await page.evaluate(() => history.replaceState({ dialTab: 'dial' }, ''));
    }
    await choice.check();
    await button(page, 'Continue').click();
    await current(page, 'pressure');
    assert.equal(await page.evaluate(() => history.length), rootLength);
    assert.deepEqual(await rows(page, 'settings'), [{ id: 'global', experiencePreference: 'pressure' }]);
    const scale = page.getByRole('combobox', { name: 'Scale transport' });
    assert.equal(await scale.count(), 0);

    let settings = await openSettings(page);
    await button(settings, 'Close settings').click();
    await settings.waitFor({ state: 'hidden' });
    await current(page, 'pressure');
    assert.deepEqual(await rows(page, 'settings'), [{ id: 'global', experiencePreference: 'pressure' }]);

    settings = await openSettings(page);
    await settings.getByRole('combobox').filter({
      has: page.getByRole('option', { name: 'Timemore Black Mirror Dot', exact: true }),
    }).selectOption('timemore-dot');
    await button(settings, 'Save & Close').click();
    await settings.waitFor({ state: 'hidden' });
    await current(page, 'pressure');
    await scale.getByRole('option', { name: 'Simulated', exact: true }).waitFor({ state: 'attached' });
    const configured = [{ id: 'global', experiencePreference: 'pressure', smartScaleDeviceId: 'timemore-dot' }];
    assert.deepEqual(await rows(page, 'settings'), configured);

    await page.reload();
    await current(page, 'pressure');
    await scale.waitFor();
    const reopened = await context.newPage();
    await reopened.goto(server.url);
    await current(reopened, 'pressure');
    await reopened.getByRole('combobox', { name: 'Scale transport' }).waitFor();
    assert.deepEqual(await rows(reopened, 'settings'), configured);
    await reopened.close();

    settings = await openSettings(page);
    await page.goBack();
    await settings.waitFor({ state: 'hidden' });
    await current(page, 'pressure');
    await button(page, 'View shot history').click();
    await current(page, 'history');
    await page.goBack();
    await current(page, 'pressure');
    await page.goForward();
    await current(page, 'history');
    await page.goBack();
    await current(page, 'pressure');
    await page.goBack();
    assert.equal(page.url(), previous);
    await page.goForward();
    await current(page, 'pressure');

    await button(page, 'Enable camera').click();
    await page.clock.install();
    await checkRecording(page, 'Discard recording');
    await page.waitForFunction(() => !history.state?.shotBackGuard);
    await current(page, 'pressure');
    assert.deepEqual(await rows(page, 'shots'), []);
    await page.goBack();
    assert.equal(page.url(), previous);
    await page.goForward();
    await current(page, 'pressure');
    await checkRecording(page, 'Save recording');
    await current(page, 'history');
    assert.equal((await rows(page, 'shots')).length, 1);
    await page.goBack();
    await current(page, 'pressure');
    await page.goBack();
    assert.equal(page.url(), previous);
    console.log(`PASS ${viewport.width}×${viewport.height} Pressure onboarding, Settings, scale persistence, reload, Back/Forward, save and discard`);
  } finally {
    await context.close();
  }
}

let browser;
try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  for (const viewport of [{ width: 320, height: 640 }, { width: 412, height: 915 }]) {
    await checkPressureRoot(browser, viewport);
  }
} finally {
  await browser?.close();
  await server.kill();
}
