import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const camera = process.argv.includes('--camera');
const combined = process.argv.includes('--combined');
if (combined && !camera) throw new Error('Use --camera with --combined.');
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const fixture = '/b06-local-gauge-fixture.mp4';
const fixturePath = process.env.B06_CAMERA_CLIP;
if (camera && !fixturePath) throw new Error('Set B06_CAMERA_CLIP to a recorded MP4 with an adjacent tap-calibration JSON.');
const calibration = camera
  ? JSON.parse(await readFile(fixturePath.replace(/\.mp4$/i, '.json'), 'utf8')).tapCalibration
  : null;
if (camera && !calibration?.anchors) throw new Error('The recording has no tap calibration.');
const videoBytes = camera ? await readFile(fixturePath) : null;
const screenshotDir = process.env.B08_SCREENSHOTS;
const server = startPreviewServer(combined ? 4189 : camera ? 4186 : 4187, process.env.B06_PREVIEW_DIST);
let browser;

function readRows(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const stores = ['beans', 'recipes', 'settings', 'shots'];
      const tx = db.transaction(stores);
      const rows = Object.fromEntries(stores.map((store) => [store, tx.objectStore(store).getAll()]));
      tx.oncomplete = () => {
        db.close();
        resolve(Object.fromEntries(stores.map((store) => [store, rows[store].result])));
      };
      tx.onerror = () => reject(tx.error);
    };
  }));
}

async function diagnostics(page, card) {
  const downloadPromise = page.waitForEvent('download');
  await card.getByTestId('history-shot-diagnostics-export').click();
  const download = await downloadPromise;
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

async function sharedDiagnostics(page, action) {
  await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true }));
  await action.click();
  const dialog = page.getByRole('dialog', { name: 'Share shot' });
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Share', exact: true }).click();
  const download = await pending;
  await dialog.getByRole('button', { name: 'Done' }).click();
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

async function connectSimulatedScale(page) {
  await page.getByRole('combobox', { name: 'Scale transport' }).selectOption('sim');
  await page.getByRole('button', { name: 'Connect scale' }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
}

async function checkShotProfile(page, card, shot, screenshot) {
  const panel = card.getByTestId('history-shot-profile');
  const summary = panel.getByText('Shot profile', { exact: true });
  const details = panel.getByTestId('shot-profile-details');
  assert.equal(await details.count(), 0);
  await summary.tap();
  await panel.getByTestId('shot-pressure-chart').waitFor();
  const timing = shot.shotProfileTiming;
  assert.equal(timing.version, 1);
  assert.ok(Number.isFinite(timing.pressureOriginMs));
  assert.ok(Number.isFinite(timing.extractionEndMs));
  assert.equal(await panel.getByText('Approximate alignment', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const hasScale = Boolean(shot.scaleFlowCurve?.length);
  if (hasScale) {
    assert.ok(Number.isFinite(timing.scaleOriginMs));
    assert.ok(timing.settlementEndMs >= timing.stopMs);
    await panel.getByRole('button', { name: 'Weight', exact: true }).tap();
    await panel.getByRole('img', { name: 'Scale weight (g)' }).waitFor();
    await panel.getByRole('button', { name: 'Flow', exact: true }).tap();
    await panel.getByRole('img', { name: 'Flow rate (g/s)' }).waitFor();
    await panel.getByRole('button', { name: 'Combined', exact: true }).tap();
    await panel.getByRole('img', { name: 'Pressure (bar) and flow (g/s)' }).waitFor();
  } else {
    await panel.getByText('No scale data', { exact: true }).waitFor();
    assert.equal(timing.scaleOriginMs, null);
  }
  const chart = panel.getByRole('img');
  await chart.tap();
  await panel.getByTestId('profile-time-cursor').waitFor({ state: 'attached' });
  await panel.getByTestId('profile-observations').waitFor();
  const range = panel.getByRole('slider', { name: 'Explore shot time' });
  const timeBefore = await range.inputValue();
  await range.press('ArrowRight');
  assert.notEqual(await range.inputValue(), timeBefore);
  if (screenshot && screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await chart.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshotDir, screenshot) });
  }
  await summary.tap();
  await details.waitFor({ state: 'detached' });
}

async function calibrate(page, { sheetOpen = false } = {}) {
  if (!sheetOpen) await page.getByRole('button', { name: 'Calibrate gauge', exact: true }).click();
  await page.getByText(/Frame held.*centre marker/i).waitFor();
  const viewport = page.getByTestId('gauge-tap-viewport');
  for (const key of ['centre', 'five', 'ten']) {
    const point = calibration.anchors[key];
    const box = await viewport.boundingBox();
    const crop = await page.evaluate(() => window.__labGaugeTapViewState.crop);
    await viewport.click({ position: {
      x: (point.x - crop.cx + crop.half) / (2 * crop.half) * box.width,
      y: (point.y - crop.cy + crop.half) / (2 * crop.half) * box.height,
    } });
    await page.getByRole('button', { name: 'Confirm tap' }).click();
  }
  await page.getByRole('button', { name: 'Accept calibration' }).click();
}

async function interruptCamera(page) {
  const interruptedTrackId = await page.getByTestId('shot-reader-video').evaluate((video) => {
    const [track] = video.srcObject.getVideoTracks();
    track.stop();
    track.dispatchEvent(new Event('ended'));
    return track.id;
  });
  const retry = page.getByRole('button', { name: 'Retry camera' });
  await page.waitForFunction((oldTrackId) => {
    const track = document.querySelector('[data-testid="shot-reader-video"]').srcObject?.getVideoTracks()[0];
    return (track?.id !== oldTrackId && track?.readyState === 'live')
      || [...document.querySelectorAll('button')].some((button) => button.textContent === 'Retry camera');
  }, interruptedTrackId);
  if (await retry.isVisible()) {
    await page.waitForTimeout(500);
    await retry.click();
  }
  await page.waitForFunction((oldTrackId) => {
    const track = document.querySelector('[data-testid="shot-reader-video"]').srcObject?.getVideoTracks()[0];
    return track?.id !== oldTrackId && track?.readyState === 'live';
  }, interruptedTrackId);
}

async function setup(viewport, context) {
  const page = context?.pages()[0] ?? await browser.newPage({ viewport, isMobile: true, hasTouch: true, acceptDownloads: true });
  if (camera) await page.route(`**${fixture}`, async (route) => {
    const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' };
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
    if (!range) return route.fulfill({ headers, body: videoBytes });
    const from = Number(range[1]);
    const to = range[2] ? Number(range[2]) : videoBytes.length - 1;
    return route.fulfill({ status: 206, body: videoBytes.subarray(from, to + 1),
      headers: { ...headers, 'content-range': `bytes ${from}-${to}/${videoBytes.length}` } });
  });
  await page.addInitScript(({ fixture, calibration }) => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'shots' && window.failShotWrite) {
        window.failShotWrite = false;
        throw new DOMException('Injected write failure', 'QuotaExceededError');
      }
      return add.apply(this, args);
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'lastReplay' && window.failReplayWrite) {
        this.transaction.abort();
        window.failReplayWrite = false;
        window.replayWriteFailed = true;
        throw new DOMException('Injected replay write failure', 'QuotaExceededError');
      }
      return put.apply(this, args);
    };
    if (!fixture) return;
    navigator.mediaDevices.getUserMedia = async () => {
      const video = document.createElement('video');
      video.src = fixture;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
      });
      await new Promise((resolve) => {
        video.onseeked = resolve;
        video.currentTime = calibration.atSec;
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0);
      window.__labGaugeTapFixture = {
        src: canvas.toDataURL(), autoFreeze: true, mirror: false,
        initialFocus: calibration.anchors.centre, initialHalf: 125,
      };
      await video.play();
      const stream = video.captureStream();
      const track = stream.getVideoTracks()[0];
      const timer = setInterval(() => {
        if (track.readyState === 'ended') {
          clearInterval(timer);
          video.pause();
        }
      }, 100);
      window.fixtureTrack = track;
      return stream;
    };
  }, { fixture: camera ? fixture : null, calibration });
  await page.goto(server.url);
  if (combined) {
    await page.getByRole('radio', { name: 'Combined', exact: true }).waitFor();
    await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('EspressoDialDB');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['settings', 'beans', 'recipes'], 'readwrite');
        tx.objectStore('settings').put({
          id: 'global', experiencePreference: 'combined', grinderModel: 'Sette 270Wi',
          lastSelectedBeanId: 'camera-bean', preInfusionEnabled: true, shotStartCountdown: 0,
          smartScaleDeviceId: 'timemore-dot', scaleFlowAutoStopEnabled: false,
        });
        tx.objectStore('beans').put({ id: 'camera-bean', name: 'Camera coffee', roastType: 'Medium' });
        tx.objectStore('recipes').put({ id: 'camera-recipe', beanId: 'camera-bean',
          targetTimeMinS: 27, targetTimeMaxS: 32, targetDoseG: 18, targetYieldG: 36 });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }));
    await page.reload();
    await page.getByRole('button', { name: 'Enable camera pressure (optional)' }).click();
    return page;
  }
  await page.getByRole('radio', { name: 'Pressure Tracker', exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const start = page.getByRole('button', { name: 'Start recording' });
  await start.waitFor();
  assert.equal(await start.isDisabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const rows = await readRows(page);
  assert.deepEqual(rows.beans, []);
  assert.deepEqual(rows.recipes, []);
  assert.deepEqual(rows.settings, [{ id: 'global', experiencePreference: 'pressure' }]);
  if (camera) {
    await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
    });
  }
  await page.getByRole('button', { name: 'Enable camera' }).click();
  return page;
}

async function checkCombinedCamera(page, verifyFailedReplay) {
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await start.click();
  await calibrate(page, { sheetOpen: true });
  await page.getByText(/Camera pressure on · Gauge calibrated/).waitFor();
  await page.locator('[data-dial-found="true"]').waitFor({ timeout: 20000 });
  await connectSimulatedScale(page);
  await start.click();
  const stop = page.getByRole('button', { name: 'Stop shot', exact: true });
  const endPreInfusion = page.getByRole('button', { name: 'End pre-infusion' });
  await endPreInfusion.waitFor();
  await page.waitForTimeout(700);
  await endPreInfusion.click();
  await stop.waitFor();
  await page.waitForTimeout(1500);
  await interruptCamera(page);
  await page.waitForTimeout(1300);
  await stop.click();
  await page.getByText(/Peak pressure .* bar/).waitFor();
  await page.getByRole('button', { name: 'Log shot & calculate grind adjustment' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-testid="dial-yield-tile"] input')?.readOnly);
  await page.waitForTimeout(2500);
  await page.getByTestId('dial-yield-tile').locator('input').fill('36');
  await page.getByRole('button', { name: 'Balanced', exact: true }).click();
  await page.getByRole('button', { name: 'Rate shot 4 out of 5' }).click();
  const log = page.getByRole('button', { name: 'Log shot & calculate grind adjustment' });
  await page.evaluate(() => { window.failShotWrite = true; });
  await log.click();
  await page.getByText(/Error saving to database/).waitFor();
  assert.deepEqual((await readRows(page)).shots, []);
  await log.evaluate((button) => { button.form.requestSubmit(); button.form.requestSubmit(); });
  const history = page.getByRole('navigation').getByRole('button', { name: 'History', exact: true });
  await history.click();
  const card = page.getByTestId('history-shot-card').filter({ hasText: 'Camera coffee' });
  await card.waitFor();
  const { shots } = await readRows(page);
  assert.equal(shots.length, 1);
  const [shot] = shots;
  assert.equal(shot.beanId, 'camera-bean');
  assert.equal(shot.recordType, undefined);
  assert.equal(shot.shotRating, 4);
  assert.ok(shot.actualTimeS >= 2);
  assert.ok(shot.labPressureCurve.length > 0);
  assert.ok(shot.scaleFlowCurve.length > 0);
  assert.ok(shot.shotProfileTiming.extractionStartMs > 0);
  assert.ok(shot.shotProfileTiming.scaleOriginMs >= shot.shotProfileTiming.extractionStartMs);
  const { width, height } = page.viewportSize();
  await checkShotProfile(page, card, shot, `b08-combined-${width}x${height}.png`);
  const exported = await diagnostics(page, card);
  assert.equal(exported.shotId, shot.id);
  assert.equal(exported.pressureSource, 'camera');
  assert.deepEqual(exported.labPressureCurve, shot.labPressureCurve);
  assert.equal((await sharedDiagnostics(page, page.getByTestId('saved-share-shot'))).shotId, shot.id);
  for (let visit = 0; visit < 2; visit++) {
    if (visit) {
      await page.reload();
      await history.click();
      assert.deepEqual((await readRows(page)).shots, shots);
      assert.match((await diagnostics(page, card)).stopDiagnosticsAvailability, /page reloaded/);
      await checkShotProfile(page, card, shot);
    }
    await card.getByRole('button', { name: 'Play shot replay' }).click();
    await page.getByRole('dialog', { name: 'Shot replay' }).waitFor();
    await page.getByRole('button', { name: 'Close replay' }).click();
  }
  if (!verifyFailedReplay) return shot;
  await page.getByRole('navigation').getByRole('button', { name: 'Dial', exact: true }).click();
  await page.locator('[data-dial-found="true"]').waitFor({ timeout: 20000 });
  await start.click();
  await page.getByRole('button', { name: 'Yes, start shot' }).click();
  await endPreInfusion.click();
  await stop.waitFor();
  await page.waitForTimeout(2500);
  await stop.click();
  await page.waitForTimeout(2500);
  await page.getByTestId('dial-yield-tile').locator('input').fill('34');
  await page.getByRole('button', { name: 'Balanced', exact: true }).click();
  await page.evaluate(() => { window.failReplayWrite = true; });
  await log.click();
  await history.click();
  const afterFailure = (await readRows(page)).shots;
  assert.equal(afterFailure.length, 2);
  assert.equal(await page.evaluate(() => window.replayWriteFailed), true);
  assert.ok(afterFailure.find(({ id }) => id !== shot.id).labPressureCurve.length > 0);
  await page.getByTestId('history-shot-card').getByRole('button', { name: 'Play shot replay' }).waitFor();
}

try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  for (const [viewport, withScale] of [[{ width: 320, height: 640 }, false], [{ width: 412, height: 915 }, true]]) {
    if (combined) {
      const profileDir = await mkdtemp(join(tmpdir(), 'dialin-b08-combined-'));
      const launch = () => chromium.launchPersistentContext(profileDir, { viewport, isMobile: true, hasTouch: true });
      let context = await launch();
      try {
        const page = await setup(viewport, context);
        const shot = await checkCombinedCamera(page, withScale);
        if (shot) {
          await context.close();
          context = await launch();
          const [restarted] = context.pages();
          await restarted.goto(server.url);
          await restarted.getByRole('navigation').getByRole('button', { name: 'History', exact: true }).click();
          assert.deepEqual((await readRows(restarted)).shots, [shot]);
          const card = restarted.getByTestId('history-shot-card').filter({ hasText: 'Camera coffee' });
          await checkShotProfile(restarted, card, shot);
          await card.getByRole('button', { name: 'Play shot replay' }).click();
          await restarted.getByRole('dialog', { name: 'Shot replay' }).waitFor();
        }
        console.log(`PASS ${viewport.width}×${viewport.height} Combined recorded gauge and simulated scale, save retry, profile, diagnostics and replay`);
      } finally {
        await context.close();
        await rm(profileDir, { recursive: true, force: true });
      }
      continue;
    }
    const page = await setup(viewport);
    const start = page.getByRole('button', { name: 'Start recording' });
    if (withScale) {
      await page.getByRole('button', { name: 'Pressure settings' }).click();
      await page.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'Timemore Black Mirror Dot' }) })
        .selectOption('timemore-dot');
      await page.getByRole('button', { name: 'Save & Close' }).click();
      await connectSimulatedScale(page);
    }
    if (camera) {
      assert.equal(await start.isDisabled(), true);
      await calibrate(page);
      await page.locator('[data-dial-found="true"]').waitFor({ timeout: 20000 });
      await start.click();
      await page.getByRole('button', { name: 'Stop recording' }).waitFor();
      await page.waitForTimeout(1500);
      await interruptCamera(page);
      await page.waitForTimeout(1300);
    } else {
      await page.getByText('Simulated pressure preview', { exact: true }).waitFor();
      await page.clock.install();
      await start.click();
      await page.clock.runFor(withScale ? 4000 : 125000);
    }
    const stop = page.getByRole('button', { name: 'Stop recording' });
    await stop.evaluate((button) => { button.click(); button.click(); });
    await page.getByRole('heading', { name: 'Review recording' }).waitFor();
    const save = page.getByRole('button', { name: 'Save recording' });
    if (!camera && withScale) await page.clock.runFor(3500);
    if (withScale) {
      await page.getByLabel('Shot name').fill('Morning pull');
      await page.getByLabel('Dose (g)').fill('18');
      await page.getByLabel('Yield (g)').fill('36');
      await page.getByLabel('Rating').selectOption('4');
      await page.getByLabel('Notes').fill('Standalone browser check');
    }
    await page.evaluate(() => { window.failShotWrite = true; });
    await save.click();
    await page.getByRole('alert').filter({ hasText: 'Recording could not be saved' }).waitFor();
    assert.deepEqual((await readRows(page)).shots, []);
    await save.evaluate((button) => { button.click(); button.click(); });
    const cards = page.getByTestId('history-shot-card');
    const card = cards.filter({ hasText: withScale ? 'Morning pull' : 'Pressure recording' });
    await card.waitFor();
    const { shots } = await readRows(page);
    assert.equal(shots.length, 1);
    const [shot] = shots;
    assert.equal(shot.recordType, 'standalone-pressure');
    assert.equal(shot.beanId, undefined);
    assert.equal(shot.grinderModel, undefined);
    assert.ok(shot.labPressureCurve.length > 0);
    if (camera) {
      assert.ok(shot.actualTimeS >= 2, 'camera interruption did not stop the timer');
      await card.getByRole('button', { name: 'Play shot replay' }).click();
      await page.getByRole('dialog', { name: 'Shot replay' }).waitFor();
      await page.getByRole('button', { name: 'Close replay' }).click();
    }
    if (!camera && !withScale) assert.ok(shot.actualTimeS >= 125);
    if (withScale) {
      assert.equal(shot.brewRatio, '1:2.0');
      assert.equal(shot.shotRating, 4);
      assert.equal(shot.shotName, 'Morning pull');
    } else {
      for (const field of ['actualDoseG', 'actualYieldG', 'shotRating']) assert.equal(shot[field], undefined);
    }
    assert.equal(shot.scaleFlowCurve?.length > 0, withScale);
    assert.equal(await card.getByText('Unknown bean').count(), 0);
    await checkShotProfile(page, card, shot, camera ? `b08-pressure-${viewport.width}x${viewport.height}.png` : null);
    const exported = await diagnostics(page, card);
    assert.equal(exported.shotId, shot.id);
    assert.equal(exported.diagnosticsVersion, 2);
    assert.equal(exported.exportBuild.appVersion, version);
    assert.equal(exported.final.actualTimeS, shot.actualTimeS);
    assert.equal(exported.final.rule, 'manual');
    assert.equal((await sharedDiagnostics(page, page.getByTestId('saved-share-shot'))).shotId, shot.id);
    assert.equal(exported.scaleDiagnostics.availability, withScale ? 'current-session' : 'unavailable');
    if (withScale) assert.equal(exported.scaleDiagnostics.identity.simulated, true);
    assert.equal(shot.diagnosticsVersion, undefined);
    if (!camera && !withScale) {
      await page.getByRole('button', { name: 'Pressure', exact: true }).click();
      await start.evaluate((button) => button.click());
      await page.clock.runFor(1300);
      await stop.evaluate((button) => button.click());
      await page.getByLabel('Shot name').fill('Repeat recording');
      await save.click();
      const repeat = cards.filter({ hasText: 'Repeat recording' });
      await repeat.waitFor();
      const second = await diagnostics(page, repeat);
      assert.notEqual(second.shotId, exported.shotId);
      assert.ok(second.final.actualTimeS < exported.final.actualTimeS);
      assert.equal((await diagnostics(page, card)).shotId, exported.shotId);
      assert.equal((await readRows(page)).shots.length, 2);
      page.once('dialog', (dialog) => dialog.accept());
      await repeat.getByRole('button', { name: 'Delete shot' }).click();
      await repeat.waitFor({ state: 'detached' });
    }
    await page.reload();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await card.waitFor();
    assert.deepEqual((await readRows(page)).shots, shots);
    await checkShotProfile(page, card, shot);
    const reloaded = await diagnostics(page, card);
    assert.equal(reloaded.recordingBuild, null);
    assert.match(reloaded.stopDiagnosticsAvailability, /page reloaded/);
    assert.deepEqual(reloaded.labPressureCurve, exported.labPressureCurve);
    assert.equal((await sharedDiagnostics(page, card.getByTestId('history-share-shot'))).shotId, shot.id);
    await page.getByRole('button', { name: 'Pressure', exact: true }).click();
    await start.waitFor();
    if (!camera && !withScale) {
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
      await start.evaluate((button) => button.click());
      await stop.evaluate((button) => button.click());
      await page.getByText('No valid pressure samples were captured.').waitFor();
      assert.equal(await save.count(), 0);
      await page.getByRole('button', { name: 'Discard recording' }).evaluate((button) => button.click());
      assert.deepEqual((await readRows(page)).shots, shots);
    }
    await page.close();
    console.log(`PASS ${viewport.width}×${viewport.height} ${camera ? 'recorded gauge fixture' : 'preview simulation'}`);
  }
} finally {
  await browser?.close();
  await server.kill();
}
