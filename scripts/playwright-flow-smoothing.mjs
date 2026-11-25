import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { encodeTimemoreFrame } from '../src/scales/protocols/timemoreFramed.js';
import { flowFixture } from './flow-smoothing-benchmark.mjs';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const baselineDir = process.env.DIALIN_FLOW_BASELINE_DIR;
assert.ok(baselineDir, 'Set DIALIN_FLOW_BASELINE_DIR to the web build of e5de63d (v4.15.8).');
const output = process.env.DIALIN_FLOW_EVIDENCE_DIR ?? path.join(tmpdir(), 'espresso-flow-evidence');
const baseline = startPreviewServer(4223, baselineDir);
const candidate = startPreviewServer(4224);
const events = flowFixture().events.filter(({ tS }) => tS < 8.5 || tS > 9.3);
const bean = { id: 'flow-fixture-bean', name: 'Synthetic test coffee', roastType: 'Medium' };
const shot = {
  id: 'flow-fixture-shot', beanId: bean.id, timestamp: '2026-11-24T10:00:00Z',
  grinderModel: 'Sette 270Wi', setteMacro: 8, setteMicro: 'A', tasteProfile: 'balanced',
  actualDoseG: 18.5, actualYieldG: events.at(-1).weightG, actualTimeS: 14.5,
  notes: 'Synthetic flow comparison fixture',
  // The existing Android History acceptance fixture exercises pressure alignment and gaps.
  labPressureCurve: [{ tS: 0, bar: 0 }, { tS: 0.04, bar: 1 }, { tS: 1.2, bar: 3 }, { tS: 1.24, bar: 5 }],
  scaleFlowCurve: events,
  shotProfileTiming: {
    version: 1, pressureSource: 'camera', scaleSource: 'web-bluetooth', clockDriftMs: 0,
    pressureOriginMs: 0, scaleOriginMs: 0, extractionStartMs: 0, extractionEndMs: 14500, stopMs: 14500,
    scaleInterrupted: false,
  },
};
const reference = { ...shot, id: 'flow-fixture-reference', timestamp: '2026-11-23T10:00:00Z', notes: 'Synthetic reference fixture' };

function updateDisplay(page, visible) {
  const locator = visible ? page.getByTitle('Settings', { exact: true }) : page.getByRole('button', { name: 'Close settings', exact: true });
  return locator.evaluate((button) => button.click());
}

async function setMode(page, current, next) {
  await updateDisplay(page, true);
  const toggle = page.getByRole('switch', { name: 'Smooth flow graphs', exact: true });
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), String(current));
  if (current !== next) {
    await toggle.evaluate((button) => button.click());
    await page.locator(`[role="switch"][aria-label="Smooth flow graphs"][aria-checked="${next}"]`).waitFor();
  }
  await updateDisplay(page, false);
}

async function screenshot(locator, name) {
  await locator.evaluate((element, label) => {
    const note = document.createElement('p');
    note.textContent = `Synthetic test data · ${label.replaceAll('-', ' ')}`;
    note.style.cssText = 'padding:6px 4px;font:600 11px system-ui;color:#d6c6aa;background:#211b15;';
    note.dataset.fixtureLabel = 'true';
    element.prepend(note);
  }, name);
  try {
    await locator.screenshot({
      path: path.join(output, `${name}.png`), animations: 'disabled',
      style: 'nav[aria-label="Main navigation"] { visibility: hidden !important; }',
    });
  } finally {
    await locator.evaluate((element) => element.querySelector('[data-fixture-label]').remove());
  }
}

async function seed(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => document.body.textContent.includes('grinder'));
  await page.evaluate(async ({ bean, shot, reference }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('EspressoDialDB');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['settings', 'beans', 'recipes', 'shots'], 'readwrite');
      tx.objectStore('settings').put({ id: 'global', grinderModel: 'Sette 270Wi', experiencePreference: 'combined',
        darkMode: true, lastSelectedBeanId: bean.id, smartScaleDeviceId: 'timemore-dot', preInfusionEnabled: false,
        shotStartCountdown: 0, scaleFlowAutoStopEnabled: false, anonymousUsageStats: false, shotScreen: { scale: true } });
      tx.objectStore('settings').put({ id: 'history-shot-selections', favouriteIds: [],
        references: [{ beanId: bean.id, shotId: reference.id }] });
      tx.objectStore('beans').put(bean);
      tx.objectStore('recipes').put({ id: 'flow-fixture-recipe', beanId: bean.id, targetDoseG: 18.5,
        targetYieldG: 36, targetTimeMinS: 24, targetTimeMaxS: 28 });
      tx.objectStore('shots').put(shot);
      tx.objectStore('shots').put(reference);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, { bean, shot, reference });
  await page.reload();
}

async function captureSaved(page, label, exportPng = true) {
  const card = page.getByTestId('history-shot-card').filter({ hasText: shot.notes });
  const history = card.getByTestId('history-recorded-chart');
  await history.scrollIntoViewIfNeeded();
  const chart = history.getByRole('group', { name: 'Chart measurement' });
  await chart.getByRole('button', { name: 'Flow', exact: true }).click();
  assert.equal(await chart.getByRole('button', { name: 'Flow', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await history.getByTestId('history-flow-axis-label').textContent(), 'g/s');
  await chart.getByRole('button', { name: 'Combined', exact: true }).click();
  await history.getByText('Flow (g/s) · left').waitFor();
  await history.getByText('Pressure (bar) · right').waitFor();
  const flow = await history.getByTestId('history-flow').getAttribute('d');
  const pressure = await history.getByTestId('history-measured-pressure').getAttribute('d');
  assert.ok(flow.match(/M/g).length >= 2, 'History preserves the scale gap');
  await screenshot(history, `history-${label}`);
  if (!exportPng) return { flow, pressure };

  const profile = card.getByTestId('history-shot-profile');
  if (!await profile.evaluate((element) => element.open)) await profile.locator('summary').first().click();
  const advancedSection = profile.getByText('Advanced pressure and flow', { exact: true });
  if (!await advancedSection.locator('..').evaluate((element) => element.open)) await advancedSection.click();
  const advanced = profile.getByTestId('pressure-flow-analytics');
  const advancedFlow = await advanced.getByTestId('history-flow').getAttribute('d');
  const advancedPressure = await advanced.locator('svg circle[fill="#c97868"]').evaluateAll((points) =>
    points.map((point) => point.outerHTML));
  assert.ok(advancedPressure.length > 0, 'Advanced displays the existing pressure observations');
  assert.ok(advancedFlow.match(/M/g).length >= 2, 'Advanced preserves the scale gap');
  await screenshot(advanced.getByTestId('scale-flow-chart'), `advanced-${label}`);
  const compare = profile.getByText('Compare with bean reference', { exact: true });
  if (!await compare.locator('..').evaluate((element) => element.open)) await compare.click();
  const comparison = profile.getByTestId('shot-comparison');
  await comparison.getByRole('button', { name: 'Flow', exact: true }).click();
  const compareFlow = await comparison.getByTestId('comparison-selected-series').locator('path').getAttribute('d');
  assert.ok(compareFlow.match(/M/g).length >= 2, 'Reference comparison preserves the scale gap');
  await card.getByRole('button', { name: 'Share shot', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Share shot' });
  const image = share.getByAltText('Preview of shot card');
  const alert = share.getByRole('alert');
  await image.or(alert).first().waitFor();
  assert.equal(await alert.count(), 0, await alert.allTextContents());
  const preview = await image.evaluate(async (img) => Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())));
  const downloadReady = page.waitForEvent('download');
  await share.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const download = await downloadReady;
  const png = await readFile(await download.path());
  assert.deepEqual(png, Buffer.from(preview), 'The downloaded PNG matches the visible preview byte for byte');
  await download.saveAs(path.join(output, `synthetic-shot-card-${label}.png`));
  const { flow: pngTrace, pressure: pngPressure } = await page.evaluate(() => window.testPngLines);
  assert.ok(pngTrace.length > 5);
  assert.ok(pngPressure.length > 0);
  // The last pressure sample is at 1.24 s on the same 14.5 s axis as flow.
  assert.ok(Math.abs(pngPressure.at(-1)[0] - (165 + 915 * 1.24 / 14.5)) < 0.001);
  assert.ok(Math.abs(pngTrace.at(-1)[0] - 1080) < 0.001);
  await share.getByRole('button', { name: 'Close' }).click();
  await share.waitFor({ state: 'hidden' });
  return { flow, pressure, advancedFlow, advancedPressure, compareFlow, pngTrace, pngPressure };
}

async function captureLive(page, testToggle) {
  await page.getByRole('button', { name: 'Dial', exact: true }).click();
  await page.getByRole('button', { name: 'Connect scale', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
  await page.clock.install({ time: new Date('2026-11-26T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-26T10:00:01Z'));
  await page.getByRole('button', { name: 'Start', exact: true }).evaluate((button) => button.click());
  await page.clock.runFor(250);
  const stop = page.getByRole('button', { name: 'Stop shot', exact: true });
  await stop.waitFor();
  const live = page.getByTestId('live-shot-chart').filter({ hasText: 'Flow' });
  await live.waitFor();
  let previousMs = 0;
  for (const { tS, weightG } of events) {
    const ms = Math.round(tS * 1000);
    if (ms > previousMs) await page.clock.runFor(ms - previousMs);
    previousMs = ms;
    const payload = new DataView(new ArrayBuffer(4));
    payload.setInt32(0, Math.round(weightG * 10));
    await page.evaluate((bytes) => window.scaleNotify(bytes), [...encodeTimemoreFrame(2, 1, new Uint8Array(payload.buffer))]);
  }
  const pathFor = () => live.locator('path[stroke="#63c5b6"], path[stroke="#e0a660"]').getAttribute('d');
  const smoothPath = await pathFor();
  assert.ok(smoothPath.match(/M/g).length >= 2, 'Live flow preserves the scale gap');
  assert.match(await live.textContent(), /g\/s/);
  await screenshot(live, testToggle ? 'live-on' : 'live-v4.15.8');
  if (!testToggle) return;

  const calls = await page.evaluate(() => window.testScaleCalls);
  await setMode(page, true, false);
  assert.notEqual(await pathFor(), smoothPath);
  assert.ok((await pathFor()).match(/M/g).length >= 2);
  assert.ok(await stop.isVisible(), 'Changing presentation keeps the shot running');
  assert.deepEqual(await page.evaluate(() => window.testScaleCalls), calls, 'The toggle sends no BLE commands');
  await screenshot(live, 'live-off');
  await setMode(page, false, true);
  assert.equal(await pathFor(), smoothPath, 'Switching back retains the full live display history');
  await page.clock.runFor(501);
  const rate = page.locator('[data-testid="adaptive-shot-screen"] [data-metric="flow"] .shot-metric-value');
  assert.match(await rate.textContent(), /—/, 'The readout expires when notifications stop');
}

let browser;
try {
  await mkdir(output, { recursive: true });
  await Promise.all([waitForServer(baseline.url), waitForServer(candidate.url)]);
  browser = await chromium.launch();
  for (const [server, isCandidate] of [[baseline, false], [candidate, true]]) {
    const context = await browser.newContext({ viewport: { width: 320, height: 720 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const device = new EventTarget();
      const notifications = new EventTarget();
      const calls = window.testScaleCalls = { connections: 0, commands: 0 };
      notifications.startNotifications = async () => {};
      notifications.stopNotifications = async () => {};
      const writer = { writeValueWithoutResponse: async () => { calls.commands++; } };
      device.gatt = {
        async connect() { calls.connections++; this.connected = true; return this; },
        async getPrimaryService(uuid) {
          if (!String(uuid).includes('fff0')) throw new Error('No battery service');
          return { getCharacteristic: async (id) => id.includes('fff1') ? notifications : writer };
        },
        disconnect() { this.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); },
      };
      Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => device } });
      window.scaleNotify = (bytes) => {
        notifications.value = new DataView(Uint8Array.from(bytes).buffer);
        notifications.dispatchEvent(new Event('characteristicvaluechanged'));
      };
      window.testPngLines = { flow: [], pressure: [] };
      const { lineTo } = CanvasRenderingContext2D.prototype;
      CanvasRenderingContext2D.prototype.lineTo = function (x, y) {
        if (this.strokeStyle === '#63c5b6') window.testPngLines.flow.push([x, y]);
        if (this.strokeStyle === '#c97868') window.testPngLines.pressure.push([x, y]);
        return lineTo.call(this, x, y);
      };
    });
    await seed(page, server.url);
    await page.getByRole('button', { name: 'History', exact: true }).click();
    if (isCandidate) {
      await setMode(page, true, true);
      const on = await captureSaved(page, 'on');
      await setMode(page, true, false);
      await page.evaluate(() => { window.testPngLines = { flow: [], pressure: [] }; });
      const off = await captureSaved(page, 'off');
      for (const key of ['flow', 'advancedFlow', 'compareFlow', 'pngTrace']) assert.notDeepEqual(on[key], off[key], key);
      for (const key of ['pressure', 'advancedPressure', 'pngPressure']) assert.deepEqual(on[key], off[key], key);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
      const record = await page.evaluate((id) => new Promise((resolve, reject) => {
        const db = indexedDB.open('EspressoDialDB');
        db.onerror = () => reject(db.error);
        db.onsuccess = () => {
          const read = db.result.transaction('shots').objectStore('shots').get(id);
          read.onsuccess = () => { db.result.close(); resolve(read.result); };
          read.onerror = () => reject(read.error);
        };
      }), shot.id);
      assert.deepEqual(record, shot, 'The preference leaves the saved shot record intact');
      await page.reload();
      await setMode(page, false, true);
      console.log('PASS default-ON, persisted OFF, History Flow and Combined, Advanced, reference comparison, PNG and unchanged saved data at 320 px');
    } else {
      await captureSaved(page, 'v4.15.8', false);
    }
    await captureLive(page, isCandidate);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS identical synthetic live inputs, missing-notification gaps, live toggle, readout expiry and no BLE commands on toggle');
  console.log(output);
} finally {
  await browser?.close();
  await Promise.all([baseline.kill(), candidate.kill()]);
}
