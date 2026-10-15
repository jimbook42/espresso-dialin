import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PREVIEW_PORT = 4174;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}/`;

const BARISTA_EXPRESS_ID = 'Breville Barista Express (BES870/875)';
const BARISTA_PRO_ID = 'Breville Barista Pro (BES878)';
const BARISTA_TOUCH_ID = 'Breville Barista Touch (BES880)';
const DF64_ID = 'DF64 Gen 2';

const GRINDERS = [
  {
    id: BARISTA_EXPRESS_ID,
    fieldLabel: 'Upper burr position',
  },
  {
    id: BARISTA_PRO_ID,
    fieldLabel: 'Upper burr position',
    expectedStartDial: '15',
  },
  {
    id: BARISTA_TOUCH_ID,
    fieldLabel: 'Upper burr position',
    expectedStartDial: '14',
  },
  {
    id: DF64_ID,
    fieldLabel: 'Burr-touch zero',
  },
  {
    id: 'DF54',
    fieldLabel: 'Burr-touch zero',
  },
  {
    id: 'Timemore Sculptor 064S',
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

async function readGlobalSettings(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('EspressoDialDB');
        req.onerror = () => reject(req.error);
        req.onsuccess = (event) => {
          const idb = event.target.result;
          const tx = idb.transaction('settings', 'readonly');
          const get = tx.objectStore('settings').get('global');
          get.onsuccess = () => {
            idb.close();
            resolve(get.result);
          };
          get.onerror = () => reject(get.error);
        };
      })
  );
}

async function waitForInputValue(locator, expected) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await locator.inputValue()) === expected) return;
    await delay(100);
  }
  throw new Error(`Expected input value "${expected}", got "${await locator.inputValue()}"`);
}

function settingsPanel(page) {
  return page
    .locator('h3')
    .filter({ hasText: 'Preferences & Settings' })
    .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
}

async function openSettings(page) {
  await page.getByRole('button', { name: /settings/i }).first().click();
  await page.waitForSelector('text=Preferences & Settings');
}

async function closeSettings(page) {
  await page.getByRole('button', { name: '✕' }).click();
  await delay(200);
}

async function selectPrimaryGrinder(page, grinderId) {
  const closeBtn = page.getByRole('button', { name: '✕' });
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
    await delay(200);
  }
  await openSettings(page);
  const panel = settingsPanel(page);
  const grinderSelect = panel
    .locator('label')
    .filter({ hasText: 'Primary grinder' })
    .locator('xpath=following-sibling::select[1]');
  await grinderSelect.selectOption(grinderId);
  await delay(300);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if ((await grinderSelect.inputValue()) === grinderId) break;
    await delay(200);
  }
  const selected = await grinderSelect.inputValue();
  if (selected !== grinderId) {
    throw new Error(`Failed to select grinder ${grinderId} (select shows "${selected}")`);
  }
  await closeSettings(page);
  await page.reload({ waitUntil: 'networkidle' });
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

    await openSettings(page);
    const panel = settingsPanel(page);
    const grinderSelect = panel
      .locator('label')
      .filter({ hasText: 'Primary grinder' })
      .locator('xpath=following-sibling::select[1]');

    for (const grinder of GRINDERS) {
      await grinderSelect.selectOption(grinder.id);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await grinderSelect.inputValue()) === grinder.id) break;
        await delay(100);
      }
      if (grinder.fieldLabel) {
        await page.getByText(grinder.fieldLabel, { exact: false }).first().waitFor({ timeout: 10_000 });
      }
    }

    async function assertUpperBurrRejectsEleven(grinderId) {
      await grinderSelect.selectOption(grinderId);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await grinderSelect.inputValue()) === grinderId) break;
        await delay(100);
      }
      const shiftNote =
        grinderId === BARISTA_PRO_ID || grinderId === BARISTA_TOUCH_ID
          ? 'adjust one burr number at a time'
          : 'Older BES870UK units';
      await panel.getByText(shiftNote, { exact: false }).waitFor({ timeout: 10_000 });
      const upperBurrInput = panel.getByPlaceholder('Factory default 6');
      await upperBurrInput.click();
      await upperBurrInput.fill('11');
      await upperBurrInput.press('Tab');
      await panel.getByRole('alert').filter({ hasText: 'Upper burr must be between 1 and 10' }).waitFor();
      await waitForInputValue(upperBurrInput, '');
      await grinderSelect.focus().catch(() => {});
      await delay(100);
    }

    // Barista Express / Pro / Touch: type 11, blur → error and revert
    for (const id of [BARISTA_EXPRESS_ID, BARISTA_PRO_ID, BARISTA_TOUCH_ID]) {
      await assertUpperBurrRejectsEleven(id);
    }

    // DF64: zero 20 saved
    await grinderSelect.selectOption(DF64_ID);
    const zeroInput = panel.locator('input[placeholder="e.g. 0"]');
    await zeroInput.click();
    await zeroInput.fill('20');
    await page.keyboard.press('Tab');
    let settingsBeforeReload = await readGlobalSettings(page);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (settingsBeforeReload?.df64Gen2ZeroOffset === 20) break;
      await delay(100);
      settingsBeforeReload = await readGlobalSettings(page);
    }
    if (settingsBeforeReload?.df64Gen2ZeroOffset !== 20) {
      throw new Error(
        `DF64 zero not persisted before reload: ${JSON.stringify(settingsBeforeReload)}`
      );
    }
    await closeSettings(page);
    await page.reload({ waitUntil: 'networkidle' });
    const settingsAfterReload = await readGlobalSettings(page);
    const dialSnippet = (await page.locator('body').innerText()).match(
      /GRIND ADJUSTMENT[\s\S]{0,180}/
    )?.[0];
    if (!dialSnippet?.includes('zero + 12 (dial 32)')) {
      throw new Error(
        `Expected zero + 12 (dial 32) after reload; settings=${JSON.stringify(settingsAfterReload)}; dial=${dialSnippet}`
      );
    }

    const heroAfterDf64 = await page.locator('body').innerText();
    if (!/estimated/i.test(heroAfterDf64)) {
      throw new Error('Starting card missing Estimated for DF64 Gen 2 after zero reload');
    }

    for (const grinder of GRINDERS) {
      if (grinder.id === DF64_ID) continue;
      await selectPrimaryGrinder(page, grinder.id);
      const hero = await page.locator('body').innerText();
      if (!/estimated/i.test(hero)) {
        throw new Error(`Starting card missing Estimated for ${grinder.id}`);
      }
      if (!hero.includes('Start here, then log your first shot')) {
        throw new Error(`Expected fresh-bean starting copy for ${grinder.id}`);
      }
      if (grinder.expectedStartDial) {
        const dialDisplay = page.locator('p.text-5xl').first();
        for (let attempt = 0; attempt < 40; attempt += 1) {
          if ((await dialDisplay.innerText()).trim() === grinder.expectedStartDial) break;
          await delay(100);
        }
        if ((await dialDisplay.innerText()).trim() !== grinder.expectedStartDial) {
          throw new Error(
            `Expected starting dial ${grinder.expectedStartDial} for ${grinder.id}, got "${await dialDisplay.innerText()}"`
          );
        }
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
