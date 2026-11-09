import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const camera = process.argv.includes('--camera');
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const fixture = '/b06-local-gauge-fixture.mp4';
const fixturePath = process.env.B06_CAMERA_CLIP;
if (camera && !fixturePath) throw new Error('Set B06_CAMERA_CLIP to a recorded MP4 with an adjacent tap-calibration JSON.');
const calibration = camera
  ? JSON.parse(await readFile(fixturePath.replace(/\.mp4$/i, '.json'), 'utf8')).tapCalibration
  : null;
if (camera && !calibration?.anchors) throw new Error('The recording has no tap calibration.');
const videoBytes = camera ? await readFile(fixturePath) : null;
const server = startPreviewServer(camera ? 4186 : 4187, process.env.B06_PREVIEW_DIST);
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

async function calibrate(page) {
  await page.getByRole('button', { name: 'Calibrate gauge', exact: true }).click();
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

async function setup(viewport) {
  const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true, acceptDownloads: true });
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

try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  for (const [viewport, withScale] of [[{ width: 320, height: 640 }, false], [{ width: 412, height: 915 }, true]]) {
    const page = await setup(viewport);
    const start = page.getByRole('button', { name: 'Start recording' });
    if (camera) {
      assert.equal(await start.isDisabled(), true);
      await calibrate(page);
      await page.locator('[data-dial-found="true"]').waitFor({ timeout: 20000 });
      await start.click();
      await page.getByRole('button', { name: 'Stop recording' }).waitFor();
      await page.waitForTimeout(1500);
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
      await page.waitForTimeout(1300);
    } else {
      await page.getByText('Simulated pressure preview', { exact: true }).waitFor();
      if (withScale) {
        await page.getByRole('button', { name: 'Pressure settings' }).click();
        await page.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'Timemore Black Mirror Dot' }) })
          .selectOption('timemore-dot');
        await page.getByRole('button', { name: 'Save & Close' }).click();
        await page.getByRole('combobox', { name: 'Scale transport' }).selectOption('sim');
        await page.getByRole('button', { name: 'Connect scale' }).click();
        await page.getByRole('button', { name: 'Disconnect' }).waitFor();
      }
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
    assert.equal(shot.scaleFlowCurve?.length > 0, !camera && withScale);
    assert.equal(await card.getByText('Unknown bean').count(), 0);
    await card.getByTestId('shot-pressure-chart').waitFor();
    const exported = await diagnostics(page, card);
    assert.equal(exported.shotId, shot.id);
    assert.equal(exported.diagnosticsVersion, 2);
    assert.equal(exported.exportBuild.appVersion, version);
    assert.equal(exported.final.actualTimeS, shot.actualTimeS);
    assert.equal(exported.final.rule, 'manual');
    assert.equal(exported.scaleDiagnostics.availability, !camera && withScale ? 'current-session' : 'unavailable');
    if (!camera && withScale) assert.equal(exported.scaleDiagnostics.identity.simulated, true);
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
    const reloaded = await diagnostics(page, card);
    assert.equal(reloaded.recordingBuild, null);
    assert.match(reloaded.stopDiagnosticsAvailability, /page reloaded/);
    assert.deepEqual(reloaded.labPressureCurve, exported.labPressureCurve);
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
