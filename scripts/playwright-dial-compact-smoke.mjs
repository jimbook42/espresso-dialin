import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const PREVIEW_PORT = 4177;
const SCREENSHOT_PATH = '/workspace/tickets/6.27-dial-412.png';

async function seedDialCompactSmoke(page) {
  await page.evaluate(() => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('EspressoDialDB', 17);
      req.onupgradeneeded = (event) => {
        const idb = event.target.result;
        for (const [name, keyPath] of [
          ['settings', 'id'],
          ['beans', 'id'],
          ['shots', 'id'],
          ['recipes', 'id'],
        ]) {
          if (!idb.objectStoreNames.contains(name)) {
            idb.createObjectStore(name, { keyPath });
          }
        }
      };
      req.onsuccess = (event) => {
        const idb = event.target.result;
        const tx = idb.transaction(['settings', 'beans', 'recipes', 'shots'], 'readwrite');
        tx.objectStore('settings').put({
          id: 'global',
          grinderModel: 'Sette 270Wi',
          flairEnabled: false,
          lastSelectedBeanId: 'smoke-bean',
        });
        tx.objectStore('beans').put({
          id: 'smoke-bean',
          name: 'Smoke',
          roaster: 'Roaster',
          roastType: 'Dark',
          roastDate: '2026-10-01',
          storageType: 'frozen',
          thawHistory: [{ thawDate: '2026-10-08' }],
          isFinished: false,
          createdAt: '2026-10-01T00:00:00.000Z',
        });
        tx.objectStore('recipes').put({
          id: 'smoke-recipe',
          beanId: 'smoke-bean',
          targetTimeMinS: 27,
          targetTimeMaxS: 32,
          targetDoseG: 18.5,
          targetYieldG: 30,
          brewTemperatureC: 93,
        });
        tx.objectStore('shots').put({
          id: 'smoke-shot-1',
          beanId: 'smoke-bean',
          timestamp: '2026-10-14T12:00:00.000Z',
          grinderModel: 'Sette 270Wi',
          setteMacro: 7,
          setteMicro: 'C',
          actualTimeS: 30,
          tasteProfile: 'balanced',
          actualDoseG: 18,
          actualYieldG: 36,
        });
        tx.oncomplete = () => {
          idb.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

async function main() {
  const preview = startPreviewServer(PREVIEW_PORT);
  let browser;
  let exitCode = 0;

  try {
    await waitForServer(preview.url);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    await page.goto(preview.url, { waitUntil: 'domcontentloaded' });
    await seedDialCompactSmoke(page);
    await page.reload({ waitUntil: 'networkidle' });

    const grindCard = page.getByTestId('grind-adjustment-card');
    await grindCard.waitFor({ timeout: 15_000 });

    const note = page.getByTestId('grind-card-last-shot-note');
    await note.waitFor();

    const cardBox = await grindCard.boundingBox();
    const noteBox = await note.boundingBox();
    if (!cardBox || !noteBox) {
      throw new Error('Could not measure grind card or last-shot note');
    }
    const widthRatio = noteBox.width / cardBox.width;
    if (widthRatio < 0.6) {
      throw new Error(
        `Last-shot note too narrow: ${(widthRatio * 100).toFixed(1)}% of grind card (need ≥60%)`
      );
    }

    await page.getByRole('button', { name: 'Changed basket' }).waitFor();
    await page.getByRole('button', { name: /Apply rec/i }).waitFor();

    const actions = page.getByTestId('dial-bean-actions');
    await actions.waitFor();
    const thawInRow = actions.getByRole('button', { name: 'Thaw new bag' });
    const markInRow = actions.getByTestId('mark-bean-finished');
    await thawInRow.waitFor();
    await markInRow.waitFor();

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    console.log(`Dial compact smoke passed (screenshot: ${SCREENSHOT_PATH}).`);
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await preview.kill();
  }

  process.exit(exitCode);
}

main();
