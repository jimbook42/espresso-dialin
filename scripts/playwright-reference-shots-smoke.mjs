import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, devices } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const recording = JSON.parse(await readFile(new URL(
  './pressure-label/fixtures/batch-2026-11-03/source/lab-replay-a1efe497-pressure.json', import.meta.url,
), 'utf8'));
const bean = { id: 'b10-bean', name: 'B10 test coffee', roastType: 'Medium' };
const otherBean = { id: 'other-bean', name: 'Another coffee', roastType: 'Medium' };
const timing = { version: 1, clockDriftMs: 0, pressureOriginMs: 100, scaleOriginMs: 2000,
  extractionStartMs: 2000, extractionEndMs: 31000, pressureSource: 'camera',
  scaleSource: 'web-bluetooth', scaleInterrupted: false };
const profile = {
  labPressureCurve: recording.labPressureCurve,
  scaleFlowCurve: [{ tS: 0.125, weightG: 0 }, { tS: 0.375, weightG: 1 }, { tS: 1.25, weightG: 3 }],
};
const shots = [
  { id: 'reference', notes: 'First reference candidate', ...profile, shotProfileTiming: timing },
  { id: 'selected', notes: 'Selected extraction', ...profile,
    shotProfileTiming: { ...timing, pressureOriginMs: 200, extractionStartMs: 2500, scaleOriginMs: 2500 } },
  { id: 'manual', notes: 'Manual extraction' },
  { id: 'other', notes: 'Different bean extraction', beanId: otherBean.id },
  { id: 'historical', notes: 'Historical recording', ...profile },
].map((shot, index) => ({
  beanId: bean.id, timestamp: new Date(Date.UTC(2026, 9, 16, 8 + index)).toISOString(),
  grinderModel: 'Sette 270Wi', actualTimeS: 28, actualDoseG: 18, actualYieldG: 36, tasteProfile: 'balanced',
  ...shot,
}));

function rows(page, seed = null) {
  return page.evaluate((seed) => new Promise((resolve, reject) => {
    const request = indexedDB.open('EspressoDialDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['beans', 'settings', 'shots'], seed ? 'readwrite' : 'readonly');
      for (const [table, values] of Object.entries(seed ?? {})) {
        for (const value of values) tx.objectStore(table).put(value);
      }
      const settings = tx.objectStore('settings').get('history-shot-selections');
      const shots = tx.objectStore('shots').getAll();
      tx.oncomplete = () => { db.close(); resolve({ selections: settings.result, shots: shots.result }); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), seed);
}

const preview = startPreviewServer(4193);
let browser;
try {
  await waitForServer(preview.url);
  browser = await chromium.launch();
  const page = await browser.newPage({ ...devices['Pixel 7'], viewport: { width: 320, height: 720 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  const button = (name) => page.getByRole('button', { name, exact: true });
  const cards = page.getByTestId('history-shot-card');
  const card = (id) => cards.filter({ hasText: shots.find((shot) => shot.id === id).notes });
  const openProfile = (id) => card(id).getByText('Shot profile', { exact: true }).click();
  const favourite = (id) => card(id).getByRole('button', { name: 'Favourite shot' });
  const pressed = page.locator('[aria-pressed="true"]');

  await page.goto(preview.url);
  await page.getByText(/choose|experience|grinder/i).first().waitFor();
  await rows(page, {
    beans: [bean, otherBean], shots, settings: [{ id: 'global', experiencePreference: 'brew',
      grinderModel: 'Sette 270Wi', lastSelectedBeanId: bean.id }],
  });
  await page.reload();
  await button('History').click();
  await card('other').waitFor();
  assert.equal(await cards.count(), 5);
  const original = await rows(page);

  await favourite('reference').click();
  await favourite('reference').and(pressed).waitFor();
  await button('Favourites').click();
  assert.equal(await cards.count(), 1);
  const beanFilter = page.getByRole('combobox', { name: 'Filter History by bean' });
  await beanFilter.selectOption(otherBean.id);
  await page.getByText('No favourites match this filter.').waitFor();
  await beanFilter.selectOption('all');
  await button('Favourites').click();

  await openProfile('reference');
  assert.equal(await card('reference').getByText('Compare with bean reference').count(), 0);
  await button('Use as bean reference').click();
  await button('Remove bean reference').waitFor();
  await page.reload();
  await favourite('reference').and(pressed).waitFor();
  await card('reference').getByText('Bean reference', { exact: true }).waitFor();
  await openProfile('selected');
  await card('selected').getByText('Compare with bean reference', { exact: true }).click();
  const comparison = card('selected').getByTestId('shot-comparison');
  await comparison.getByRole('img', { name: /^Pressure/ }).waitFor();
  const selectedPath = comparison.getByTestId('comparison-selected-series').locator('path');
  const referencePath = comparison.getByTestId('comparison-reference-series').locator('path');
  assert.ok((await selectedPath.getAttribute('d')).match(/M/g).length > 1, 'pressure path breaks on recording gaps');
  assert.ok(await referencePath.getAttribute('stroke-dasharray'));
  assert.notEqual(await selectedPath.getAttribute('d'), await referencePath.getAttribute('d'), 'different extraction origins shift traces');
  await comparison.getByRole('button', { name: 'Weight', exact: true }).click();
  const weightPath = await selectedPath.getAttribute('d');
  assert.equal(weightPath.match(/M/g).length, 2, 'Bluetooth gap starts a new path');
  await comparison.getByRole('button', { name: 'Flow', exact: true }).click();
  assert.match(await selectedPath.getAttribute('d'), /^M[^M]+ H[^M]+$/, 'flow shows one observed interval');
  await comparison.getByText('Selected shot: measured source.', { exact: true }).waitFor();
  const advancedSummary = card('selected').getByText('Advanced pressure and flow', { exact: true });
  const advanced = card('selected').getByTestId('pressure-flow-analytics');
  assert.equal(await advanced.count(), 0);
  await advancedSummary.click();
  await advanced.getByRole('img', { name: 'Pressure (bar) and flow (g/s)' }).waitFor();
  await advanced.getByText('Timed pre-infusion', { exact: true }).waitFor();
  await advanced.getByText('Insufficient paired readings within a pressure range.', { exact: true }).waitFor();
  assert.equal(await advanced.getByTestId('pressure-gap-bridge').count(), 0);

  await openProfile('historical');
  await card('historical').getByText('Compare with bean reference', { exact: true }).click();
  const historical = card('historical').getByTestId('shot-comparison');
  for (const measurement of ['Pressure', 'Weight', 'Flow']) {
    await historical.getByRole('button', { name: measurement, exact: true }).click();
    const aligned = historical.getByRole('img', { name: /Time from extraction start/ });
    const standalone = historical.getByRole('img', { name: /Sensor recording time/ });
    assert.equal(await aligned.getByTestId('comparison-selected-series').count(), 0);
    assert.equal(await standalone.getByTestId('comparison-selected-series').count(), 1);
    await historical.getByText(/Selected shot: .*approximate alignment to extraction/).waitFor();
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await openProfile('manual');
  await card('manual').getByText('Compare with bean reference', { exact: true }).click();
  await card('manual').getByText('Selected shot: pressure unavailable.').waitFor();
  await openProfile('other');
  assert.equal(await card('other').getByText('Compare with bean reference').count(), 0);
  await card('selected').getByRole('button', { name: 'Replace bean reference with this shot' }).click();
  await card('selected').getByRole('button', { name: 'Remove bean reference' }).click();
  await card('selected').getByRole('button', { name: 'Use as bean reference' }).waitFor();
  assert.deepEqual((await rows(page)).shots, original.shots);

  await favourite('reference').click();
  await favourite('reference').and(page.locator('[aria-pressed="false"]')).waitFor();
  await favourite('selected').click();
  await favourite('selected').and(pressed).waitFor();
  await card('selected').getByRole('button', { name: 'Use as bean reference' }).click();
  await card('selected').getByRole('button', { name: 'Remove bean reference' }).waitFor();
  await card('selected').getByRole('button', { name: 'Delete shot' }).click();
  await card('selected').waitFor({ state: 'hidden' });
  assert.deepEqual((await rows(page)).selections.references, []);
  assert.deepEqual((await rows(page)).selections.favouriteIds, []);

  await favourite('manual').click();
  await favourite('manual').and(pressed).waitFor();
  await card('manual').getByRole('button', { name: 'Use as bean reference' }).click();
  await card('manual').getByRole('button', { name: 'Remove bean reference' }).waitFor();
  await button('Beans').click();
  await page.getByTestId('bean-row-active').filter({ hasText: bean.name }).getByTitle('Delete Bean Profile').click();
  await page.getByTestId('bean-row-active').filter({ hasText: bean.name }).waitFor({ state: 'hidden' });
  await button('History').click();
  await card('other').waitFor();
  assert.equal(await cards.count(), 1);
  assert.deepEqual((await rows(page)).selections.references, []);
  assert.deepEqual((await rows(page)).selections.favouriteIds, []);
  assert.deepEqual(errors, []);
  console.log('B10 browser smoke passed on the 320px Android viewport.');
} finally {
  await browser?.close();
  await preview.kill();
}
