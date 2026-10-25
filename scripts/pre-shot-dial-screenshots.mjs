#!/usr/bin/env node
/**
 * Shot-ready dial-found / not-found UI (window override — not real camera).
 * Output: v5-pre-shot-dial-* in /workspace/pl-state/lab-tap/
 */
import { mkdir } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT, startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const OUT_DIR = '/workspace/pl-state/lab-tap';
const PORT = 4182;
const VIEWPORT = { width: 390, height: 844 };

async function clearDb(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const del = indexedDB.deleteDatabase('EspressoDialDB');
    del.onsuccess = () => resolve();
    del.onerror = () => resolve();
    del.onblocked = () => resolve();
  }));
}

async function seedDb(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
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
        smartScaleDeviceId: 'simulated',
        labCameraPressureEnabled: true,
        labGaugeTapCalibration: {
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
            userPlaced: true,
          },
        },
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
        flairProfile: { preinfusionEndTrigger: 'manual' },
      });
      tx.oncomplete = () => {
        idb.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }));
}

async function main() {
  const distIndex = path.join(ROOT, 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    throw new Error('Run production build before screenshots (dist/index.html missing).');
  }
  await mkdir(OUT_DIR, { recursive: true });
  const server = startPreviewServer(PORT);
  await waitForServer(`http://127.0.0.1:${PORT}/`);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [tag, status] of [['found', 'found'], ['not-found', 'not_found']]) {
      const context = await browser.newContext({ viewport: VIEWPORT });
      await context.addInitScript((s) => {
        window.__preShotDialStatusOverride = s;
      }, status);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
      await clearDb(page);
      await seedDb(page);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      const el = page.getByTestId('pre-shot-dial-status');
      await el.waitFor({ timeout: 12_000 });
      const out = path.join(OUT_DIR, `v5-pre-shot-dial-${tag}-390x844.png`);
      await el.screenshot({ path: out });
      process.stdout.write(`Wrote ${out}\n`);
      await context.close();
    }
  } finally {
    await browser.close();
    await server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
