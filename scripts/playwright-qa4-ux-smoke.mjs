import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

// Use a build with VITE_ENABLE_PRESSURE_LAB and VITE_PRESSURE_ALLOW_SIM enabled.
const USER_NOTE = 'QA4 unrelated shot';

async function readShots(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('shots').objectStore('shots').getAll();
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }));
}

function assertDisjoint(left, right) {
  assert.ok(left.x + left.width <= right.x || right.x + right.width <= left.x
    || left.y + left.height <= right.y || right.y + right.height <= left.y);
}
async function seedPolishSmoke(page, { settings = {}, secondBean = false } = {}) {
  await page.getByRole('radio', { name: 'Brew & Dial-In', exact: true }).waitFor();
  await page.evaluate(({ note, settings, secondBean }) => {
    return new Promise((resolve, reject) => {
      const stores = ['settings', 'beans', 'recipes', 'shots'];
      const req = indexedDB.open('EspressoDialDB');
      req.onupgradeneeded = () => {
        req.transaction.abort();
        reject(new Error('QA-4 fixture: the app did not initialize EspressoDialDB'));
      };
      req.onsuccess = () => {
        const idb = req.result;
        const missing = stores.filter((store) => !idb.objectStoreNames.contains(store));
        if (missing.length) {
          idb.close();
          reject(new Error(`QA-4 fixture: EspressoDialDB is missing stores: ${missing.join(', ')}`));
          return;
        }
        const tx = idb.transaction(stores, 'readwrite');
        tx.oncomplete = () => { idb.close(); resolve(); };
        tx.onabort = () => {
          idb.close();
          reject(tx.error ?? new Error('QA-4 fixture: seed transaction aborted'));
        };
        tx.objectStore('settings').put({
          id: 'global',
          grinderModel: 'Sette 270Wi',
          flairEnabled: false, brewGuideEnabled: true, brewGuideIntroSeen: true, brewGuideSetupComplete: true, brewGuideGuidanceMode: 'quick',
          lastSelectedBeanId: 'smoke-bean',
          ...settings,
        });
        tx.objectStore('beans').put({
          id: 'smoke-bean',
          name: 'Smoke',
          roaster: '',
          roastType: 'Dark',
          roastDate: '2026-10-01',
          storageType: 'frozen',
          thawHistory: [{ thawDate: '2026-10-08' }],
          isFinished: false,
          createdAt: '2026-10-01T00:00:00.000Z',
        });
        tx.objectStore('recipes').put({
          id: 'smoke-recipe',
          beanId: 'smoke-bean',
          targetTimeMinS: 27,
          targetTimeMaxS: 32,
          targetDoseG: 18.5,
          targetYieldG: 30,
          brewTemperatureC: 93,
        });
        if (secondBean) {
          tx.objectStore('beans').put({ id: 'other-bean', name: 'Other coffee', roastType: 'Medium' });
          tx.objectStore('recipes').put({
            id: 'other-recipe', beanId: 'other-bean', targetDoseG: 20, targetYieldG: 42,
            targetTimeMinS: 24, targetTimeMaxS: 28, brewTemperatureC: 92,
          });
        }
        tx.objectStore('shots').put({
          id: 'smoke-shot-learning',
          beanId: 'smoke-bean',
          timestamp: '2026-10-14T11:00:00.000Z',
          grinderModel: 'Sette 270Wi',
          setteMacro: 7,
          setteMicro: 'C',
          actualTimeS: 12,
          tasteProfile: 'balanced',
          actualDoseG: 18,
          actualYieldG: 36,
          wasPurged: true,
        });
        tx.objectStore('shots').put({
          id: 'smoke-shot-latest',
          beanId: 'smoke-bean',
          timestamp: '2026-10-14T12:00:00.000Z',
          grinderModel: 'Sette 270Wi',
          setteMacro: 7,
          setteMicro: 'C',
          actualTimeS: 30,
          tasteProfile: 'balanced',
          actualDoseG: 18,
          actualYieldG: 36,
          wasPurged: true,
          notes: note,
          excludeFromLearning: true,
          knownIssueReason: 'puck_prep',
        });
      };
      req.onerror = () => reject(req.error);
    });
  }, { note: USER_NOTE, settings, secondBean });
}

function readSettings(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const get = db.transaction('settings').objectStore('settings').get('global');
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
  }));
}

async function placeholderContrast(input) {
  return input.evaluate(async (element) => {
    const luminance = (color) => {
      const rgb = color.match(/[\d.]+/g).slice(0, 3).map((value) => Number(value) / 255);
      return rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
    };
    const tile = element.closest('[data-testid]');
    // Measure the settled theme colors after the card's background transition.
    await Promise.allSettled(tile.getAnimations().map((animation) => animation.finished));
    const placeholder = getComputedStyle(element, '::placeholder');
    const background = getComputedStyle(tile).backgroundColor;
    const levels = [luminance(placeholder.color), luminance(background)].sort((a, b) => b - a);
    return { foreground: placeholder.color, background, ratio: (levels[0] + 0.05) / (levels[1] + 0.05) };
  });
}

async function verifySeededDial(page) {
  const bean = page.getByTestId('dial-bean-select');
  await bean.locator('option[value="smoke-bean"]').waitFor({ state: 'attached' });
  assert.equal(await bean.inputValue(), 'smoke-bean');
  assert.deepEqual((await readShots(page)).map(({ id }) => id).sort(), ['smoke-shot-latest', 'smoke-shot-learning']);
}
async function checkRootShot(browser, url, previousUrl) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    const setup = await context.newPage();
    await setup.goto(url);
    await seedPolishSmoke(setup);
    await setup.close();
    const page = await context.newPage();
    if (previousUrl) await page.goto(previousUrl);
    await page.goto(url);
    await verifySeededDial(page);
    assert.equal(await page.evaluate(() => history.state?.dialTab), 'dial');
    const button = (name) => page.getByRole('button', { name, exact: true });
    await button('Start').click();
    const timer = '[data-testid="adaptive-shot-screen"] [data-metric="time"] .shot-metric-value';
    await page.waitForFunction((selector) => Number.parseFloat(document.querySelector(selector)?.textContent) >= 1, timer);
    const beforeBack = Number.parseFloat(await page.locator(timer).textContent());
    for (let i = 0; i < 2; i++) {
      await page.goBack();
      assert.equal(page.url(), url, 'Back during a root shot must stay in the app');
      await button('Stop shot').waitFor();
    }
    await page.waitForFunction(({ timer, beforeBack }) => Number.parseFloat(document.querySelector(timer)?.textContent) > beforeBack, { timer, beforeBack });
    await button('Stop shot').click();
    const time = page.getByTestId('dial-time-tile').locator('input');
    const seconds = Number(await time.inputValue());
    assert.ok(seconds > 0);
    await page.goBack();
    assert.equal(page.url(), url);
    assert.equal(Number(await time.inputValue()), seconds);
    await page.locator('label').filter({ hasText: /^Dose \(g\)$/ }).locator('..').locator('input').fill('18.5');
    await page.getByTestId('dial-yield-tile').locator('input').fill('37');
    await button('Balanced').click();
    await button('Log shot & calculate grind adjustment').click();
    await page.getByTestId('saved-share-shot').waitFor();
    const shots = await readShots(page);
    const saved = shots.filter(({ id }) => !id.startsWith('smoke-shot-'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].beanId, 'smoke-bean');
    assert.equal(saved[0].actualTimeS, seconds);
    assert.equal(saved[0].actualDoseG, 18.5);
    assert.equal(saved[0].actualYieldG, 37);
    await page.waitForFunction(() => !history.state?.shotBackGuard);
    await page.goBack();
    if (previousUrl) assert.equal(page.url(), previousUrl);
    else assert.ok([url, 'about:blank'].includes(page.url()));
    console.log(`PASS root shot survives repeated Back, stops and saves, and releases Back (${previousUrl ? 'external page' : 'direct entry'})`);
  } finally {
    await context.close();
  }
}

async function checkSettingsAndCustomGrind(browser, url) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    await page.goto(url);
    await seedPolishSmoke(page, { secondBean: true, settings: { experiencePreference: 'brew' } });
    await page.reload();
    await verifySeededDial(page);
    const settings = page.getByRole('dialog', { name: 'Preferences & Settings' });
    const open = () => page.getByTitle('Settings', { exact: true }).click();
    const close = settings.getByLabel('Close settings');
    await open();
    assert.equal(await close.textContent(), 'Done');
    await settings.getByRole('button', { name: 'Dark', exact: true }).click();
    await close.click();
    await page.reload();
    await verifySeededDial(page);
    assert.equal((await readSettings(page)).darkMode, false);
    await open();
    await settings.getByRole('radio', { name: 'Combined', exact: true }).check();
    assert.equal(await close.textContent(), 'Close');
    await close.click();
    assert.equal((await readSettings(page)).experiencePreference, 'brew');
    await open();
    await settings.getByRole('radio', { name: 'Combined', exact: true }).check();
    await settings.getByRole('button', { name: 'Save & Close', exact: true }).click();
    await settings.waitFor({ state: 'hidden' });
    assert.equal((await readSettings(page)).experiencePreference, 'combined');

    await open();
    await settings.getByText('Primary grinder', { exact: true }).locator('..').locator('select').first()
      .selectOption('__custom_grinder__');
    const grinderName = settings.getByPlaceholder('e.g. DF64', { exact: true });
    await grinderName.fill('QA4 custom');
    assert.equal(await close.textContent(), 'Close');
    await close.click();
    // Current main auto-writes a valid custom draft. QA-3 will make save explicit.
    assert.equal((await readSettings(page)).customGrinderSetupDraft.name, 'QA4 custom');
    await open();
    assert.equal(await grinderName.inputValue(), 'QA4 custom');
    await settings.getByRole('button', { name: 'Save custom grinder', exact: true }).click();
    await close.click();
    assert.equal((await readSettings(page)).customGrinder.name, 'QA4 custom');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const guide = () => nav.getByRole('button', { name: 'Brew Guide', exact: true }).click();
    const dial = () => nav.getByRole('button', { name: 'Dial', exact: true }).click();
    await guide();
    await page.getByText('QA4 custom', { exact: true }).waitFor();
    await page.getByText('18.5g → 30g', { exact: true }).waitFor();
    const currentGrind = page.getByText('Current grind', { exact: true });
    await currentGrind.waitFor();
    await dial();
    await page.getByTestId('dial-bean-select').selectOption('other-bean');
    await page.getByText('42g', { exact: true }).first().waitFor();
    const beforeGuide = await readSettings(page);
    await guide();
    await page.getByText('Other coffee', { exact: true }).waitFor();
    await page.getByText('20g → 42g', { exact: true }).waitFor();
    await currentGrind.waitFor();
    assert.deepEqual(await readSettings(page), beforeGuide);
    await page.reload();
    await page.getByText('20g → 42g', { exact: true }).waitFor();
    await currentGrind.waitFor();
    console.log('PASS Settings persistence and custom grind guidance across bean recipes and reload');
  } finally {
    await page.close();
  }
}

async function checkStandalonePressureBack(browser, url) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    const setup = await context.newPage();
    await setup.goto(url);
    await seedPolishSmoke(setup, { settings: { experiencePreference: 'pressure', labCameraPressureEnabled: true } });
    await setup.close();
    const page = await context.newPage();
    const previousUrl = 'data:text/html,Before%20Pressure%20Tracker';
    await page.goto(previousUrl);
    await page.goto(url);
    await page.getByText('Simulated pressure preview', { exact: true }).waitFor();
    const button = (name) => page.getByRole('button', { name, exact: true });
    await button('Start recording').click();
    const elapsed = page.getByLabel('Elapsed time', { exact: true });
    await elapsed.waitFor();
    const beforeBack = await elapsed.textContent();
    await page.goBack();
    assert.equal(page.url(), url);
    await page.waitForFunction((before) => document.querySelector('[aria-label="Elapsed time"]')?.textContent !== before, beforeBack);
    await button('Stop recording').click();
    await button('Discard recording').waitFor();
    await page.goBack();
    assert.equal(page.url(), url);
    await button('Discard recording').click();
    await page.waitForFunction(() => !history.state?.shotBackGuard);
    assert.equal((await readShots(page)).length, 2);
    await page.goBack();
    assert.equal(page.url(), previousUrl);
    console.log('PASS standalone pressure recording and review survive Back; discard restores idle Back (simulated camera)');
  } finally {
    await context.close();
  }
}

const server = startPreviewServer(4191);
let browser;
try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  await checkRootShot(browser, server.url, 'data:text/html,Previous%20page');
  await checkRootShot(browser, server.url);
  await checkStandalonePressureBack(browser, server.url);
  await checkSettingsAndCustomGrind(browser, server.url);
  for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, serviceWorkers: 'block' });
    await page.goto(server.url); await seedPolishSmoke(page); await page.reload();
    await verifySeededDial(page);
    const tab = (name) => page.getByRole('button', { name, exact: true });
    const active = async (name) => page.waitForFunction((label) => [...document.querySelectorAll('nav[aria-label="Main navigation"] button')].some((b) => b.textContent.trim().toLowerCase() === label.toLowerCase() && b.getAttribute('aria-current') === 'page'), name);
    const size = async (locator) => {
      const r = await locator.boundingBox();
      assert.ok(r.width >= 44 && r.height >= 44, JSON.stringify(r));
      return r;
    };
    await size(page.getByTestId('dial-bean-select'));
    await page.getByTitle('Settings').click(); await size(page.getByLabel('Close settings'));
    assert.equal(await page.getByLabel('Close settings').textContent(), 'Done');
    await page.goBack(); await page.getByRole('dialog', { name: 'Preferences & Settings' }).waitFor({ state: 'hidden' }); await active('Dial');
    await tab('History').click(); await active('History'); await size(page.getByLabel('Delete shot').first());
    const shotCard = page.getByTestId('history-shot-card').first();
    assertDisjoint(await shotCard.getByLabel('Delete shot').boundingBox(),
      await shotCard.getByRole('button', { name: /Include again|Mark as known issue/ }).boundingBox());
    await page.goBack(); await active('Dial'); await page.goForward(); await active('History');
    await tab('Beans').click(); await tab('Stats').click(); await active('Stats');
    const stats = [];
    for (const name of ['Timeline', 'Dose/Time', 'Taste']) stats.push(await size(tab(name)));
    assertDisjoint(stats[0], stats[1]);
    assertDisjoint(stats[1], stats[2]);
    await page.goBack(); await active('Beans'); await page.goBack(); await active('History'); await page.goBack(); await active('Dial');
    await tab('History').click(); await page.reload(); await active('History');
    await tab('Dial').click();
    await page.getByText('Suggested:', { exact: false }).first().waitFor();
    await page.waitForTimeout(500);
    const getSettings = () => readSettings(page);
    const beforeGuide = await getSettings();
    await tab('Brew Guide').click(); await page.getByText('Suggested grind (not applied)', { exact: false }).waitFor();
    await tab('Dial').click(); await page.waitForTimeout(200);
    assert.deepEqual(await getSettings(), beforeGuide);
    await tab('Apply rec').click();
    await tab('Brew Guide').click();
    await page.getByText('Current grind', { exact: true }).waitFor();
    assert.equal(await page.getByText('Suggested grind (not applied)', { exact: false }).count(), 0);
    await page.reload();
    await active('Brew Guide');
    await page.getByText('Current grind', { exact: true }).waitFor();
    assert.equal(await page.getByText('Suggested grind (not applied)', { exact: false }).count(), 0);
    await tab('Dial').click();
    const yieldInput = page.getByTestId('dial-yield-tile').locator('input');
    const timeInput = page.getByTestId('dial-time-tile').locator('input');
    assert.equal(await yieldInput.inputValue(), ''); assert.equal(await timeInput.inputValue(), '');
    for (const theme of ['dark', 'light']) {
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
      const samples = await Promise.all([yieldInput, timeInput].map(placeholderContrast));
      assert.ok(samples.every(({ ratio }) => ratio >= 4.5), `${theme} placeholder contrast: ${JSON.stringify(samples)}`);
      console.log(`PASS ${theme} placeholder contrast: ${samples.map(({ ratio }) => ratio.toFixed(2)).join(', ')}`);
      await page.getByTitle('Settings', { exact: true }).click();
      await tab(theme === 'dark' ? 'Dark' : 'Light').click();
      await page.getByLabel('Close settings').click();
    }
    const beforeBlankSubmit = await readShots(page);
    await tab('Log shot & calculate grind adjustment').click();
    await page.getByText(/(?:yield|time).*required/i).first().waitFor();
    assert.deepEqual(await readShots(page), beforeBlankSubmit);
    await tab('History').click(); await tab('Dial').click();
    await tab('Start').click();
    const liveShot = page.getByTestId('adaptive-shot-screen'); await liveShot.waitFor();
    await page.goBack(); await page.waitForTimeout(1200); await active('Dial');
    assert.equal(await liveShot.isVisible(), true);
    assert.equal(await page.evaluate(() => history.state.dialTab), 'dial');
    await page.getByRole('button', { name: 'Stop shot', exact: true }).click();
    const recordedTime = await page.getByTestId('dial-time-tile').locator('input').inputValue();
    assert.ok(Number(recordedTime) > 0);
    assert.equal(await yieldInput.inputValue(), ''); assert.notEqual(await timeInput.inputValue(), '');
    assert.equal(await yieldInput.getAttribute('placeholder'), 'e.g. 36'); assert.equal(await timeInput.getAttribute('placeholder'), 'e.g. 28');
    await yieldInput.fill('36'); await timeInput.fill('28'); await tab('Balanced').click();
    await tab('Log shot & calculate grind adjustment').click();
    const notice = page.getByTestId('saved-share-shot'); await notice.waitFor();
    const saved = (await readShots(page)).find(({ id }) => !id.startsWith('smoke-shot-'));
    await notice.click();
    const shareDialog = page.getByRole('dialog', { name: 'Share shot' });
    await shareDialog.waitFor();
    const download = page.waitForEvent('download');
    await shareDialog.getByRole('button', { name: 'Share', exact: true }).click();
    const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'));
    assert.equal(exported.shotId, saved.id);
    await shareDialog.getByRole('button', { name: 'Done', exact: true }).click();
    page.on('dialog', (dialog) => dialog.accept());
    await tab('History').click();
    await page.getByTestId('history-shot-card').filter({ hasText: USER_NOTE }).getByLabel('Delete shot').click();
    await page.getByTestId('history-shot-card').filter({ hasText: USER_NOTE }).waitFor({ state: 'hidden' });
    assert.equal(await notice.isVisible(), true);
    await page.getByTestId('history-shot-card').first().getByLabel('Delete shot').click();
    await notice.waitFor({ state: 'hidden' });
    await tab('Dial').click(); await yieldInput.fill('35'); await timeInput.fill('29'); await tab('Balanced').click();
    await tab('Log shot & calculate grind adjustment').click(); await notice.waitFor();
    await tab('Beans').click(); await page.getByTitle('Delete Bean Profile').click();
    await page.getByTestId('bean-row-active').waitFor({ state: 'hidden' });
    await tab('History').click(); await notice.waitFor({ state: 'hidden' });
    await page.close();
    console.log(`PASS navigation, touch sizes, placeholders and shot notice ${viewport.width}x${viewport.height}`);
  }
} finally { await browser?.close(); await server.kill(); }
