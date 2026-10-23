import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { waitForServer } from './lib/previewServer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4173;

async function clearDb(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const del = indexedDB.deleteDatabase('EspressoDialDB');
    del.onsuccess = () => resolve();
    del.onerror = () => resolve();
    del.onblocked = () => resolve();
  }));
}

async function seedDb(page) {
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
          lastSelectedBeanId: 'weigh-bean',
          smartScaleDeviceId: 'timemore-dot',
        });
        tx.objectStore('beans').put({
          id: 'weigh-bean',
          name: 'Weigh Smoke',
          roaster: 'Test',
          roastType: 'Medium',
          roastDate: '2026-10-01',
          storageType: 'bag',
          isFinished: false,
          createdAt: '2026-10-01T00:00:00.000Z',
        });
        tx.objectStore('recipes').put({
          id: 'weigh-recipe',
          beanId: 'weigh-bean',
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

function startScalePreview() {
  const child = spawn('npm', ['run', 'preview:scale'], {
    cwd: ROOT,
    stdio: 'pipe',
    detached: true,
  });
  child.unref();
  const kill = async () => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // exited
      }
    }
    await delay(400);
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // exited
    }
  };
  return { kill };
}

async function main() {
  const preview = startScalePreview();
  const url = `http://127.0.0.1:${PORT}/`;
  await waitForServer(url);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await clearDb(page);
  await seedDb(page);
  await page.goto(url, { waitUntil: 'networkidle' });

  const transport = page.locator('select[aria-label="Scale transport"]');
  await transport.waitFor({ timeout: 15_000 });
  await transport.selectOption('sim');
  await page.getByRole('button', { name: 'Connect scale' }).click();
  await page.getByText(/Scale (on|72%)/).waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: /Open weighing view/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Live scale weight' });
  await dialog.waitFor({ state: 'visible' });
  await page.getByText('18.0 g ·').waitFor();
  await page.getByText('72% battery').waitFor();

  await page.getByRole('button', { name: 'Close weighing view' }).click();
  await dialog.waitFor({ state: 'hidden' });

  await browser.close();
  await preview.kill();
  console.log('weighing-view smoke passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
