import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { encodeTimemoreFrame } from '../src/scales/protocols/timemoreFramed.js';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const server = startPreviewServer(4182);
let browser;
let failures = 0;
const withPressurePreview = process.argv.includes('--pressure-preview');

function readShots(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const db = indexedDB.open('EspressoDialDB');
    db.onerror = () => reject(db.error);
    db.onsuccess = () => {
      const query = db.result.transaction('shots').objectStore('shots').getAll();
      query.onsuccess = () => { db.result.close(); resolve(query.result); };
      query.onerror = () => reject(query.error);
    };
  }));
}

async function readDiagnostics(page) {
  const pending = page.waitForEvent('download');
  await page.getByTestId('history-shot-diagnostics-export').click();
  const download = await pending;
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

async function logShot(page) {
  await page.getByRole('button', { name: 'Balanced', exact: true }).click();
  await page.getByRole('button', { name: 'Log shot & calculate grind adjustment', exact: true }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByTestId('history-shot-card').waitFor();
}

async function seed(page, settings) {
  await page.goto(server.url);
  await page.waitForFunction(() => document.body.textContent.includes('grinder'));
  await page.evaluate(async (settings) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('EspressoDialDB');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['settings', 'beans', 'recipes'], 'readwrite');
      tx.objectStore('settings').put({
        id: 'global', grinderModel: 'Sette 270Wi', lastSelectedBeanId: 'audit-bean',
        experiencePreference: 'combined',
        smartScaleDeviceId: 'timemore-dot', preInfusionEnabled: false, shotStartCountdown: 0,
        ...settings,
      });
      tx.objectStore('beans').put({ id: 'audit-bean', name: 'Timing audit coffee', roastType: 'Medium' });
      tx.objectStore('recipes').put({
        id: 'audit-recipe', beanId: 'audit-bean', targetTimeMinS: 27, targetTimeMaxS: 32,
        targetDoseG: 18, targetYieldG: 36,
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, settings);
  await page.reload();
}

async function run(name, check, { settings = {}, withPlateau = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.addInitScript(() => {
      const device = new EventTarget();
      const notifications = new EventTarget();
      notifications.startNotifications = async () => {};
      notifications.stopNotifications = async () => {};
      window.scaleStopCommands = 0;
      const writer = {
        writeValueWithoutResponse: async (bytes) => {
          if (bytes[3] === 2 && bytes[6] === 2) window.scaleStopCommands++;
        },
      };
      device.gatt = {
        async connect() { this.connected = true; return this; },
        async getPrimaryService(uuid) {
          if (!String(uuid).includes('fff0')) throw new Error('No battery service');
          return { getCharacteristic: async (id) => id.includes('fff1') ? notifications : writer };
        },
        disconnect() {
          this.connected = false;
          device.dispatchEvent(new Event('gattserverdisconnected'));
        },
      };
      Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => device } });
      window.scaleNotify = (bytes) => {
        notifications.value = new DataView(Uint8Array.from(bytes).buffer);
        notifications.dispatchEvent(new Event('characteristicvaluechanged'));
      };
      window.scaleDrop = () => device.gatt.disconnect();
    });
    await seed(page, settings);
    const connect = page.getByRole('button', { name: 'Connect scale', exact: true });
    await connect.click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
    await page.clock.install();
    const start = page.getByRole('button', { name: 'Start', exact: true });
    const stop = page.getByRole('button', { name: 'Stop shot', exact: true });
    const time = page.locator('[data-testid="adaptive-shot-screen"] [data-metric="time"] .shot-metric-value');
    const readTime = async () => Number.parseFloat(await time.textContent());
    const savedTime = async () => Number(await page.getByTestId('dial-time-tile').locator('input').inputValue());
    async function notify(weightG, advanceMs = 100) {
      const payload = new DataView(new ArrayBuffer(4));
      payload.setInt32(0, Math.round(weightG * 10));
      await page.clock.runFor(advanceMs);
      await page.evaluate((bytes) => window.scaleNotify(bytes), [...encodeTimemoreFrame(2, 1, new Uint8Array(payload.buffer))]);
    }
    let candidate;
    if (withPlateau) {
      await start.click();
      await page.clock.runFor(250);
      await stop.waitFor();
      await notify(0);
      await notify(0);
      for (let i = 1; i <= 45; i++) await notify(i * 0.8);
      await page.clock.runFor(100);
      assert.equal(await stop.isVisible(), true, 'reaching the 36 g target alone leaves extraction running');
      const atEnd = await readTime();
      for (let i = 0; i < 5; i++) await notify(36);
      await page.clock.runFor(100);
      candidate = await readTime();
      assert.ok(Math.abs(candidate - atEnd) <= 0.3, 'observed plateau holds the candidate time');
    }
    const result = await check({ page, start, notify, stop, readTime, savedTime, candidate, connect });
    console.log('PASS', name, result ?? '');
  } catch (error) {
    failures++;
    console.error('FAIL', name, error.message);
  } finally {
    await page.close();
  }
}

try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  await run('continuous plateau confirms and saves the backdated time once', async ({ page, notify, stop, savedTime, candidate }) => {
    for (let i = 0; i < 38; i++) await notify(36);
    await stop.waitFor({ state: 'hidden' });
    assert.equal(await savedTime(), Math.round(candidate));
    assert.equal(await page.evaluate(() => window.scaleStopCommands), 1);
    await logShot(page);
    const [shot] = await readShots(page);
    const exported = await readDiagnostics(page);
    assert.equal(exported.shotId, shot.id);
    assert.equal(exported.final.rule, 'plateau');
    assert.equal(exported.final.actualTimeS, shot.actualTimeS);
    assert.ok(exported.final.confirmationMs > exported.final.backdatedEndMs);
    assert.equal(exported.final.displayTimerFrozen, true);
    assert.equal(exported.final.yieldSettlementCompleted, true);
    assert.equal(exported.scaleDiagnostics.gapCount, 0);
    assert.equal(shot.diagnosticsVersion, undefined);
    if (withPressurePreview) {
      assert.equal(exported.pressureSource, 'simulated');
      assert.ok(exported.labPressureCurve.length > 0);
      assert.ok(Number.isFinite(exported.timeline.pressureOffsetMs));
    }
    if (process.env.B06_SIMULATED_DIAGNOSTICS_EXAMPLE) {
      await writeFile(process.env.B06_SIMULATED_DIAGNOSTICS_EXAMPLE, JSON.stringify(exported, null, 2));
    }
    return { candidate, ...exported.final };
  }, { settings: { labCameraPressureEnabled: withPressurePreview } });
  await run('missing notifications release the frozen display', async ({ page, stop, readTime, candidate }) => {
    await page.clock.runFor(750);
    await page.waitForFunction((before) => {
      const timer = document.querySelector('[data-testid="adaptive-shot-screen"] [data-metric="time"] .shot-metric-value');
      return Number.parseFloat(timer?.textContent) > before;
    }, candidate, { timeout: 1500 });
    await page.clock.runFor(1250);
    await page.waitForFunction((before) => {
      const timer = document.querySelector('[data-testid="adaptive-shot-screen"] [data-metric="time"] .shot-metric-value');
      return Number.parseFloat(timer?.textContent) >= before + 2;
    }, candidate, { timeout: 1500 });
    assert.equal(await stop.isVisible(), true, 'silence never confirms a stop');
    const elapsed = await readTime();
    assert.ok(elapsed >= candidate + 2, `candidate ${candidate}s, elapsed ${elapsed}s after 2s of silence`);
    return { candidate, elapsed };
  });
  await run('manual Stop during pending confirmation saves the tap time once', async ({ page, notify, stop, savedTime, candidate }) => {
    for (let i = 0; i < 10; i++) await notify(36);
    await stop.evaluate((button) => { button.click(); button.click(); });
    for (let i = 0; i < 28; i++) await notify(36);
    const saved = await savedTime();
    assert.ok(saved >= Math.round(candidate + 1.5), `candidate ${candidate}s, saved ${saved}s after a 1.5s wait`);
    assert.equal(await page.evaluate(() => window.scaleStopCommands), 1);
    return { candidate, saved };
  });
  await run('GATT drop releases the timer and reconnect preserves the recorded segment', async ({ page, readTime, stop, candidate, connect, notify, savedTime }) => {
    await page.evaluate(() => window.scaleDrop());
    await page.clock.runFor(2000);
    const elapsed = await readTime();
    const reconnectOffered = await connect.count() > 0;
    assert.ok(elapsed >= candidate + 2 && reconnectOffered,
      `candidate ${candidate}s, elapsed ${elapsed}s, reconnect offered ${reconnectOffered}`);
    await connect.evaluate((button) => button.click());
    await page.clock.runFor(1500);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
    for (let i = 0; i < 18; i++) await notify(80);
    assert.equal(await stop.isVisible(), true);
    await stop.click();
    const saved = await savedTime();
    await page.getByTestId('dial-yield-tile').locator('input').fill('36');
    await page.getByRole('button', { name: 'Balanced', exact: true }).click();
    await page.getByRole('button', { name: 'Log shot & calculate grind adjustment', exact: true }).click();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.getByTestId('history-shot-card').waitFor();
    const shots = await readShots(page);
    assert.equal(shots.length, 1);
    assert.equal(shots[0].actualTimeS, saved);
    const curve = shots[0].scaleFlowCurve;
    assert.ok(curve.length > 45);
    assert.equal(curve.at(-1).weightG, 36);
    assert.ok(curve.at(-1).tS < elapsed, 'reconnected weights are not appended to the interrupted shot');
    assert.equal(shots[0].shotProfileTiming.scaleInterrupted, true);
    const card = page.getByTestId('history-shot-card');
    await card.getByTestId('history-share-shot').waitFor();
    await card.getByRole('button', { name: 'Delete shot', exact: true }).waitFor();
    await card.getByText('Shot profile', { exact: true }).click();
    await card.getByText('Scale recording interrupted', { exact: true }).waitFor();
    const insights = card.getByTestId('shot-insights');
    await insights.getByText('Shot insights', { exact: true }).waitFor();
    await insights.getByText('Main takeaway', { exact: true }).waitFor();
    await insights.getByText('Supporting observations', { exact: true }).waitFor();
    if (shots[0].recommendation?.recommendedSetting) {
      await insights.getByText('Next step', { exact: true }).waitFor();
    } else {
      assert.equal(await insights.getByText('Next step', { exact: true }).count(), 0,
        'shots without a saved setting do not receive invented advice');
    }
    const timeInsight = (await insights.textContent()).toLowerCase();
    const savedTimeRelation = shots[0].actualTimeS < 27 ? 'faster than the saved'
      : shots[0].actualTimeS > 32 ? 'slower than the saved' : 'within the saved';
    assert.ok(timeInsight.includes(savedTimeRelation), `Unexpected target explanation: ${timeInsight}`);
    for (const viewport of [{ width: 320, height: 640 }, { width: 412, height: 915 }]) {
      await page.setViewportSize(viewport);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `History insights overflow at ${viewport.width}px`);
      await insights.evaluate((element) => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
      await page.screenshot({ path: path.join(tmpdir(), `b09-shot-insights-${viewport.width}x${viewport.height}.png`) });
      await card.getByRole('button', { name: 'Weight', exact: true }).click();
      await card.getByRole('img', { name: 'Scale weight (g)' }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await card.getByRole('button', { name: 'Flow', exact: true }).click();
      await card.getByRole('img', { name: 'Flow rate (g/s)' }).waitFor();
    }
    await page.getByTitle('Settings', { exact: true }).click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.ok((await insights.textContent()).includes('Shot insights'));
    await page.setViewportSize({ width: 412, height: 915 });
    await insights.evaluate((element) => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await page.screenshot({ path: path.join(tmpdir(), 'b09-shot-insights-light-412x915.png') });
    assert.deepEqual(await readShots(page), shots, 'viewing insights does not mutate the saved shot');
    const exported = await readDiagnostics(page);
    assert.equal(exported.shotId, shots[0].id);
    const gaps = exported.scaleDiagnostics.gaps;
    const reconnectGap = gaps.find(({ connectionEvents }) =>
      connectionEvents.some(({ type }) => type === 'disconnect')
      && connectionEvents.some(({ type }) => type === 'reconnect'));
    assert.ok(reconnectGap?.durationMs >= 2000);
    assert.ok(exported.scaleDiagnostics.rawWeightSamples.some(({ weightG }) => weightG === 80));
    assert.equal(exported.final.rule, 'manual');
    await page.reload();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    const reopenedCard = page.getByTestId('history-shot-card');
    await reopenedCard.getByText('Shot profile', { exact: true }).click();
    await reopenedCard.getByTestId('shot-insights').getByText('Shot insights', { exact: true }).waitFor();
    assert.deepEqual(await readShots(page), shots, 'reopening History preserves the stored shot');
    return { candidate, elapsed, reconnectOffered, saved, originalSamples: curve.length, gapMs: reconnectGap.durationMs };
  });
  await run('saving waits for final scale metrics and keeps the recorded curve', async ({ page, notify, stop, savedTime }) => {
    const pauseAt = await page.evaluate(() => Date.now() + 500);
    await page.clock.pauseAt(new Date(pauseAt));
    await stop.evaluate((button) => button.click());
    const saved = await savedTime();
    const yieldTile = page.getByTestId('dial-yield-tile');
    const settling = yieldTile.getByRole('status').filter({ hasText: 'Reading final weight' });
    const log = page.getByRole('button', { name: 'Log shot & calculate grind adjustment', exact: true });
    await settling.waitFor();
    assert.equal(await log.isDisabled(), true);
    await yieldTile.locator('input').fill('35.5');
    await page.getByRole('button', { name: 'Balanced', exact: true }).evaluate((button) => button.click());
    await log.evaluate((button) => button.form.requestSubmit());
    assert.deepEqual(await readShots(page), []);
    for (let i = 0; i < 12; i++) await notify(36);
    await settling.waitFor({ state: 'hidden' });
    await page.clock.resume();
    await log.click();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.getByTestId('history-shot-card').waitFor();
    const shots = await readShots(page);
    assert.equal(shots.length, 1);
    assert.equal(shots[0].actualTimeS, saved);
    assert.equal(shots[0].actualYieldG, 35.5);
    assert.ok(shots[0].scaleFlowCurve.length > 45);
    const exported = await readDiagnostics(page);
    assert.equal(exported.final.pendingCandidate, 'rejected');
    assert.equal(exported.final.confirmationMs, null);
    assert.equal(exported.final.savedYieldG, 35.5);
    assert.equal(exported.final.yieldSettlementCompleted, true);
  });
  await run('countdown is excluded and manual pre-infusion is separate from extraction', async ({ page, start, stop, readTime, savedTime, notify }) => {
    const ready = page.getByText('Get ready', { exact: true });
    await start.click();
    await ready.waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await ready.waitFor({ state: 'hidden' });
    await page.clock.runFor(4000);
    assert.equal(await stop.isVisible(), false, 'cancelled countdown never starts the shot');
    await start.click();
    await ready.waitFor();
    for (const second of ['2', '1']) {
      await page.clock.runFor(1050);
      await ready.locator('..').getByText(second, { exact: true }).waitFor();
    }
    await page.clock.runFor(1050);
    await ready.waitFor({ state: 'hidden' });
    await page.clock.runFor(200);
    const endPreinfusion = page.getByRole('button', { name: 'End pre-infusion', exact: true });
    await endPreinfusion.waitFor();
    assert.ok(await readTime() < 0.6, 'the countdown does not advance the shot clock');
    if (withPressurePreview) {
      await notify(0, 1100);
      await notify(0, 1150);
    } else await page.clock.runFor(2250);
    await endPreinfusion.click();
    await stop.waitFor();
    assert.ok(await readTime() < 0.4, 'extraction display begins at zero');
    if (withPressurePreview) {
      for (let i = 0; i < 15; i++) await notify(i * 0.8, 150);
    } else await page.clock.runFor(2250);
    await stop.click();
    assert.equal(await savedTime(), 2);
    if (withPressurePreview) {
      await page.clock.runFor(2000);
      await logShot(page);
      const [shot] = await readShots(page);
      const exported = await readDiagnostics(page);
      const { pressureOffsetMs, appExtractionOffsetMs, extractionOffsetMs } = exported.timeline;
      assert.equal(exported.pressureSource, 'simulated');
      assert.ok(Math.abs(pressureOffsetMs) < 250);
      assert.ok(appExtractionOffsetMs > 2000 && appExtractionOffsetMs < 3000);
      assert.ok(Math.abs(appExtractionOffsetMs - extractionOffsetMs) < 250);
      const pressureTimes = shot.labPressureCurve.map(({ tS }) => tS * 1000 + pressureOffsetMs);
      assert.ok(pressureTimes[0] < extractionOffsetMs && pressureTimes.at(-1) > extractionOffsetMs);
      assert.ok(shot.scaleFlowCurve.length > 0);
      const scaleTimes = shot.scaleFlowCurve.map(({ tS }) => tS * 1000 + extractionOffsetMs);
      assert.ok(scaleTimes[0] >= extractionOffsetMs);
      assert.ok(exported.scaleDiagnostics.rawWeightSamples.some(({ tMs }) => tMs < extractionOffsetMs));
      assert.equal(exported.final.savedYieldG, shot.actualYieldG);
      return { pressureOffsetMs, appExtractionOffsetMs, extractionOffsetMs, savedExtraction: shot.actualTimeS };
    }
    return { savedExtraction: await savedTime() };
  }, { withPlateau: false, settings: {
    shotStartCountdown: 'on', preInfusionEnabled: true, labCameraPressureEnabled: withPressurePreview,
  } });
} finally {
  await browser?.close();
  await server.kill();
}
if (failures) process.exitCode = 1;
