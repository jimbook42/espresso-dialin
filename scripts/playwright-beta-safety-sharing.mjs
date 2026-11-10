import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const server = startPreviewServer(4189);
const screenshots = process.env.B06B_SCREENSHOTS || join(tmpdir(), 'dialin-b06b-screenshots');
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const id = 'beta-save-1';
let browser;

try {
  await waitForServer(server.url);
  await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, acceptDownloads: true,
    permissions: ['camera'], serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  let scriptLoads = 0;
  const customRequests = [];
  await page.route('**/_vercel/insights/**', async (route) => {
    if (route.request().url().endsWith('/script.js')) {
      scriptLoads++;
      await route.fulfill({ contentType: 'text/javascript', body: '' });
    } else {
      customRequests.push(route.request().url());
      await route.fulfill({ status: 204, body: '' });
    }
  });
  await page.addInitScript(() => {
    window.shareMode = 'cancelled';
    window.shareCalls = [];
    Object.defineProperty(navigator, 'canShare', { value: ({ files }) => files.length > 0 && window.shareMode !== 'fallback' });
    Object.defineProperty(navigator, 'share', { value: async ({ files, title }) => {
      window.shareCalls.push({ title, files: await Promise.all(files.map(async (file) => ({
        name: file.name, type: file.type, body: await file.text(),
      }))) });
      if (window.shareMode === 'cancelled') throw new DOMException('cancelled', 'AbortError');
    } });
  });
  await page.goto(server.url);
  await page.getByRole('radio', { name: 'Combined', exact: true }).waitFor();
  await page.evaluate((id) => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['settings', 'beans', 'recipes', 'shots'], 'readwrite');
      tx.objectStore('settings').put({
        id: 'global', experiencePreference: 'combined', grinderModel: 'Sette 270Wi',
        lastSelectedBeanId: 'beta-coffee', shotStartCountdown: 0, preInfusionEnabled: false,
      });
      tx.objectStore('beans').put({ id: 'beta-coffee', name: 'Beta test coffee', roastType: 'Medium' });
      tx.objectStore('recipes').put({ id: 'beta-recipe', beanId: 'beta-coffee', targetDoseG: 18,
        targetYieldG: 36, targetTimeMinS: 27, targetTimeMaxS: 32 });
      tx.objectStore('shots').put({ id, beanId: 'beta-coffee', timestamp: '2026-11-04T12:00:00Z',
        actualTimeS: 30, labPressureCurve: [{ tS: 0, bar: 1 }], notes: 'Historical record' });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), id);
  await page.reload();
  await page.getByTestId('dial-bean-card').waitFor();
  await page.waitForFunction(() => window.vaq?.some(([type]) => type === 'beforeSend'));
  assert.equal(scriptLoads, 1);
  const settings = page.getByTitle('Settings', { exact: true });
  await settings.click();
  const usage = page.getByRole('switch', { name: 'Anonymous usage stats' });
  await usage.scrollIntoViewIfNeeded();
  assert.equal(await usage.getAttribute('aria-checked'), 'true');
  await usage.click();
  await page.getByRole('switch', { name: 'Anonymous usage stats', checked: false }).waitFor();
  await page.waitForFunction(() => {
    const callback = window.vaq?.find(([type]) => type === 'beforeSend')?.[1];
    return callback?.({ type: 'pageview', url: location.href }) === null;
  });
  await page.waitForFunction(() => {
    const toggle = document.querySelector('[aria-label="Anonymous usage stats"]');
    return toggle && !toggle.disabled;
  });
  await page.screenshot({ path: join(screenshots, 'settings-usage-stats-off.png'), animations: 'disabled' });
  await page.reload();
  await page.getByTestId('dial-bean-card').waitFor();
  await settings.click();
  await page.getByRole('switch', { name: 'Anonymous usage stats', checked: false }).waitFor();
  assert.equal(scriptLoads, 1, 'saved Off prevents even loading the Vercel script');
  assert.equal(await page.evaluate(() => Boolean(window.va)), false);
  await page.getByRole('button', { name: 'Close settings' }).click();
  console.log('PASS default page-view opt-in, immediate opt-out, persisted Off and no script injection after reload');

  await page.getByTestId('dial-yield-tile').locator('input').fill('36');
  await page.getByTestId('dial-time-tile').locator('input').fill('30');
  await page.getByRole('button', { name: 'Balanced', exact: true }).click();
  await page.getByRole('button', { name: 'Log shot & calculate grind adjustment', exact: true }).click();
  await page.getByTestId('saved-share-shot').click();
  const dialog = page.getByRole('dialog', { name: 'Share shot' });
  await dialog.getByLabel('What went wrong? (optional)').fill('Scale stopped reporting');
  await page.screenshot({ path: join(screenshots, 'share-shot.png') });
  await dialog.getByRole('button', { name: 'Share', exact: true }).click();
  await page.waitForFunction(() => window.shareCalls.length === 1);
  assert.equal(await dialog.isVisible(), true, 'cancelled mock share leaves the dialog open');
  assert.equal(await dialog.getByText('Open email').count(), 0);
  await page.evaluate(() => { window.shareMode = 'share'; });
  await dialog.getByRole('button', { name: 'Share', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const native = await page.evaluate(() => window.shareCalls.at(-1));
  assert.equal(native.files.length, 1);
  const newShot = JSON.parse(native.files[0].body);
  assert.notEqual(newShot.shotId, id);
  assert.equal(newShot.diagnosticsVersion, 2);
  assert.equal(newShot.testerFeedback, 'Scale stopped reporting');
  assert.equal(newShot.exportBuild.appVersion, version);
  console.log('PASS after-save share uses persisted shot, native JSON mock and cancellation');

  await page.reload();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const oldCard = page.getByTestId('history-shot-card').filter({ hasText: 'Historical record' });
  await oldCard.getByTestId('history-share-shot').click();
  await page.evaluate(() => { window.shareMode = 'fallback'; });
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Share', exact: true }).click();
  const downloaded = await downloading;
  const oldShot = JSON.parse(await readFile(await downloaded.path(), 'utf8'));
  assert.equal(oldShot.shotId, id);
  assert.deepEqual(oldShot.labPressureCurve, [{ tS: 0, bar: 1 }]);
  assert.equal(oldShot.scaleDiagnostics.availability, 'unavailable');
  assert.equal(oldShot.recordingBuild, null);
  await dialog.getByText('Attach the downloaded diagnostic JSON file before sending.').waitFor();
  const mailto = new URL(await dialog.getByRole('link', { name: 'Open email' }).getAttribute('href'));
  assert.equal(mailto.pathname, 'TullLabs@outlook.com');
  assert.equal(mailto.searchParams.get('subject'), `Espresso Dial-In shot ${id.slice(0, 8)} v${version}`);
  await dialog.getByRole('button', { name: 'Done' }).click();
  console.log('PASS selected historical shot after reload, explicit unavailable markers, JSON and email fallback');

  await page.evaluate(() => {
    const svg = '<svg width="240" height="240" xmlns="http://www.w3.org/2000/svg"><rect width="240" height="240" fill="#eee"/><circle cx="120" cy="120" r="98" fill="#252a2e"/><path d="M120 120h69" stroke="#e5e8e9" stroke-width="4"/><circle cx="120" cy="120" r="6" fill="#777"/></svg>';
    window.__labGaugeTapFixture = { src: 'data:image/svg+xml,' + encodeURIComponent(svg), autoFreeze: true,
      mirror: false, initialFocus: { x: 120, y: 120 }, initialHalf: 115 };
  });
  await page.getByRole('button', { name: 'Pressure', exact: true }).click();
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await page.getByRole('button', { name: 'Calibrate gauge', exact: true }).click();
  const viewport = page.getByTestId('gauge-tap-viewport');
  await page.getByText(/Frame held.*centre marker/i).waitFor();
  for (const point of [{ x: 120, y: 120 }, { x: 72, y: 58 }, { x: 182, y: 72 }]) {
    const box = await viewport.boundingBox();
    const crop = await page.evaluate(() => window.__labGaugeTapViewState.crop);
    await viewport.click({ position: {
      x: (point.x - crop.cx + crop.half) / (2 * crop.half) * box.width,
      y: (point.y - crop.cy + crop.half) / (2 * crop.half) * box.height,
    } });
    await page.getByRole('button', { name: 'Confirm tap' }).click();
  }
  await page.getByText("This gauge isn't supported yet. Espresso Dial-In currently reads the original Flair 58 gauge.").waitFor();
  assert.equal(await page.getByRole('button', { name: 'Accept calibration' }).count(), 0);
  await page.screenshot({ path: join(screenshots, 'unsupported-gauge.png') });
  await page.getByRole('button', { name: 'Send us a clip' }).click();
  const clipDialog = page.getByRole('dialog', { name: 'Send us a clip' });
  await clipDialog.getByLabel('What went wrong? (optional)').fill('Light pointer');
  await clipDialog.getByLabel('Video from your device (optional)').setInputFiles({
    name: 'chosen.mp4', mimeType: 'video/mp4', buffer: Buffer.from('test file'),
  });
  assert.equal(await page.evaluate(() => window.shareCalls.length), 0);
  await page.evaluate(() => { window.shareMode = 'share'; });
  await clipDialog.getByRole('button', { name: 'Share', exact: true }).click();
  await clipDialog.waitFor({ state: 'hidden' });
  const clip = await page.evaluate(() => window.shareCalls[0]);
  assert.deepEqual(clip.files.map((file) => file.name), ['dial-in-gauge-feedback.json', 'chosen.mp4']);
  assert.equal(JSON.parse(clip.files[0].body).compatibility.reason, 'light-pointer');
  await page.getByRole('button', { name: 'Send us a clip' }).click();
  await clipDialog.getByLabel('Video from your device (optional)').setInputFiles({
    name: 'chosen.mp4', mimeType: 'video/mp4', buffer: Buffer.from('test file'),
  });
  await page.evaluate(() => { window.shareMode = 'fallback'; });
  const clipDownload = page.waitForEvent('download');
  await clipDialog.getByRole('button', { name: 'Share', exact: true }).click();
  assert.equal((await clipDownload).suggestedFilename(), 'dial-in-gauge-feedback.json');
  await clipDialog.getByText(/Attach your selected video manually as well/).waitFor();
  await clipDialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByText('Tap anywhere to freeze a rest frame').waitFor();
  await viewport.click();
  await page.getByText(/Frame held.*centre marker/i).waitFor();
  assert.deepEqual(customRequests, []);
  console.log('PASS unsupported test dial, selected clip and summary mock share, retry, no custom requests');
} finally {
  await browser?.close();
  await server.kill();
}
