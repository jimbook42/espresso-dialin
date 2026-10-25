#!/usr/bin/env node
/**
 * v9 G55: History play icon + replay screen at 390×844.
 * Run: /workspace/bin/box-test-slot --build node scripts/v9-g55-history-replay-screenshot.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = '/workspace/pl-state/lab-tap';
const PORT = 4182;
const SHOT_ID = 'g55-shot';

const FLAIR_PROFILE = {
  preinfusionTime: '5',
  preinfusionEndTrigger: 'time',
  preinfusionPressure: '2',
  peakPressure: '9',
  taperPressure: '6',
  taperStartTrigger: 'time',
  taperStartTimeS: '12',
};

function pressureCurve() {
  const pts = [];
  for (let t = 0; t <= 28; t += 1) {
    const bar = t < 5 ? 2 + t * 0.2 : t < 12 ? 8.5 : 6;
    pts.push({ tS: t, bar });
  }
  return pts;
}

async function seedDb(page) {
  await page.evaluate(({ fp, pressure, shotId }) => {
    const samples = pressure.map((p) => ({
      tS: p.tS,
      bar: p.bar,
      hubX: 320,
      hubY: 400,
      radius: 80,
      needleDeg: 40 + p.tS * 3,
      valid: true,
    }));
    const blob = new Blob([new Uint8Array([0, 0, 0, 0])], { type: 'video/webm' });

    return new Promise((resolve, reject) => {
      const openMain = indexedDB.open('EspressoDialDB', 17);
      openMain.onupgradeneeded = (event) => {
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
      openMain.onsuccess = (event) => {
        const idb = event.target.result;
        const tx = idb.transaction(['settings', 'beans', 'recipes', 'shots'], 'readwrite');
        tx.objectStore('settings').put({
          id: 'global',
          grinderModel: 'Sette 270Wi',
          flairEnabled: true,
          lastSelectedBeanId: 'g55-bean',
        });
        tx.objectStore('beans').put({
          id: 'g55-bean',
          name: 'G55 Fixture',
          roaster: 'Lab',
          roastType: 'Medium',
          roastDate: '2026-10-01',
          storageType: 'bag',
          isFinished: false,
          createdAt: '2026-10-01T00:00:00.000Z',
        });
        tx.objectStore('recipes').put({
          id: 'g55-recipe',
          beanId: 'g55-bean',
          targetTimeMinS: 25,
          targetTimeMaxS: 32,
          targetDoseG: 18,
          targetYieldG: 36,
          flairProfile: fp,
        });
        tx.objectStore('shots').put({
          id: shotId,
          beanId: 'g55-bean',
          timestamp: '2026-10-26T10:00:00.000Z',
          grinderModel: 'Sette 270Wi',
          setteMacro: 10,
          setteMicro: 'A',
          actualTimeS: 28,
          actualDoseG: 18,
          actualYieldG: 36,
          tasteProfile: 'balanced',
          flairProfile: fp,
          labPressureCurve: pressure,
          labPressurePeakBar: 8.6,
        });
        tx.oncomplete = () => {
          idb.close();
          const openReplay = indexedDB.open('EspressoDialLabReplay', 1);
          openReplay.onupgradeneeded = (ev) => {
            const rdb = ev.target.result;
            if (!rdb.objectStoreNames.contains('lastReplay')) {
              rdb.createObjectStore('lastReplay');
            }
          };
          openReplay.onsuccess = (ev) => {
            const rdb = ev.target.result;
            const rtx = rdb.transaction('lastReplay', 'readwrite');
            rtx.objectStore('lastReplay').put(
              {
                shotId,
                mimeType: 'video/webm',
                videoW: 640,
                videoH: 480,
                durationS: 28,
                byteSize: blob.size,
                samples,
                savedAt: new Date().toISOString(),
                blob,
              },
              'last',
            );
            rtx.oncomplete = () => {
              rdb.close();
              resolve();
            };
            rtx.onerror = () => reject(rtx.error);
          };
          openReplay.onerror = () => reject(openReplay.error);
        };
        tx.onerror = () => reject(tx.error);
      };
      openMain.onerror = () => reject(openMain.error);
    });
  }, { fp: FLAIR_PROFILE, pressure: pressureCurve(), shotId: SHOT_ID });
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
    await page.waitForSelector('[data-testid="history-lab-shot-replay-play"]', { timeout: 15000 });
    const historyPath = path.join(OUT_DIR, 'v9-g55-history-replay-play-390x844.png');
    await page.screenshot({ path: historyPath, fullPage: true });
    console.log('wrote', historyPath);
    await page.getByTestId('history-lab-shot-replay-play').click();
    await page.waitForSelector('[data-testid="lab-shot-replay-screen"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="lab-shot-replay-bar-readout"]', { timeout: 5000 });
    const replayPath = path.join(OUT_DIR, 'v9-g55-replay-screen-390x844.png');
    await page.screenshot({ path: replayPath, fullPage: true });
    console.log('wrote', replayPath);
    await browser.close();
  } finally {
    await preview.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
