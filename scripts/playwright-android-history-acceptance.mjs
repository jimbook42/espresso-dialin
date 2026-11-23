import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

assert.ok(process.env.DIALIN_PREVIEW_OUT_DIR, 'Point DIALIN_PREVIEW_OUT_DIR at the Android-mode web bundle.');
const server = startPreviewServer(4219);
const bean = { id: 'acceptance-bean', name: 'Acceptance test coffee', roastType: 'Medium' };
const shot = {
  id: 'accepted-shot', beanId: bean.id, timestamp: '2026-11-24T10:00:00Z',
  grinderModel: 'Sette 270Wi', setteMacro: 8, setteMicro: 'A', tasteProfile: 'balanced',
  actualDoseG: 18.5, actualYieldG: 31.8, actualTimeS: 30, notes: 'Recorded test entry',
  labPressureCurve: [{ tS: 0, bar: 0 }, { tS: 0.04, bar: 1 }, { tS: 1.2, bar: 3 }, { tS: 1.24, bar: 5 }],
  scaleFlowCurve: [{ tS: 0.5, weightG: 0 }, { tS: 0.7, weightG: 1 }, { tS: 0.9, weightG: 2 }],
  shotProfileTiming: {
    version: 1, pressureSource: 'camera', scaleSource: 'native-ble', clockDriftMs: 0,
    pressureOriginMs: 0, scaleOriginMs: 0, extractionStartMs: 500, extractionEndMs: 30500, stopMs: 30500,
  },
};
let browser;
try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 320, height: 720 }, serviceWorkers: 'block' });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const methods = ['beginFileExport', 'beginReplayExport', 'appendFileExport', 'exportFile', 'cancelFileExport',
      'getDiagnosticDevice', 'hasBluetoothPermissions', 'keepAwake'];
    const state = window.testShell = { calls: [], files: [], pending: null, next: 'save' };
    window.CapacitorCustomPlatform = { name: 'android' };
    window.Capacitor = {
      PluginHeaders: [{ name: 'AndroidShell', methods: methods.map((name) => ({ name, rtype: 'promise' })) }],
      async nativePromise(plugin, method, args) {
        if (plugin !== 'AndroidShell') throw new Error('Unexpected plugin: ' + plugin);
        state.calls.push({ method, args });
        if (method === 'beginFileExport' || method === 'beginReplayExport') state.pending = { ...args, bytes: '' };
        if (method === 'appendFileExport') {
          if (state.pending.id !== args.id || state.pending.bytes.length !== args.offset) throw new Error('Invalid chunk sequence');
          state.pending.bytes += atob(args.data);
        }
        if (method === 'cancelFileExport') state.pending = null;
        if (method === 'getDiagnosticDevice') return { androidVersion: '36', model: 'Test only' };
        if (method === 'hasBluetoothPermissions') return { granted: false };
        if (method !== 'exportFile') return {};
        const file = state.pending;
        state.pending = null;
        if (file.id !== args.id || file.bytes.length !== file.byteCount) throw new Error('Incomplete staged file');
        const course = state.next;
        state.next = 'save';
        if (course === 'cancel') return { cancelled: true };
        if (course === 'fail') throw new Error('Picker provider failed');
        state.files.push({ ...file, ...args });
        return { bytesWritten: file.bytes.length, filename: 'verified-' + file.filename };
      },
    };
  });
  await page.goto(server.url);
  await page.getByText(/Choose how you want to use Espresso Dial-In/).waitFor();
  const replayBytes = await page.evaluate(async ({ bean, shot }) => {
    function open(name, upgrade) {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onupgradeneeded = () => upgrade?.(req.result);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    const db = await open('EspressoDialDB');
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['settings', 'beans', 'recipes', 'shots'], 'readwrite');
      tx.objectStore('settings').put({ id: 'global', grinderModel: 'Sette 270Wi', experiencePreference: 'combined',
        lastSelectedBeanId: bean.id, labCameraPressureEnabled: true });
      tx.objectStore('beans').put(bean);
      tx.objectStore('recipes').put({ id: 'acceptance-recipe', beanId: bean.id, targetDoseG: 18.5,
        targetYieldG: 32, targetTimeMinS: 24, targetTimeMaxS: 28 });
      const shots = tx.objectStore('shots');
      shots.put(shot);
      shots.put({ id: 'old-shot', beanId: bean.id, timestamp: '2025-01-01T00:00:00Z', notes: 'Older manual shot',
        actualDoseG: 18, actualYieldG: 36, actualTimeS: 26 });
      for (let i = 0; i < 16; i++) shots.put({ ...shot, id: 'extra-' + i, timestamp: '2025-02-01T00:00:00Z', notes: 'Other recorded entry' });
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(10);
    const mimeType = 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    const blob = await new Promise((resolve, reject) => {
      recorder.ondataavailable = ({ data }) => resolve(data);
      recorder.onerror = (event) => reject(event.error);
      recorder.start();
      ctx.fillRect(0, 0, 32, 32);
      setTimeout(() => { ctx.clearRect(0, 0, 8, 8); }, 120);
      setTimeout(() => recorder.stop(), 350);
    });
    stream.getTracks().forEach((track) => track.stop());
    const replay = await open('EspressoDialLabReplay', (db) => db.createObjectStore('lastReplay'));
    await new Promise((resolve, reject) => {
      const tx = replay.transaction('lastReplay', 'readwrite');
      tx.objectStore('lastReplay').put({
        shotId: shot.id, blob, mimeType, byteSize: blob.size, videoW: 32, videoH: 32, durationS: 0.35, samples: [],
      }, 'last');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    replay.close();
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { bean, shot });
  assert.deepEqual(replayBytes.slice(0, 4), [0x1a, 0x45, 0xdf, 0xa3]);
  await page.reload();
  const nav = (name) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true });
  const waking = (enabled) => page.waitForFunction((enabled) =>
    window.testShell.calls.filter(({ method }) => method === 'keepAwake').at(-1)?.args.enabled === enabled, enabled);
  await waking(true);
  await nav('History').click();
  await waking(false);
  const card = page.getByTestId('history-shot-card').filter({ hasText: 'Recorded test entry' });
  const chart = card.getByTestId('history-recorded-chart');
  await chart.scrollIntoViewIfNeeded();
  await chart.getByRole('img', { name: 'Pressure (bar)', exact: true }).waitFor();
  await chart.getByTestId('history-measured-pressure').waitFor({ state: 'attached' });
  const profile = card.getByTestId('history-shot-profile');
  assert.equal(await profile.evaluate((element) => element.open), false);
  assert.ok(await page.getByTestId('history-recorded-chart').locator('svg').count() < 17);
  for (const name of ['Pressure', 'Weight', 'Flow', 'Combined']) {
    const tab = chart.getByRole('button', { name, exact: true });
    await tab.click();
    assert.equal(await tab.getAttribute('aria-pressed'), 'true');
  }
  await chart.getByText('Shaded pre-infusion').waitFor();
  await chart.getByText('Explore chart').click();
  await chart.getByRole('slider', { name: 'Explore shot time' }).waitFor();
  await profile.locator('summary').first().click();
  await profile.getByText('18.5 g', { exact: true }).waitFor();
  assert.equal(await profile.getByTestId('shot-pressure-chart').count(), 0);
  await profile.locator('summary').first().click();
  const old = page.getByTestId('history-shot-card').filter({ hasText: 'Older manual shot' });
  assert.equal(await old.getByTestId('history-recorded-chart').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);

  await card.getByRole('button', { name: 'Share shot', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Share shot' });
  await share.getByAltText('Preview of shot card').waitFor();
  await share.getByRole('button', { name: 'Share PNG' }).click();
  await share.getByText(/Share sheet opened/).waitFor();
  const bytes = (entry) => Uint8Array.from(entry.bytes, (char) => char.charCodeAt(0));
  const json = (entry) => JSON.parse(new TextDecoder().decode(bytes(entry)));
  const files = () => page.evaluate(() => window.testShell.files);
  assert.equal((await files()).at(-1).mimeType, 'image/png');
  await share.getByRole('button', { name: 'Close' }).click();
  await share.waitFor({ state: 'hidden' });

  await card.getByTestId('history-shot-diagnostics-export').click();
  await card.getByText(/Saved verified-lab-replay-accepted-shot-pressure\.json and verified/).waitFor();
  assert.deepEqual(json((await files()).at(-1)).labPressureCurve, shot.labPressureCurve);
  await page.evaluate(() => { window.testShell.next = 'cancel'; });
  await card.getByTestId('history-shot-diagnostics-export').click();
  await card.getByText(/Cancelled lab-replay-accepted-shot-pressure\.json/).waitFor();
  await page.evaluate(() => { window.testShell.next = 'fail'; });
  await card.getByTestId('history-shot-diagnostics-export').click();
  await card.getByRole('alert').getByText(/Failed to save.*provider failed/).waitFor();
  await card.getByTestId('history-lab-shot-replay-export').click();
  await card.getByText(/Saved verified-lab-replay-accepted-shot\.webm and verified/).waitFor();
  const [video, pressure] = (await files()).slice(-2);
  assert.deepEqual([...bytes(video)], replayBytes);
  assert.equal(json(pressure).shotId, shot.id);
  assert.equal(await old.getByTestId('history-lab-shot-replay-export').count(), 0);

  await card.getByTestId('history-share-shot').click();
  const issue = page.getByRole('dialog', { name: 'Report issue' });
  await issue.getByRole('textbox').fill('Camera shifted during the test.');
  assert.equal((await files()).length, 4);
  await issue.getByRole('button', { name: 'Share', exact: true }).click();
  await issue.getByText(/Check that the JSON is attached/).waitFor();
  const attachment = (await files()).at(-1);
  assert.equal(attachment.mimeType, 'application/json');
  assert.equal(attachment.filename, 'lab-replay-accepted-shot-pressure.json');
  assert.equal(attachment.share, true);
  assert.equal(attachment.feedback, true);
  assert.equal(json(attachment).testerFeedback, 'Camera shifted during the test.');
  await page.evaluate(() => { window.testShell.next = 'fail'; });
  await issue.getByRole('button', { name: 'Share', exact: true }).click();
  await issue.getByText(/Use Save JSON and attach/).waitFor();
  await issue.getByRole('button', { name: 'Save JSON' }).click();
  await issue.getByText(/Attach the diagnostic JSON manually/).waitFor();
  await issue.getByRole('button', { name: 'Done' }).click();

  await page.getByTitle('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Report a problem', exact: true }).click();
  const report = page.getByRole('dialog', { name: 'Report a problem' });
  await report.getByRole('checkbox', { name: /I agree to share/ }).check();
  await report.getByRole('button', { name: 'Share file' }).click();
  await report.getByText(/Share sheet opened/).waitFor();
  assert.equal((await files()).at(-1).mimeType, 'application/json');
  assert.deepEqual(pageErrors, []);
  console.log('PASS Android-mode preparation, mobile History chart and direct sharing, verified file receipts, replay identity, and both JSON reporting routes');
} finally {
  await browser?.close();
  await server.kill();
}
