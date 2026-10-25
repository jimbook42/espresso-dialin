#!/usr/bin/env node
/**
 * v8 G54: History flow+pressure chart at 390×844.
 * Run: /workspace/bin/box-test-slot --build node scripts/v8-g54-history-pressure-screenshot.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = '/workspace/pl-state/lab-tap';
const PORT = 4181;

const FLAIR_PROFILE = {
  preinfusionTime: '5',
  preinfusionEndTrigger: 'time',
  preinfusionPressure: '2',
  peakPressure: '9',
  taperPressure: '6',
  taperStartTrigger: 'time',
  taperStartTimeS: '12',
};

function flowCurve() {
  const pts = [];
  for (let t = 0; t <= 28; t += 2) {
    pts.push({ tS: t, weightG: Math.min(36, t * 1.25) });
  }
  return pts;
}

function pressureCurve() {
  const pts = [];
  for (let t = 0; t <= 28; t += 1) {
    const bar = t < 5 ? 2 + t * 0.2 : t < 12 ? 8.5 : 6;
    pts.push({ tS: t, bar });
  }
  return pts;
}

async function seedDb(page) {
  await page.evaluate(({ fp, flow, pressure }) => {
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
          flairEnabled: true,
          lastSelectedBeanId: 'g54-bean',
        });
        tx.objectStore('beans').put({
          id: 'g54-bean',
          name: 'G54 Fixture',
          roaster: 'Lab',
          roastType: 'Medium',
          roastDate: '2026-10-01',
          storageType: 'bag',
          isFinished: false,
          createdAt: '2026-10-01T00:00:00.000Z',
        });
        tx.objectStore('recipes').put({
          id: 'g54-recipe',
          beanId: 'g54-bean',
          targetTimeMinS: 25,
          targetTimeMaxS: 32,
          targetDoseG: 18,
          targetYieldG: 36,
          flairProfile: fp,
        });
        tx.objectStore('shots').put({
          id: 'g54-shot',
          beanId: 'g54-bean',
          timestamp: '2026-10-20T10:00:00.000Z',
          grinderModel: 'Sette 270Wi',
          setteMacro: 10,
          setteMicro: 'A',
          actualTimeS: 28,
          actualDoseG: 18,
          actualYieldG: 36,
          tasteProfile: 'balanced',
          flairProfile: fp,
          scaleFlowCurve: flow,
          scaleFlowRateGs: 1.28,
          labPressureCurve: pressure,
          labPressurePeakBar: 8.6,
        });
        tx.oncomplete = () => {
          idb.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, { fp: FLAIR_PROFILE, flow: flowCurve(), pressure: pressureCurve() });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const preview = startPreviewServer(PORT);
  try {
    await waitForServer(preview.url);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(preview.url);
    await seedDb(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'History' }).click();
    await page.waitForSelector('[data-testid="history-measured-pressure"]', { timeout: 15000 });
    await page.waitForSelector('[data-testid="history-ideal-pressure"]', { timeout: 5000 });
    const outPath = path.join(OUT_DIR, 'v8-g54-history-flow-pressure-390x844.png');
    await page.screenshot({ path: outPath, fullPage: true });
    console.log('wrote', outPath);
    await browser.close();
  } finally {
    await preview.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
