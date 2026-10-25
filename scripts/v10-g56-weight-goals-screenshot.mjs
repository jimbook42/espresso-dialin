#!/usr/bin/env node
/**
 * v10 G56: shot timer weight-goal line at 390×844 and 390×640 (setting ON, peak phase).
 * Build: VITE_SCALE_ALLOW_SIM=true npm run build
 * Run: /workspace/bin/box-test-slot node scripts/v10-g56-weight-goals-screenshot.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { waitForServer } from './lib/previewServer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = '/workspace/pl-state/lab-tap';
const PORT = 4181;

const VIEWPORTS = [
  { w: 390, h: 844, tag: '390x844' },
  { w: 390, h: 640, tag: '390x640' },
];

const WEIGHT_PEAK_PROFILE = {
  preinfusionTime: '5',
  preinfusionEndTrigger: 'time',
  peakPressure: '9',
  taperPressure: '6',
  taperStartTrigger: 'weight',
  peakEndYield: '16',
};

function startScalePreview() {
  const child = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    {
      cwd: ROOT,
      stdio: 'pipe',
      detached: true,
      env: { ...process.env, VITE_SCALE_ALLOW_SIM: 'true' },
    },
  );
  child.unref();
  const pid = child.pid;
  const stop = async () => {
    if (!pid) return;
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // exited
    }
    await delay(300);
    try {
      process.kill(-pid, 'SIGKILL');
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

async function seedDb(page, { labOn, flairProfile }) {
  await page.evaluate(({ labOn: labEnabled, flairProfile: fp }) => {
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
          preInfusionEnabled: false,
          lastSelectedBeanId: 'lab-bean',
          smartScaleDeviceId: 'timemore-dot',
          shotScreenWeightGoalsEnabled: true,
          labCameraPressureEnabled: labEnabled,
          shotStartCountdown: 'off',
          labGaugeTapCalibration: labEnabled
            ? {
              savedAt: new Date().toISOString(),
              calibration: {
                zeroAngleDeg: 200,
                fiveAngleDeg: 260,
                tenAngleDeg: 320,
                hub: { x: 320, y: 360 },
                five: { x: 380, y: 300 },
                ten: { x: 400, y: 380 },
                radius: 90,
                rotationDeg: 0,
              },
            }
            : undefined,
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
          targetYieldG: 32,
          flairProfile: fp,
        });
        tx.oncomplete = () => {
          idb.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, { labOn, flairProfile });
}

async function connectSimScale(page) {
  const transport = page.locator('select[aria-label="Scale transport"]');
  await transport.waitFor({ timeout: 25_000 });
  await transport.selectOption('sim');
  await page.getByRole('button', { name: 'Connect scale' }).click();
  await page.getByRole('button', { name: /Open weighing view/ }).waitFor({ timeout: 25_000 });
  await delay(600);
}

async function prepareHome(page, opts) {
  const url = `http://127.0.0.1:${PORT}/`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await clearDb(page);
  await seedDb(page, opts);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Start$/ }).waitFor({ timeout: 25_000 });
  await delay(400);
  await connectSimScale(page);
}

async function startShot(page) {
  await page.getByRole('button', { name: /^Start$/ }).click();
  await page.getByLabel('Cancel timer').waitFor({ timeout: 15_000 });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const preview = startScalePreview();
  const url = `http://127.0.0.1:${PORT}/`;

  try {
    await waitForServer(url);
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      for (const { w, h, tag } of VIEWPORTS) {
        for (const labOn of [false, true]) {
          await page.setViewportSize({ width: w, height: h });
          await prepareHome(page, { labOn, flairProfile: WEIGHT_PEAK_PROFILE });
          await startShot(page);
          await page.getByTestId('shot-timer-weight-goals').waitFor({ timeout: 12_000 });
          await page.waitForFunction(
            () => {
              const el = document.querySelector('[data-testid="shot-timer-weight-goals"]');
              return el?.textContent?.includes('Peak → 16 g');
            },
            null,
            { timeout: 15_000 },
          );
          const labTag = labOn ? 'lab-on' : 'lab-off';
          const outPath = path.join(OUT_DIR, `v10-g56-weight-goals-peak-${labTag}-${tag}.png`);
          await page.screenshot({ path: outPath, fullPage: false });
          process.stderr.write(`ok ${outPath}\n`);
          await page.getByLabel('Cancel timer').click({ timeout: 5000 }).catch(() => {});
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    await preview.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
