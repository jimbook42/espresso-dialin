import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const bean = { id: 'consistency', name: 'Consistency coffee', roastType: 'Medium' };
const otherBean = { id: 'other', name: 'Other coffee', roastType: 'Medium' };
const shots = [undefined, 2, 2, 4, 4, 5].map((shotRating, i) => ({
  id: `shot-${i}`, beanId: bean.id, notes: `Extraction ${i}`, shotRating,
  timestamp: new Date(Date.UTC(2026, 9, 15 + i)).toISOString(),
  grinderModel: 'Sette 270Wi', actualTimeS: 26 + i, actualDoseG: 18, actualYieldG: i ? 36 + i : undefined,
  tasteProfile: 'balanced',
}));
shots.push({ ...shots[5], id: 'other-shot', notes: 'Other coffee extraction', beanId: otherBean.id });

const preview = startPreviewServer(4194);
let browser;
try {
  await waitForServer(preview.url);
  browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 320, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  const button = (name) => page.getByRole('button', { name, exact: true });
  const card = (index) => page.getByTestId('history-shot-card').filter({ hasText: `Extraction ${index}` });
  const openProfile = () => card(0).getByText('Shot profile', { exact: true }).click();
  const rating = (stars) => card(0).getByLabel(`Taste rating ${stars} out of 5`);
  const beanFilter = page.getByRole('combobox', { name: 'Filter History by bean' });
  const details = page.getByTestId('bean-consistency-details');

  await page.goto(preview.url);
  await page.getByText(/choose|experience|grinder/i).first().waitFor();
  await page.evaluate(({ bean, otherBean, shots }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('EspressoDialDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['beans', 'settings', 'shots'], 'readwrite');
      tx.objectStore('beans').put(bean);
      tx.objectStore('beans').put(otherBean);
      tx.objectStore('settings').put({ id: 'global', experiencePreference: 'brew',
        grinderModel: 'Sette 270Wi', lastSelectedBeanId: bean.id });
      for (const shot of shots) tx.objectStore('shots').put(shot);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { bean, otherBean, shots });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await button('History').click();
  await openProfile();
  await card(0).getByText('Unrated', { exact: true }).waitFor();
  await button('Rate 1 star').click();
  await rating(1).waitFor();
  await button('Rate 3 stars').click();
  await rating(3).waitFor();

  // Get through a full offline reopen, then update local data while disconnected.
  await context.setOffline(true);
  await page.reload();
  await button('History').click();
  await rating(3).waitFor();
  await openProfile();
  await card(0).getByRole('button', { name: 'Rate 3 stars', pressed: true }).waitFor();
  await button('Clear rating').click();
  await rating(3).waitFor({ state: 'hidden' });
  await page.reload();
  await button('History').click();
  await openProfile();
  await card(0).getByText('Unrated', { exact: true }).waitFor();

  await button('View bean consistency and ratings').click();
  await details.getByText('5 rated · 1 unrated', { exact: true }).waitFor();
  assert.equal(await beanFilter.inputValue(), bean.id);
  await details.getByText('5 comparable · 1 missing', { exact: true }).first().waitFor();
  await details.getByText('Extraction time median', { exact: true }).waitFor();
  await details.getByText('2 ★ · 27.5 s (2 shots)', { exact: true }).waitFor();
  assert.deepEqual(await details.locator('dl[aria-label="Rating distribution"] dd').allTextContents(), ['0', '2', '0', '2', '1']);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await card(5).getByRole('button', { name: 'Delete shot' }).click();
  await details.getByText('4 rated · 1 unrated', { exact: true }).waitFor();
  await details.getByText('No measurements meet the comparison threshold yet.', { exact: true }).waitFor();
  await beanFilter.selectOption(otherBean.id);
  await page.getByText('Bean consistency and ratings', { exact: true }).click();
  await details.getByText('Too few comparable shots.', { exact: true }).first().waitFor();
  await details.getByText('1 rated · 0 unrated', { exact: true }).waitFor();

  await button('Beans').click();
  const beanRow = page.getByTestId('bean-row-active').filter({ hasText: bean.name });
  await beanRow.getByTitle('Delete Bean Profile').click();
  await beanRow.waitFor({ state: 'hidden' });
  await button('History').click();
  await beanFilter.selectOption('all');
  await page.getByText('Other coffee extraction', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('history-shot-card').count(), 1);
  assert.deepEqual(errors, []);
  console.log('B11 browser smoke passed on a 320px Android viewport, including offline reopen and editing.');
} finally {
  await browser?.close();
  await preview.kill();
}
