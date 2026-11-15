import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const cases = [
  ['Auckland NZDT before midnight', 'Pacific/Auckland', '2026-01-19T10:59:59Z', '2026-01-19'],
  ['Auckland NZDT at midnight', 'Pacific/Auckland', '2026-01-19T11:00:00Z', '2026-01-20'],
  ['Auckland NZDT before UTC midnight', 'Pacific/Auckland', '2026-01-19T23:59:59Z', '2026-01-20'],
  ['Auckland NZDT at UTC midnight', 'Pacific/Auckland', '2026-01-20T00:00:00Z', '2026-01-20'],
  ['Auckland NZST before midnight', 'Pacific/Auckland', '2026-06-19T11:59:59Z', '2026-06-19'],
  ['Auckland NZST at midnight', 'Pacific/Auckland', '2026-06-19T12:00:00Z', '2026-06-20'],
  ['Adelaide before midnight', 'Australia/Adelaide', '2026-01-19T13:29:59Z', '2026-01-19'],
  ['Adelaide at midnight', 'Australia/Adelaide', '2026-01-19T13:30:00Z', '2026-01-20'],
  ['Los Angeles before midnight', 'America/Los_Angeles', '2026-01-20T07:59:59Z', '2026-01-19'],
  ['Los Angeles at midnight', 'America/Los_Angeles', '2026-01-20T08:00:00Z', '2026-01-20'],
  ['Los Angeles before UTC midnight', 'America/Los_Angeles', '2026-01-19T23:59:59Z', '2026-01-19'],
  ['Los Angeles at UTC midnight', 'America/Los_Angeles', '2026-01-20T00:00:00Z', '2026-01-19'],
];

// Use the schema already opened by the app and keep each fixture in its own browser context.
function accessBean({ bean, grinderModel } = {}) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = bean
        ? db.transaction(['settings', 'beans', 'recipes'], 'readwrite')
        : db.transaction('beans', 'readonly');
      let storedBean;
      tx.oncomplete = () => {
        db.close();
        resolve(storedBean);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
      if (bean) {
        tx.objectStore('settings').put({
          id: 'global', grinderModel, flairEnabled: false, lastSelectedBeanId: bean.id,
        });
        tx.objectStore('beans').put(bean);
        tx.objectStore('recipes').put({
          id: 'thaw-recipe', beanId: bean.id, targetDoseG: 18, targetYieldG: 36,
          targetTimeMinS: 27, targetTimeMaxS: 32,
        });
      } else {
        const get = tx.objectStore('beans').get('thaw-bean');
        get.onsuccess = () => { storedBean = get.result; };
      }
    };
  });
}

async function verifyCase(browser, url, [label, timezoneId, instant, expectedDate], index) {
  const page = await browser.newPage({ timezoneId });
  try {
    await page.clock.setFixedTime(new Date(instant));
    await page.goto(url, { waitUntil: 'networkidle' });

    // Earlier thaw was five calendar days ago. The last case exercises undo back to null.
    const previousThaw = new Date(`${expectedDate}T00:00:00Z`);
    previousThaw.setUTCDate(previousThaw.getUTCDate() - 5);
    const thawDate = index === cases.length - 1 ? null : previousThaw.toISOString().slice(0, 10);
    const bean = {
      id: 'thaw-bean', name: 'Frozen test beans', roastType: 'Medium', roastDate: '2025-12-01',
      storageType: 'frozen', freezeDate: '2025-12-04', thawDate, thawHistory: [],
    };
    const useSette = index % 2 === 0;
    const grinderModel = useSette ? 'Sette 270Wi' : 'Sunbeam Barista Max';
    await page.evaluate(accessBean, { bean, grinderModel });
    await page.reload({ waitUntil: 'networkidle' });

    const age = days => page.getByTestId('dial-bean-card')
      .getByText(`Effective age: ${days} days`, { exact: true }).waitFor();
    const grind = value => page.getByTestId('grind-adjustment-card')
      .getByText(value, { exact: true }).waitFor();
    const oldAge = thawDate ? 8 : 3;
    const freshGrind = useSette ? '14-B' : '13';
    const oldGrind = thawDate ? (useSette ? '14-D' : '15') : freshGrind;
    const undo = page.getByRole('button', { name: 'Undo thaw' });

    await age(oldAge);
    await grind(oldGrind);
    await page.getByRole('button', { name: 'Thaw new bag' }).click();
    await undo.waitFor();
    const stored = await page.evaluate(accessBean);
    assert.deepEqual(stored, { ...bean, thawDate: expectedDate, thawHistory: [{ thawDate }] });
    await age(3);
    await grind(freshGrind);

    await undo.click();
    await undo.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(accessBean), bean);
    await age(oldAge);
    await grind(oldGrind);
    console.log(`PASS ${label}: ${instant} → ${expectedDate}, age ${oldAge} → 3 → ${oldAge}, ${grinderModel} ${oldGrind} → ${freshGrind} → ${oldGrind}`);
  } finally {
    await page.close();
  }
}

const preview = startPreviewServer(4189);
let browser;
let failed = 0;
try {
  await waitForServer(preview.url);
  browser = await chromium.launch();
  for (const [index, scenario] of cases.entries()) {
    try {
      await verifyCase(browser, preview.url, scenario, index);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${scenario[0]}: ${error.message}`);
    }
  }
} finally {
  await browser?.close();
  await preview.kill();
}
console.log(`Thaw / Undo: ${cases.length - failed} passed, ${failed} failed.`);
process.exitCode = failed ? 1 : 0;
