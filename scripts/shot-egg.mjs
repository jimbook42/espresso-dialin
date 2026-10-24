#!/usr/bin/env node
/**
 * Perfect-shot celebration screenshots (production build).
 * Run: node scripts/shot-egg.mjs  (after `npm run build`)
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = '/workspace/pl-state/egg-screens';
const PORT = 4179;

const VIEWPORTS = [
  { width: 390, height: 844, tag: '390x844' },
  { width: 360, height: 640, tag: '360x640' },
];

async function clearDb(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const del = indexedDB.deleteDatabase('EspressoDialDB');
    del.onsuccess = () => resolve();
    del.onerror = () => resolve();
    del.onblocked = () => resolve();
  }));
}

async function seedDialForm(page) {
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
        flairEnabled: false,
        lastSelectedBeanId: 'egg-bean',
        shotStartCountdown: 'off',
      });
      tx.objectStore('beans').put({
        id: 'egg-bean',
        name: 'Egg Test Bean',
        roastType: 'Medium',
        roastDate: '2026-10-01',
        isFinished: false,
        createdAt: '2026-10-01T00:00:00.000Z',
      });
      tx.objectStore('recipes').put({
        id: 'egg-recipe',
        beanId: 'egg-bean',
        targetTimeMinS: 26,
        targetTimeMaxS: 30,
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
  }));
}

async function tapLogoSeven(page) {
  const logo = page.getByTestId('app-header-logo');
  await logo.waitFor({ timeout: 15_000 });
  for (let i = 0; i < 7; i += 1) {
    await logo.click({ delay: 40 });
  }
}

async function waitForCameo(page) {
  await page.getByTestId('perfect-shot-cameo').waitFor({ state: 'visible', timeout: 8000 });
  await delay(350);
}

async function waitForCelebrationGone(page) {
  await page.getByTestId('perfect-shot-celebration').waitFor({ state: 'detached', timeout: 5000 });
  await delay(200);
}

async function captureCelebrationPair(page, viewport, url) {
  const { tag } = viewport;
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: 'networkidle' });
  await clearDb(page);
  await seedDialForm(page);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByTestId('dial-yield-tile').waitFor({ timeout: 15_000 });

  await tapLogoSeven(page);
  await waitForCameo(page);
  const normalPath = path.join(OUT_DIR, `egg-normal-${tag}-v1.png`);
  await page.screenshot({ path: normalPath, fullPage: false });

  await waitForCelebrationGone(page);

  await tapLogoSeven(page);
  await waitForCameo(page);
  const goldPath = path.join(OUT_DIR, `egg-gold-${tag}-v1.png`);
  await page.screenshot({ path: goldPath, fullPage: false });

  await waitForCelebrationGone(page);
  const afterPath = path.join(OUT_DIR, `egg-after-${tag}-v1.png`);
  await page.screenshot({ path: afterPath, fullPage: false });

  return [
    { path: normalPath, note: `Suit cameo + yield ring at ${tag}` },
    { path: goldPath, note: `Gold cameo (2nd 7-tap) at ${tag}` },
    { path: afterPath, note: `After celebration fade at ${tag}` },
  ];
}

async function captureStatsThreeTap(page, url) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await clearDb(page);
  await seedDialForm(page);
  await page.goto(url, { waitUntil: 'networkidle' });
  const statsTab = page.getByRole('button', { name: 'Stats' });
  for (let i = 0; i < 3; i += 1) {
    await statsTab.click({ delay: 80 });
  }
  await delay(400);
  const out = path.join(OUT_DIR, 'egg-stats-3tap-390x844-v1.png');
  await page.screenshot({ path: out, fullPage: false });
  return { path: out, note: 'Stats after 3 tab taps — no quantum overlay' };
}

async function copyLabPressureReference() {
  const src = '/workspace/pl-state/lab-screens/fullscreen-timer-lab-on-390x844-pre-v5.png';
  const dest = path.join(OUT_DIR, 'egg-lab-pressure-timer-390x844-v1.png');
  const { copyFile, access } = await import('node:fs/promises');
  try {
    await access(src);
    await copyFile(src, dest);
    return { path: dest, note: 'Copied existing Lab pressure timer screenshot (unchanged)' };
  } catch {
    return { path: dest, note: 'NOT DONE: lab reference screenshot missing' };
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const preview = startPreviewServer(PORT);
  const url = `http://127.0.0.1:${PORT}/`;
  const manifest = [];

  try {
    await waitForServer(url);
    const browser = await chromium.launch();
    const page = await browser.newPage();

    try {
      for (const viewport of VIEWPORTS) {
        const entries = await captureCelebrationPair(page, viewport, url);
        manifest.push(...entries);
        for (const e of entries) process.stderr.write(`ok ${e.path}\n`);
      }
      const statsEntry = await captureStatsThreeTap(page, url);
      manifest.push(statsEntry);
      process.stderr.write(`ok ${statsEntry.path}\n`);
    } finally {
      await browser.close();
    }

    manifest.push(await copyLabPressureReference());
    console.log(JSON.stringify(manifest, null, 2));
  } finally {
    await preview.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
