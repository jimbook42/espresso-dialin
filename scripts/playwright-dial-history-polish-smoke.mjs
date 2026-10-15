import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const PREVIEW_PORT = 4178;
const SCREENSHOT_DIAL = '/workspace/tickets/6.28-dial-412.png';
const SCREENSHOT_HISTORY = '/workspace/tickets/6.28-history-412.png';
const USER_NOTE = 'Puck prep issue';

async function seedPolishSmoke(page) {
  await page.evaluate((note) => {
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
          roaster: '',
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
          id: 'smoke-shot-learning',
          beanId: 'smoke-bean',
          timestamp: '2026-10-14T11:00:00.000Z',
          grinderModel: 'Sette 270Wi',
          setteMacro: 7,
          setteMicro: 'C',
          actualTimeS: 30,
          tasteProfile: 'balanced',
          actualDoseG: 18,
          actualYieldG: 36,
          wasPurged: true,
        });
        tx.objectStore('shots').put({
          id: 'smoke-shot-latest',
          beanId: 'smoke-bean',
          timestamp: '2026-10-14T12:00:00.000Z',
          grinderModel: 'Sette 270Wi',
          setteMacro: 7,
          setteMicro: 'C',
          actualTimeS: 30,
          tasteProfile: 'balanced',
          actualDoseG: 18,
          actualYieldG: 36,
          wasPurged: true,
          notes: note,
          excludeFromLearning: true,
          knownIssueReason: 'puck_prep',
        });
        tx.oncomplete = () => {
          idb.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, USER_NOTE);
}

async function assertMetricTilesCentered(page, cardLocator) {
  const offCenter = await cardLocator.evaluate((card) => {
    const tiles = card.querySelector('[data-testid="history-shot-metric-tiles"]');
    if (!tiles) return 'missing tiles';
    const cells = [...tiles.children];
    for (const cell of cells) {
      const value = cell.querySelector('strong');
      if (!value) return 'missing value';
      const cellRect = cell.getBoundingClientRect();
      const valueRect = value.getBoundingClientRect();
      const cellCenter = cellRect.left + cellRect.width / 2;
      const valueCenter = valueRect.left + valueRect.width / 2;
      if (Math.abs(cellCenter - valueCenter) > 6) {
        return `value off-center in ${cell.textContent?.slice(0, 12)}`;
      }
      if (valueRect.left - cellRect.left < 4 || cellRect.right - valueRect.right < 4) {
        return `value touches edge in ${cell.textContent?.slice(0, 12)}`;
      }
    }
    return null;
  });
  if (offCenter) throw new Error(`History metric tiles: ${offCenter}`);
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
    await seedPolishSmoke(page);
    await page.reload({ waitUntil: 'networkidle' });

    const grindCard = page.getByTestId('grind-adjustment-card');
    await grindCard.waitFor({ timeout: 15_000 });

    const advisory = grindCard.locator('text=over-yielded');
    await advisory.waitFor({ timeout: 10_000 });

    const lastShotNote = page.getByTestId('grind-card-last-shot-note');
    await lastShotNote.waitFor();
    const lastShotText = await lastShotNote.textContent();
    if (!lastShotText?.includes(USER_NOTE)) {
      throw new Error(`Dial last-shot line missing note: ${lastShotText}`);
    }

    const beanSelect = page.getByTestId('dial-bean-select');
    const optionText = await beanSelect.locator('option').first().textContent();
    if (optionText?.includes('()')) {
      throw new Error(`Blank roaster shows empty parens: ${optionText}`);
    }

    await page.screenshot({ path: SCREENSHOT_DIAL, fullPage: false });

    await page.getByRole('button', { name: 'History' }).click();

    const historyNote = page.getByTestId('history-shot-user-note').first();
    await historyNote.waitFor();
    if (!(await historyNote.textContent())?.includes(USER_NOTE)) {
      throw new Error('History card missing user note');
    }

    const historyCard = page.getByTestId('history-shot-user-note').first().locator('xpath=ancestor::div[@data-testid="history-shot-card"]');
    await historyCard.waitFor();
    const tag = historyCard.getByTestId('history-learning-excluded-tag');
    await tag.waitFor();
    const tagBox = await tag.boundingBox();
    if (!tagBox || tagBox.height > 22) {
      throw new Error(`Learning tag wraps (${tagBox?.height}px tall)`);
    }

    await assertMetricTilesCentered(page, historyCard);
    await page.screenshot({ path: SCREENSHOT_HISTORY, fullPage: false });

    console.log(
      `Dial/history polish smoke passed (${SCREENSHOT_DIAL}, ${SCREENSHOT_HISTORY}).`
    );
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
