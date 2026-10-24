#!/usr/bin/env node
/**
 * Lab pressure screenshots + vertical overflow checks at common phone sizes.
 * Build: VITE_SCALE_ALLOW_SIM=true VITE_PRESSURE_ALLOW_SIM=true npm run build
 * Run: node scripts/shot-lab-pressure-viewport.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { waitForServer } from './lib/previewServer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = '/workspace/pl-state/lab-screens';
const PORT = 4178;

const VIEWPORTS = [
  { w: 390, h: 844, tag: '390x844' },
  { w: 360, h: 640, tag: '360x640' },
  { w: 412, h: 915, tag: '412x915' },
];

function startScalePreview() {
  const child = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    {
      cwd: ROOT,
      stdio: 'pipe',
      detached: true,
      env: { ...process.env, VITE_SCALE_ALLOW_SIM: 'true', VITE_PRESSURE_ALLOW_SIM: 'true' },
    },
  );
  child.unref();
  const stop = async () => {
    if (!child.pid) return;
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      // exited
    }
    await delay(300);
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {
      // exited
    }
  };
  return { stop };
}

async function clearDb(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const del = indexedDB.deleteDatabase('EspressoDialDB');
    del.onsuccess = () => resolve();
    del.onerror = () => resolve();
    del.onblocked = () => resolve();
  }));
}

async function seedDb(page, { labOn }) {
  await page.evaluate((labEnabled) => {
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
          flairEnabled: true,
          lastSelectedBeanId: 'lab-bean',
          smartScaleDeviceId: 'timemore-dot',
          labCameraPressureEnabled: labEnabled,
        });
        tx.objectStore('beans').put({
          id: 'lab-bean',
          name: 'Lab Bean',
          roastType: 'Medium',
          roastDate: '2026-10-01',
          isFinished: false,
          createdAt: '2026-10-01T00:00:00.000Z',
        });
        tx.objectStore('recipes').put({
          id: 'lab-recipe',
          beanId: 'lab-bean',
          targetTimeMinS: 27,
          targetTimeMaxS: 32,
          targetDoseG: 18,
          targetYieldG: 36,
          flairProfile: {
            preinfusionEndTrigger: 'manual',
          },
        });
        tx.oncomplete = () => {
          idb.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, labOn);
}

async function connectSimScale(page) {
  const transport = page.locator('select[aria-label="Scale transport"]');
  await transport.waitFor({ timeout: 25_000 });
  await transport.selectOption('sim');
  await page.getByRole('button', { name: 'Connect scale' }).click();
  await page.getByRole('button', { name: /Open weighing view/ }).waitFor({ timeout: 15_000 });
  await delay(400);
}

async function assertNoVerticalOverflow(page, label, surface = 'document') {
  const { scrollHeight, innerHeight, ok } = await page.evaluate((mode) => {
    const innerHeight = window.innerHeight;
    let root = document.documentElement;
    if (mode === 'timer') {
      root = Array.from(document.querySelectorAll('div')).find(
        (node) => node.classList.contains('fixed')
          && node.className.includes('inset-0')
          && node.className.includes('z-[60]'),
      ) || null;
    } else if (mode === 'weigh') {
      root = document.querySelector('[aria-label="Live scale weight"]');
    }
    if (!root) {
      return { scrollHeight: document.documentElement.scrollHeight, innerHeight, ok: false };
    }
    const scrollHeight = root.scrollHeight;
    const docOk = document.documentElement.scrollHeight <= innerHeight + 2;
    const surfaceOk = scrollHeight <= innerHeight + 2;
    return {
      scrollHeight,
      innerHeight,
      ok: mode === 'document' ? docOk : surfaceOk,
    };
  }, surface);
  if (!ok) {
    throw new Error(`${label}: vertical overflow scrollHeight=${scrollHeight} innerHeight=${innerHeight}`);
  }
}

async function capture(page, filePath) {
  await page.screenshot({ path: filePath, fullPage: false });
}

async function runScenario(page, viewport, scenario, labOn) {
  const { w, h, tag } = viewport;
  await page.setViewportSize({ width: w, height: h });
  const url = `http://127.0.0.1:${PORT}/`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await clearDb(page);
  await seedDb(page, { labOn });
  await page.goto(url, { waitUntil: 'networkidle' });
  await connectSimScale(page);

  const labTag = labOn ? 'lab-on' : 'lab-off';
  const base = `${scenario}-${labTag}-${tag}`;

  if (scenario === 'shot-inline-mid' || scenario === 'fullscreen-timer') {
    await page.getByRole('button', { name: /^Start$/ }).click();
    await page.getByRole('button', { name: 'Cancel timer' }).waitFor({ timeout: 10_000 });
    await delay(800);
    if (labOn) {
      await page.getByTestId('shot-lab-pressure-readout').first().waitFor({ timeout: 8000 });
    }
    await assertNoVerticalOverflow(page, base, 'timer');
    const out = path.join(OUT_DIR, `${base}.png`);
    if (scenario === 'shot-inline-mid' && labOn) {
      await page.getByTestId('shot-lab-pressure-readout').first().screenshot({ path: out });
    } else {
      await capture(page, out);
    }
    await page.getByRole('button', { name: 'Cancel timer' }).click({ timeout: 5000 }).catch(() => {});
    return {
      path: out,
      note:
        scenario === 'shot-inline-mid'
          ? labOn
            ? 'Mid-shot pressure readout (bar, peak chip, profile) on extraction UI'
            : 'Extraction UI mid-shot, lab off'
          : labOn
            ? 'Full-screen extraction timer with scale flow and lab pressure'
            : 'Full-screen extraction timer, lab off',
    };
  }

  if (scenario === 'weigh-view') {
    await page.getByRole('button', { name: /Open weighing view/ }).click();
    await delay(600);
    if (labOn) {
      await page.getByTestId('shot-lab-pressure-readout').first().waitFor({ timeout: 8000 });
    }
    await assertNoVerticalOverflow(page, base, 'weigh');
    const out = path.join(OUT_DIR, `${base}.png`);
    await capture(page, out);
    return { path: out, note: labOn ? 'Weighing view with lab pressure strip' : 'Weighing view, lab off' };
  }

  throw new Error(`unknown scenario ${scenario}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const preview = startScalePreview();
  const url = `http://127.0.0.1:${PORT}/`;
  await waitForServer(url);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const manifest = [];
  const scenarios = ['shot-inline-mid', 'fullscreen-timer', 'weigh-view'];

  try {
    for (const viewport of VIEWPORTS) {
      for (const labOn of [true, false]) {
        for (const scenario of scenarios) {
          const result = await runScenario(page, viewport, scenario, labOn);
          manifest.push(result);
          process.stderr.write(`ok ${result.path}\n`);
        }
      }
    }
  } finally {
    await browser.close();
    await preview.stop();
  }

  await writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
