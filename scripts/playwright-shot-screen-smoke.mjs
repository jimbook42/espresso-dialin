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
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
  await page.addInitScript(() => {
    const devices = navigator.mediaDevices;
    const open = devices.getUserMedia.bind(devices);
    window.cameraSmokeTracks = [];
    devices.getUserMedia = async (constraints) => {
      const stream = await open(constraints);
      window.cameraSmokeTracks.push(...stream.getVideoTracks());
      return stream;
    };
  });
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
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  // Dial keeps its calibration guard. Verify a cancelled setup can acquire the
  // shared stream again on a second Start, without any layout-test bypass.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByRole('button', { name: 'Close gauge setup', exact: true }).waitFor();
    await page.waitForFunction(() => {
      const owner = document.querySelector('[data-testid="shot-reader-video"]');
      const setup = document.querySelector('[data-testid="gauge-tap-viewport"] video');
      return owner?.srcObject && owner.srcObject === setup?.srcObject;
    }, null, { timeout: 30000 });
    await page.getByRole('button', { name: 'Close gauge setup', exact: true }).click();
  }
  passed++;
  console.log('PASS Start → Cancel setup → Start: setup uses the owner stream both times');
  await page.getByTitle('Settings', { exact: true }).click();
  await customiser.getByRole('switch', { name: 'Timer only', exact: true }).click();
  await layout('timer');
  await customiser.getByRole('switch', { name: 'Minimal mode' }).click();
  await layout('minimal');
  passed++;
  console.log('PASS customiser: four setups, preview, Minimal cycle, trust toggle, reset');

  await page.reload();
  await page.getByTitle('Settings', { exact: true }).click();
  assert.equal(await customiser.getByRole('switch', { name: 'Minimal mode' }).getAttribute('aria-checked'), 'true');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const live = page.getByTestId('adaptive-shot-screen');
  await live.waitFor();
  await page.waitForFunction(() => parseFloat(document.querySelector('[data-testid="adaptive-shot-screen"] [data-metric="time"]').textContent.replace('Time', '')) >= 1.2);
  await live.getByRole('button', { name: 'Cycle big number' }).click();
  assert.equal(await page.getByRole('button', { name: 'Stop shot', exact: true }).isVisible(), true);
  await page.screenshot({ path: path.join(tmpdir(), 'shot-screen-timer-mobile.png') });
  // Enable the existing gauge preference during this running manual timer.
  // This exercises the production uncalibrated camera path without inventing
  // calibration anchors or pressure readings, and without a test-mode bypass.
  await page.getByTitle('Settings', { exact: true }).evaluate((node) => node.click());
  await customiser.getByRole('switch', { name: 'Pressure gauge via camera' }).evaluate((node) => node.click());
  await page.getByRole('button', { name: 'Close settings', exact: true }).evaluate((node) => node.click());
  const liveToolbar = live.locator('.shot-camera-toolbar');
  assert.equal(await liveToolbar.count(), 1);
  await liveToolbar.getByRole('button', { name: 'Show gauge', exact: true }).click();
  for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => {
      const camera = document.querySelector('.shot-trust-camera--open');
      const rect = camera?.getBoundingClientRect();
      return rect && rect.height >= rect.width * 1.3;
    });
    const measurement = await page.evaluate(() => {
      const camera = document.querySelector('.shot-trust-camera--open').getBoundingClientRect();
      const aim = document.querySelector('[data-testid="shot-camera-aim"]');
      const aimHeight = aim.getBoundingClientRect().height;
      const visibility = aim.style.visibility;
      aim.style.visibility = visibility === 'hidden' ? 'visible' : 'hidden';
      const alternateAimHeight = aim.getBoundingClientRect().height;
      aim.style.visibility = visibility;
      const header = document.querySelector('.shot-timer-header').getBoundingClientRect();
      const controls = [...document.querySelectorAll('.shot-camera-toolbar button, .shot-timer-footer button')].map((button) => {
        const rect = button.getBoundingClientRect();
        return { text: button.getAttribute('aria-label') || button.textContent.trim(), top: rect.top, bottom: rect.bottom, height: rect.height };
      });
      return { scrollHeight: document.documentElement.scrollHeight, innerHeight, cameraHeight: camera.height,
        cameraWidth: camera.width, aimHeight, alternateAimHeight, headerTop: header.top, headerBottom: header.bottom, controls };
    });
    assert.ok(measurement.scrollHeight <= measurement.innerHeight, JSON.stringify(measurement));
    assert.ok(measurement.cameraHeight >= measurement.cameraWidth * 1.3, JSON.stringify(measurement));
    assert.equal(measurement.aimHeight, measurement.alternateAimHeight);
    assert.ok(measurement.aimHeight > 0);
    for (const control of measurement.controls) {
      assert.ok(control.height > 0 && control.top >= 0 && control.bottom <= viewport.height, JSON.stringify(control));
    }
    assert.ok(measurement.controls.some((control) => control.text === 'Stop shot'));
    assert.ok(measurement.controls.some((control) => control.text === 'Cancel'));
    const hide = measurement.controls.find((control) => control.text === 'Hide gauge');
    assert.ok(hide && hide.top >= measurement.headerTop && hide.bottom <= measurement.headerBottom);
    await page.screenshot({ path: path.join(tmpdir(), `shot-screen-portrait-${viewport.width}x${viewport.height}.png`) });
  }
  const timerValue = live.locator('[data-metric="time"] .shot-metric-value');
  const timeBeforeCameraLoss = Number.parseFloat(await timerValue.textContent());
  await page.waitForFunction(() => document.querySelector('[data-testid="shot-reader-video"]')?.srcObject?.active);
  const beforeRecovery = await page.evaluate(() => {
    const track = document.querySelector('[data-testid="shot-reader-video"]').srcObject.getVideoTracks()[0];
    const count = window.cameraSmokeTracks.length;
    track.stop();
    // Explicit stop does not emit ended. Simulate an external disconnect.
    track.dispatchEvent(new Event('ended'));
    return count;
  });
  await page.waitForFunction((count) => window.cameraSmokeTracks.length === count + 1
    && document.querySelector('[data-testid="shot-reader-video"]')?.srcObject?.active, beforeRecovery);
  assert.equal(await page.evaluate(() => window.cameraSmokeTracks.filter((track) => track.readyState === 'live').length), 1);
  await page.waitForFunction((before) => {
    const value = document.querySelector('[data-testid="adaptive-shot-screen"] [data-metric="time"] .shot-metric-value');
    return Number.parseFloat(value.textContent) >= before + 1;
  }, timeBeforeCameraLoss);
  assert.equal(await page.getByRole('button', { name: 'Stop shot', exact: true }).isVisible(), true);
  passed++;
  console.log('PASS simulated camera disconnect: one replacement track, shot timer continues');
  assert.equal(await liveToolbar.getByRole('button', { name: 'Hide gauge', exact: true }).count(), 1);
  await liveToolbar.getByRole('button', { name: 'Hide gauge', exact: true }).click();
  await live.locator('.shot-trust-camera').waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTitle('Settings', { exact: true }).evaluate((node) => node.click());
  await customiser.getByRole('switch', { name: 'Timer only', exact: true }).evaluate((node) => node.click());
  await customiser.getByRole('switch', { name: 'Minimal mode' }).evaluate((node) => node.click());
  await page.getByRole('button', { name: 'Close settings', exact: true }).evaluate((node) => node.click());
  passed++;
  console.log('PASS portrait trust: 390x844 and 375x667, no scroll, tall camera, visible controls, fixed Aim slot');

  const timeBeforeStall = Number.parseFloat(await timerValue.textContent());
  await page.evaluate(() => {
    const resumeAt = performance.now() + 1500;
    while (performance.now() < resumeAt) { /* emulate a long reader task */ }
  });
  await page.waitForTimeout(250);
  const elapsedDuringStall = Number.parseFloat(await timerValue.textContent()) - timeBeforeStall;
  assert.ok(elapsedDuringStall >= 1.4, `Timer advanced ${elapsedDuringStall.toFixed(1)} s across a 1.5 s main-thread stall`);
  passed++;
  console.log(`PASS timer catch-up: advanced ${elapsedDuringStall.toFixed(1)} s across the 1.5 s stall and 0.25 s recovery wait`);

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
