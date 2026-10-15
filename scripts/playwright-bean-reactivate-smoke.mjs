import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PREVIEW_PORT = 4176;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}/`;
const FINISHED_SECTION_KEY = 'espresso-dialin.beans-finished-section-open';

async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error(`Server not ready at ${url}`);
}

async function seedBeansForSmoke(page) {
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
        const tx = idb.transaction(['settings', 'beans', 'recipes'], 'readwrite');
        tx.objectStore('settings').put({
          id: 'global',
          grinderModel: 'Sette 270Wi',
          flairEnabled: false,
          lastSelectedBeanId: 'smoke-bean-a',
        });
        tx.objectStore('beans').put({
          id: 'smoke-bean-a',
          name: 'Smoke Alpha',
          roaster: 'Roaster A',
          roastType: 'Medium',
          roastDate: '2026-10-01',
          storageType: 'bag',
          isFinished: false,
          createdAt: '2026-10-01T00:00:00.000Z',
        });
        tx.objectStore('beans').put({
          id: 'smoke-bean-b',
          name: 'Smoke Beta',
          roaster: 'Roaster B',
          roastType: 'Medium',
          roastDate: '2026-10-02',
          storageType: 'bag',
          isFinished: false,
          createdAt: '2026-10-02T00:00:00.000Z',
        });
        tx.objectStore('recipes').put({
          id: 'smoke-recipe-a',
          beanId: 'smoke-bean-a',
          targetTimeMinS: 27,
          targetTimeMaxS: 32,
          targetDoseG: 18,
          targetYieldG: 36,
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

async function readBeanFinished(page, beanId) {
  return page.evaluate((id) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('EspressoDialDB');
      req.onerror = () => reject(req.error);
      req.onsuccess = (event) => {
        const idb = event.target.result;
        const tx = idb.transaction('beans', 'readonly');
        const get = tx.objectStore('beans').get(id);
        get.onsuccess = () => {
          idb.close();
          resolve(get.result?.isFinished === true);
        };
        get.onerror = () => reject(get.error);
      };
    });
  }, beanId);
}

async function main() {
  const preview = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(PREVIEW_PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  let previewPid = preview.pid;
  const killPreview = () => {
    if (previewPid) {
      try {
        process.kill(previewPid, 'SIGTERM');
      } catch {
        // already exited
      }
      previewPid = null;
    }
  };

  try {
    await waitForServer(PREVIEW_URL);
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(PREVIEW_URL, { waitUntil: 'domcontentloaded' });
    await seedBeansForSmoke(page);
    await page.reload({ waitUntil: 'networkidle' });

    const beanSelect = page.locator('select').filter({ hasText: 'Smoke Alpha' }).first();
    await beanSelect.waitFor({ timeout: 15_000 });

    await page.getByTestId('mark-bean-finished').click();
    await page.getByTestId('bean-finished-toast').waitFor();
    await delay(500);
    if (!(await readBeanFinished(page, 'smoke-bean-a'))) {
      throw new Error('Bean should be finished after mark finished');
    }

    await page.getByRole('button', { name: 'Beans', exact: true }).click();
    await page.getByText('Past logged beans & profiles').waitFor();

    const finishedToggle = page.getByTestId('beans-finished-section-toggle');
    await finishedToggle.waitFor();
    await expectButtonText(finishedToggle, 'Finished (1)');
    await finishedToggle.click();
    await page.getByTestId('mark-bean-active').waitFor();

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Beans', exact: true }).click();
    const sectionOpen = await page.evaluate((key) => localStorage.getItem(key), FINISHED_SECTION_KEY);
    if (sectionOpen !== '1') {
      throw new Error('Finished section open state should persist as expanded');
    }
    await page.getByTestId('bean-row-finished').filter({ hasText: 'Smoke Alpha' }).waitFor();

    await page.getByTestId('mark-bean-active').click();
    await delay(500);

    if (await readBeanFinished(page, 'smoke-bean-a')) {
      throw new Error('Bean should be active after mark active');
    }
    await page.getByTestId('bean-row-active').filter({ hasText: 'Smoke Alpha' }).waitFor();

    await browser.close();
    console.log('Playwright bean reactivate smoke passed.');
  } finally {
    killPreview();
  }
}

async function expectButtonText(locator, expected) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const text = (await locator.textContent())?.trim() ?? '';
    if (text.includes(expected)) return;
    await delay(100);
  }
  throw new Error(`Expected button to include "${expected}", got "${await locator.textContent()}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
