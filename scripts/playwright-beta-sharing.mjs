import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { validateContribution } from '../src/beta/contribution.js';
import { v1Bean, v1Shot, v10Shot } from '../src/transfer/historicalFixtures.js';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const server = startPreviewServer(4203);
let browser;
try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const errors = [];
  const downloads = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('download', (download) => downloads.push(download));
  await page.addInitScript(() => {
    Object.defineProperties(navigator, {
      canShare: { value: () => true },
      share: { value: () => Promise.reject(new DOMException('Cancelled', 'AbortError')) },
    });
  });
  await page.goto(server.url);
  await page.waitForFunction(() => document.body.textContent.includes('grinder'));
  await seed();
  await page.reload();
  const settings = page.getByTitle('Settings', { exact: true });
  await settings.click();
  await page.getByRole('button', { name: 'Report a problem', exact: true }).click();
  const report = page.getByRole('dialog', { name: 'Report a problem', exact: true });
  const preview = report.getByRole('textbox', { name: 'File contents' });
  const consent = report.getByRole('checkbox', { name: /agree to share/ });
  const share = report.getByRole('button', { name: 'Share file' });
  const save = report.getByRole('button', { name: 'Save file' });
  assert.equal(await share.isDisabled(), true);
  assert.equal(await save.isDisabled(), true);
  assert.equal(JSON.parse(await preview.inputValue()).shotDeviceSummary, null);
  await consent.check();
  const description = report.getByRole('textbox', { name: /Describe the problem/ });
  await description.fill('Camera preview resumed');
  assert.equal(await share.isDisabled(), true);
  await consent.check();
  await share.click();
  await report.getByText(/Cancelled/).waitFor();
  assert.equal(downloads.length, 0);
  const reportDownloadReady = page.waitForEvent('download');
  await save.click();
  const reportDownload = await reportDownloadReady;
  assert.equal(reportDownload.suggestedFilename(), 'espresso-problem-report.json');
  const problem = JSON.parse(await readFile(await reportDownload.path(), 'utf8'));
  assert.equal(problem.description, 'Camera preview resumed');
  assert.equal(problem.platform, 'web');
  assert.match(problem.build.gitSha, /^[0-9a-f]{40}$/);
  if (process.env.DIALIN_EXPECTED_BUILD_SHA) assert.equal(problem.build.gitSha, process.env.DIALIN_EXPECTED_BUILD_SHA);
  await report.getByRole('button', { name: 'Close' }).click();
  console.log('PASS no-shot report, exact preview, renewed consent, cancellation and local save');

  await seed([v1Bean], [v1Shot, v10Shot, { id: 'early-with-missing-timestamp', actualYieldG: 0 }]);
  await page.reload();
  await settings.click();
  await page.getByRole('button', { name: 'Contribute shot data', exact: true }).click();
  const contribution = page.getByRole('dialog', { name: 'Contribute shot data' });
  const selection = contribution.getByRole('group', { name: 'Select saved shots' });
  await selection.getByRole('checkbox', { name: /^Shot 1/ }).check();
  await selection.getByRole('checkbox', { name: /^Shot 2/ }).check();
  await contribution.getByRole('button', { name: 'Preview contribution (2)', exact: true }).click();
  const contributionText = contribution.getByRole('textbox', { name: 'File contents' });
  await contributionText.waitFor();
  assert.equal(JSON.parse(await contributionText.inputValue()).records.length, 2);
  assert.equal(await contribution.getByRole('button', { name: 'Share file' }).isDisabled(), true);
  await selection.getByRole('checkbox', { name: /All eligible saved shots/ }).check();
  await contribution.getByRole('button', { name: 'Preview contribution (3)', exact: true }).click();
  await contributionText.waitFor();
  const reviewed = await contributionText.inputValue();
  assert.doesNotMatch(reviewed, /Earliest saved shot|early-with-missing-timestamp|bean-early/);
  await contribution.getByRole('checkbox', { name: /agree to share/ }).check();
  const datasetReady = page.waitForEvent('download');
  await contribution.getByRole('button', { name: 'Save file' }).click();
  const dataset = await datasetReady;
  const savedText = await readFile(await dataset.path(), 'utf8');
  assert.equal(savedText, reviewed);
  assert.deepEqual(await validateContribution(JSON.parse(savedText)), { records: 3, distinctFingerprints: 3 });
  const original = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const store = open.result;
      const request = store.transaction('shots').objectStore('shots').get('shot-early');
      request.onsuccess = () => { store.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    };
  }));
  assert.deepEqual(original, v1Shot);
  console.log('PASS multi-shot and all-shot selection, exact saved contents, privacy and untouched original record');

  await contribution.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const profile = page.getByTestId('history-shot-profile').first();
  await profile.getByText('Shot profile', { exact: true }).click();
  await profile.getByText('Share Shot', { exact: true }).click();
  await profile.getByRole('button', { name: 'Contribute shot data' }).click();
  await contribution.getByRole('button', { name: 'Preview contribution (1)', exact: true }).click();
  await contributionText.waitFor();
  assert.equal(JSON.parse(await contributionText.inputValue()).records.length, 1);
  assert.deepEqual(errors, []);
  console.log('PASS Shot Profile opens a single-shot contribution preview');

  await contribution.getByRole('button', { name: 'Close' }).click();
  const card = profile.getByRole('region', { name: 'Shot card' });
  const historical = await downloadPng(card);
  assert.equal(historical.height, 575);
  await card.getByRole('checkbox', { name: 'Show personal notes' }).check();
  await card.getByRole('checkbox', { name: 'Show bean name' }).check();
  assert.ok((await downloadPng(card)).height > historical.height);
  await card.getByRole('checkbox', { name: 'Show personal notes' }).uncheck();
  await card.getByRole('checkbox', { name: 'Show bean name' }).uncheck();
  assert.deepEqual((await downloadPng(card)).pixels, historical.pixels);
  await profile.getByRole('button', { name: 'Use as bean reference' }).click();
  await seed([], [
    { id: 'manual-png', beanId: v1Bean.id, timestamp: '2026-01-01T00:00:00Z', actualYieldG: 32 },
    { id: 'sensor-png', beanId: v1Bean.id, timestamp: '2026-06-01T00:00:00Z', actualYieldG: 36,
      labPressureCurve: [{ tS: 0, bar: 0 }, { tS: 0.2, bar: 6 }, { tS: 0.4, bar: 9 }],
      scaleFlowCurve: [{ tS: 0, weightG: 0 }, { tS: 0.2, weightG: 1 }, { tS: 0.4, weightG: 2 }] },
  ]);
  await page.reload();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const profiles = page.getByTestId('history-shot-profile');
  const manual = await openCard(profiles.nth(1));
  assert.equal((await downloadPng(manual)).height, 575);
  const tracked = await openCard(profiles.first());
  const trackedPng = await downloadPng(tracked);
  assert.equal(trackedPng.height, 575 + 3 * 180);
  await tracked.getByRole('checkbox', { name: 'Include bean reference' }).check();
  assert.equal((await downloadPng(tracked)).height, trackedPng.height + 340);
  assert.deepEqual(errors, []);
  console.log('PASS real canvas PNG download, historical/manual cards, privacy, pressure and flow, and reference comparison');

  async function openCard(entry) {
    await entry.getByText('Shot profile', { exact: true }).click();
    await entry.getByText('Share Shot', { exact: true }).click();
    return entry.getByRole('region', { name: 'Shot card' });
  }

  async function downloadPng(section) {
    const pending = page.waitForEvent('download');
    await section.getByRole('button', { name: 'Download PNG', exact: true }).click();
    const download = await pending;
    const bytes = await readFile(await download.path());
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const { data: pixels, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 1200);
    assert.ok(info.height > 0);
    const accent = (67 * info.width + 75) * info.channels;
    assert.notDeepEqual(pixels.subarray(0, 4), pixels.subarray(accent, accent + 4));
    return { height: info.height, pixels };
  }

  function seed(beans = [], shots = []) {
    return page.evaluate(({ beans, shots }) => new Promise((resolve, reject) => {
      const request = indexedDB.open('EspressoDialDB');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const store = request.result;
        const tx = store.transaction(['beans', 'shots', 'settings'], 'readwrite');
        tx.oncomplete = () => { store.close(); resolve(); };
        tx.onabort = () => reject(tx.error);
        tx.objectStore('settings').put({ id: 'global', grinderModel: 'Sette 270Wi',
          experiencePreference: 'combined', anonymousUsageStats: false });
        for (const bean of beans) tx.objectStore('beans').add(bean);
        for (const shot of shots) tx.objectStore('shots').add(shot);
      };
    }), { beans, shots });
  }
} finally {
  await browser?.close();
  await server.kill();
}
