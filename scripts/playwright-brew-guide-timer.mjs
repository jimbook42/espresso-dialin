import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const server = startPreviewServer(4189);
let browser;
let failures = 0;

async function seed(page, shotStartCountdown, smartScaleDeviceId) {
  await page.goto(server.url);
  await page.waitForFunction(() => document.body.textContent.includes('grinder'));
  await page.evaluate(async ({ shotStartCountdown, smartScaleDeviceId }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('EspressoDialDB');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['settings', 'beans', 'recipes'], 'readwrite');
      tx.objectStore('settings').put({
        id: 'global', grinderModel: 'Sette 270Wi', lastSelectedBeanId: 'brew-test-bean',
        experiencePreference: 'combined', smartScaleDeviceId,
        brewGuideEnabled: true, brewGuideSetupComplete: true, brewGuidanceMode: 'full',
        preInfusionEnabled: false, shotStartCountdown,
      });
      tx.objectStore('beans').put({ id: 'brew-test-bean', name: 'Timer test coffee', roastType: 'Medium' });
      tx.objectStore('recipes').put({
        id: 'brew-test-recipe', beanId: 'brew-test-bean', targetTimeMinS: 27, targetTimeMaxS: 32,
        targetDoseG: 18, targetYieldG: 36,
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { shotStartCountdown, smartScaleDeviceId });
  await page.reload();
}

async function mockScale(page, bookoo) {
  await page.addInitScript((bookoo) => {
    const device = new EventTarget();
    const notifications = new EventTarget();
    notifications.startNotifications = async () => {};
    const scale = { starts: 0, stops: 0 };
    window.testScale = scale;
    const writer = {
      async writeValueWithoutResponse(bytes) {
        const isTimerFrame = bytes[2] === 3 && bytes[3] === 2;
        if (bookoo ? bytes[2] === 7 : isTimerFrame && bytes[6] === 1) {
          scale.starts++;
          await new Promise((resolve, reject) => {
            scale.finishStart = resolve;
            scale.rejectStart = () => reject(new Error('Test scale start rejected'));
          });
        }
        if (bookoo ? bytes[2] === 5 : isTimerFrame && bytes[6] === 2) scale.stops++;
      },
    };
    device.gatt = {
      async connect() { this.connected = true; return this; },
      async getPrimaryService(uuid) {
        if (!uuid.includes(bookoo ? '0ffe' : 'fff0')) throw new Error('No battery service');
        return { getCharacteristic: async (id) => id.includes(bookoo ? 'ff11' : 'fff1') ? notifications : writer };
      },
    };
    Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => device } });
  }, bookoo);
}

async function run(name, check, { connected = false, countdown = 'off', bookoo = false } = {}) {
  if (process.argv[2] && !name.includes(process.argv[2])) return;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(5000);
  const button = (name) => page.getByRole('button', { name, exact: true });
  const start = button('Start timer');
  const advance = async () => {
    for (let step = 0; step < 20 && !(await start.isVisible()); step++) await button('Done').click();
    await start.waitFor();
  };
  try {
    if (connected) await mockScale(page, bookoo);
    await seed(page, countdown, bookoo ? 'bookoo-themis' : 'timemore-dot');
    if (connected) {
      await button('Connect scale').click();
      await button('Disconnect').waitFor();
    }
    await button('Brew Guide').click();
    await button('Start brew').click();
    await advance();
    await page.clock.install();
    await check({ page, button, start, advance });
    assert.deepEqual(errors, []);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}`, error);
  } finally {
    await page.close();
  }
}

async function verifyRunningAndDone({ page, button }) {
  const stop = button('Stop timer');
  await stop.waitFor();
  assert.equal(await button('Done').isDisabled(), true);
  const time = page.locator('[data-testid="adaptive-shot-screen"] [data-metric="time"] .shot-metric-value');
  const first = Number.parseFloat(await time.textContent());
  await page.clock.runFor(2200);
  assert.ok(Number.parseFloat(await time.textContent()) > first + 1, 'displayed shot time must advance');
  await stop.click();
  await button('Done').and(page.locator('button:enabled')).waitFor();
  await button('Done').click();
  await page.getByRole('spinbutton', { name: 'Actual yield in grams' }).waitFor();
}

async function waitForScaleStart(page, count = 1) {
  await page.waitForFunction((count) => window.testScale.starts === count, count);
}

async function completeCountdown(page, verifyTick = async () => {}) {
  const ready = page.getByText('Get ready', { exact: true });
  for (const second of ['3', '2', '1']) {
    await ready.locator('..').getByText(second, { exact: true }).waitFor();
    await verifyTick();
    await page.clock.runFor(1000);
  }
  await ready.waitFor({ state: 'hidden' });
}

async function verifyCancelledScaleStart(page) {
  const priorStops = await page.evaluate(() => window.testScale.stops);
  await page.evaluate(() => window.testScale.finishStart());
  await page.waitForFunction((priorStops) => window.testScale.stops > priorStops, priorStops);
  await page.clock.runFor(1500);
  assert.equal(await page.getByTestId('adaptive-shot-screen').count(), 0, 'cancelled startup left a live shot screen');
}

try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  await run('Countdown Off with delayed scale start', async (view) => {
    const { page, start } = view;
    await start.click();
    await waitForScaleStart(page);
    const stayedPending = await start.isDisabled();
    assert.equal(await view.button('Done').isDisabled(), true);
    assert.equal(await page.getByText('0:00.0', { exact: true }).isVisible(), true);
    await page.evaluate(() => window.testScale.finishStart());
    await page.clock.runFor(500);
    assert.deepEqual(
      { stayedPending, stopVisible: await view.button('Stop timer').isVisible() },
      { stayedPending: true, stopVisible: true },
      'Brew Guide must stay pending through the BLE write and offer Stop after it completes',
    );
    await verifyRunningAndDone(view);
  }, { connected: true });

  await run('Countdown Off without a connected scale', async (view) => {
    await view.start.click();
    await verifyRunningAndDone(view);
  });

  await run('Countdown Off with a rejected scale start', async (view) => {
    await view.start.click();
    await waitForScaleStart(view.page);
    assert.equal(await view.start.isDisabled(), true);
    // The Bookoo transport propagates a rejected start write through notifyShotStarted.
    await view.page.evaluate(() => window.testScale.rejectStart());
    await verifyRunningAndDone(view);
  }, { connected: true, bookoo: true });

  await run('Countdown On completes 3-2-1 and hands off to a delayed scale', async (view) => {
    const { page, start } = view;
    await start.click();
    await completeCountdown(page, async () => {
      assert.equal(await page.evaluate(() => window.testScale.starts), 0);
    });
    await waitForScaleStart(page);
    assert.equal(await start.isDisabled(), true);
    await page.evaluate(() => window.testScale.finishStart());
    await verifyRunningAndDone(view);
  }, { connected: true, countdown: 'on' });

  await run('Countdown On can be cancelled and restarted', async (view) => {
    const { page, button, start } = view;
    await start.click();
    await button('Cancel').click();
    await start.and(page.locator('button:enabled')).waitFor();
    await page.clock.runFor(4000);
    assert.equal(await start.isEnabled(), true);
    assert.equal(await button('Stop timer').isVisible(), false);
    assert.equal(await button('Done').isDisabled(), true);
    await start.click();
    await completeCountdown(page);
    await verifyRunningAndDone(view);
  }, { countdown: 'on' });

  await run('Repeated Start taps send one scale start', async (view) => {
    const { page, start } = view;
    await start.evaluate((button) => { button.click(); button.click(); });
    await waitForScaleStart(page);
    assert.equal(await start.isDisabled(), true);
    await start.evaluate((button) => button.click());
    await page.evaluate(() => window.testScale.finishStart());
    await verifyRunningAndDone(view);
    assert.equal(await page.evaluate(() => window.testScale.starts), 1);
  }, { connected: true });

  await run('Reset while startup is pending prevents a late start', async (view) => {
    const { page, button, start } = view;
    await start.click();
    await waitForScaleStart(page);
    await button('Reset').click();
    await start.and(page.locator('button:enabled')).waitFor();
    assert.equal(await button('Done').isDisabled(), true);
    await verifyCancelledScaleStart(page);
    await start.click();
    await waitForScaleStart(page, 2);
    await page.evaluate(() => window.testScale.finishStart());
    await verifyRunningAndDone(view);
  }, { connected: true });

  await run('Back during startup cancels the pending timer step', async (view) => {
    const { page, button, start, advance } = view;
    await start.click();
    await waitForScaleStart(page);
    await button('Back').click();
    await verifyCancelledScaleStart(page);
    await advance();
    assert.equal(await start.isEnabled(), true);
    assert.equal(await button('Done').isDisabled(), true);
  }, { connected: true });

  await run('Leaving Brew Guide prevents a late start on Dial', async (view) => {
    const { page, button, start, advance } = view;
    await start.click();
    await waitForScaleStart(page);
    await button('Dial').click();
    await verifyCancelledScaleStart(page);
    assert.equal(await button('Stop shot').isVisible(), false);
    await button('Brew Guide').click();
    await button('Start brew').click();
    await advance();
    assert.equal(await start.isEnabled(), true);
    assert.equal(await button('Done').isDisabled(), true);
  }, { connected: true });
} finally {
  await browser?.close();
  await server.kill();
}
if (failures) process.exitCode = 1;
