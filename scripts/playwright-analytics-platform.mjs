import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const platform = process.argv[2];
assert.ok(['android', 'web'].includes(platform), 'Usage: set DIALIN_PREVIEW_OUT_DIR and pass android or web');
assert.ok(process.env.DIALIN_PREVIEW_OUT_DIR, 'Set DIALIN_PREVIEW_OUT_DIR to the built web assets');
const android = platform === 'android';
const server = startPreviewServer(android ? 4217 : 4218);
let browser;
try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  for (const preference of [undefined, true, false]) {
    const page = await browser.newPage({ serviceWorkers: 'block' });
    if (android) await page.addInitScript(() => { window.CapacitorCustomPlatform = { name: 'android' }; });
    const analyticsRequests = [];
    // Exercise the app's loader decision without contacting any analytics endpoint.
    await page.route(/insights|vercel-scripts|vercel-insights/, async (route) => {
      analyticsRequests.push(route.request().url());
      await route.fulfill({ status: 404 });
    });
    await page.goto(server.url);
    await page.getByText('Choose how you want to use Espresso Dial-In.', { exact: true }).waitFor();
    await page.evaluate(async (saved) => {
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open('EspressoDialDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => resolve(open.result);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('settings', 'readwrite');
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
        tx.objectStore('settings').put({ id: 'global', grinderModel: 'Sette 270Wi',
          experiencePreference: 'combined', ...(saved === undefined ? {} : { anonymousUsageStats: saved }) });
      });
      db.close();
    }, preference);
    analyticsRequests.length = 0;
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTitle('Settings', { exact: true }).click();
    await page.getByRole('heading', { name: 'Preferences & Settings' }).waitFor();
    const toggle = page.getByRole('switch', { name: 'Anonymous usage stats' });
    assert.equal(await toggle.count(), android ? 0 : 1);
    const enabled = !android && preference !== false;
    if (!android) assert.equal(await toggle.getAttribute('aria-checked'), String(enabled));
    assert.equal(await page.evaluate(() => typeof window.va === 'function'), enabled);
    assert.deepEqual(analyticsRequests, enabled ? [new URL('/_vercel/insights/script.js', server.url).href] : []);
    const persisted = await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('EspressoDialDB');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const row = db.transaction('settings').objectStore('settings').get('global');
        row.onerror = () => { db.close(); reject(row.error); };
        row.onsuccess = () => { db.close(); resolve(row.result?.anonymousUsageStats); };
      };
    }));
    assert.equal(persisted, preference);
    await page.close();
  }
  console.log(`PASS ${platform}: analytics loader, Settings and stored preference for default, on and off`);
} finally {
  await browser?.close();
  await server.kill();
}
