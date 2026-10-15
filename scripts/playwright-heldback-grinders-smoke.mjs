import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PREVIEW_PORT = 4174;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}/`;

const GRINDERS = [
  {
    id: 'Breville Barista Express (BES870/875)',
    startLabel: 'zero + 5',
    fieldLabel: 'Upper burr position',
  },
  {
    id: 'DF64 Gen 2',
    startLabel: 'zero + 12',
    fieldLabel: 'Burr-touch zero',
  },
  {
    id: 'DF54',
    startLabel: 'zero + 15',
    fieldLabel: 'Burr-touch zero',
  },
  {
    id: 'Timemore Sculptor 064S',
    startLabel: '1.5',
    fieldLabel: null,
  },
];

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

async function seedOnboardingComplete(page) {
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
          onboardingComplete: true,
        });
        tx.objectStore('beans').put({
          id: 'smoke-bean',
          name: 'Smoke',
          roastType: 'Medium',
          roastDate: '2026-10-01',
        });
        tx.objectStore('recipes').put({
          id: 'smoke-recipe',
          beanId: 'smoke-bean',
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
    await seedOnboardingComplete(page);
    await page.reload({ waitUntil: 'networkidle' });

    await page.getByRole('button', { name: /settings/i }).first().click();
    await page.waitForSelector('text=Preferences & Settings');
    const settingsPanel = page
      .locator('h3')
      .filter({ hasText: 'Preferences & Settings' })
      .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
    const grinderSelect = settingsPanel
      .locator('label')
      .filter({ hasText: 'Primary grinder' })
      .locator('xpath=following-sibling::select[1]');

    for (const grinder of GRINDERS) {
      await grinderSelect.selectOption(grinder.id);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await grinderSelect.inputValue()) === grinder.id) break;
        await delay(100);
      }
      const selectedValue = await grinderSelect.inputValue();
      if (selectedValue !== grinder.id) {
        throw new Error(`Select value ${selectedValue} !== ${grinder.id}`);
      }
      const body = await page.locator('body').innerText();
      if (!body.includes(grinder.id) && !body.includes(grinder.id.split(' ')[0])) {
        throw new Error(`Grinder ${grinder.id} not visible after select`);
      }
      if (grinder.fieldLabel) {
        await page.getByText(grinder.fieldLabel, { exact: false }).first().waitFor({ timeout: 10_000 });
      }
    }

    await browser.close();
    console.log('Playwright held-back grinder smoke passed.');
  } finally {
    killPreview();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
