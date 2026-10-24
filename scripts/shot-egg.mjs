#!/usr/bin/env node
/**
 * Perfect-shot celebration screenshots + overlap/real-flow checks (production build).
 * Run: node scripts/shot-egg.mjs  (after `npm run build`)
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = '/workspace/pl-state/egg-screens';
const PORT = 4179;
const VERSION_TAG = 'v2';

const VIEWPORTS = [
  { width: 390, height: 844, tag: '390x844' },
  { width: 412, height: 915, tag: '412x915' },
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

async function openDialFresh(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await clearDb(page);
  await seedDialForm(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('dial-yield-tile').waitFor({ timeout: 15_000 });
}

async function scrollCelebrationTargets(page) {
  await page.evaluate(() => {
    const behavior = 'auto';
    document.querySelector('[data-testid="dial-yield-tile"]')
      ?.scrollIntoView({ block: 'center', behavior });
    document.querySelector('[data-testid="dial-notes-card"]')
      ?.scrollIntoView({ block: 'center', behavior });
  });
  await delay(200);
}

async function fillDialShotFields(page, { yieldG = '36', timeS = '28', taste = 'Balanced' } = {}) {
  await page.getByTestId('dial-yield-tile').locator('input').fill(String(yieldG));
  await page.getByTestId('dial-time-tile').locator('input').fill(String(timeS));
  if (taste) {
    await page.getByRole('button', { name: taste, exact: true }).click();
  }
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
  await page.getByTestId('perfect-shot-cameo').waitFor({ state: 'detached', timeout: 5000 });
  await delay(200);
}

/**
 * @returns {Promise<{ ok: boolean, overlaps: object[] }>}
 */
async function checkCameoOverlap(page) {
  return page.evaluate(() => {
    const cameo = document.querySelector('[data-testid="perfect-shot-cameo"]');
    if (!cameo) return { ok: false, overlaps: [{ reason: 'cameo missing' }] };
    const cameoRect = cameo.getBoundingClientRect();
    const notesCard = document.querySelector('[data-testid="dial-notes-card"]');

    const slot = document.querySelector('[data-testid="perfect-shot-cameo-slot"]');
    const candidates = [
      ...document.querySelectorAll('button, input, textarea, select, a[href], nav, label'),
      ...document.querySelectorAll('p, span, h1, h2, h3'),
    ];

    const overlaps = [];
    const seen = new Set();

    for (const el of candidates) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el === cameo || cameo.contains(el) || el.contains(cameo)) continue;
      if (el === notesCard || el === slot || (slot && slot.contains(el))) continue;

      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;

      const intersect = !(
        cameoRect.right <= rect.left + 0.5
        || cameoRect.left >= rect.right - 0.5
        || cameoRect.bottom <= rect.top + 0.5
        || cameoRect.top >= rect.bottom - 0.5
      );
      if (!intersect) continue;

      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'BUTTON') {
        continue;
      }

      overlaps.push({
        tag: el.tagName,
        testId: el.getAttribute('data-testid'),
        text: text.slice(0, 60),
      });
    }

    return { ok: overlaps.length === 0, overlaps };
  });
}

async function assertRingVisible(page) {
  const ring = page.getByTestId('dial-yield-tile');
  await ring.waitFor({ state: 'visible' });
  const hasRing = await ring.evaluate((el) => el.classList.contains('perfect-shot-yield-ring'));
  if (!hasRing) {
    throw new Error('Yield tile missing perfect-shot-yield-ring class');
  }
  const ratio = await page.getByTestId('dial-yield-ratio').textContent();
  if (!ratio || !ratio.includes('on target')) {
    throw new Error(`Expected on-target ratio line, got: ${ratio}`);
  }
}

async function captureSevenTapPair(page, viewport, url, variantLabel) {
  const { tag } = viewport;
  await page.setViewportSize(viewport);
  await openDialFresh(page, url);
  await fillDialShotFields(page);
  await scrollCelebrationTargets(page);

  if (variantLabel === 'gold') {
    await tapLogoSeven(page);
    await waitForCelebrationGone(page);
  }

  await tapLogoSeven(page);
  await waitForCameo(page);

  const overlap = await checkCameoOverlap(page);
  const prefix = variantLabel === 'gold' ? 'egg-gold' : 'egg-normal';
  const shotPath = path.join(OUT_DIR, `${prefix}-${tag}-${VERSION_TAG}.png`);
  await page.screenshot({ path: shotPath, fullPage: false });

  return { shotPath, overlap, variantLabel, tag };
}

async function captureAfterFade(page, viewport, url) {
  const { tag } = viewport;
  await page.setViewportSize(viewport);
  await openDialFresh(page, url);
  await fillDialShotFields(page);
  await scrollCelebrationTargets(page);
  await tapLogoSeven(page);
  await waitForCelebrationGone(page);
  const afterPath = path.join(OUT_DIR, `egg-after-${tag}-${VERSION_TAG}.png`);
  await page.screenshot({ path: afterPath, fullPage: false });
  const cameoCount = await page.getByTestId('perfect-shot-cameo').count();
  if (cameoCount !== 0) {
    throw new Error(`Cameo still in DOM after fade at ${tag}`);
  }
  return afterPath;
}

async function captureRealFlowOnTarget(page, viewport, url) {
  const { tag } = viewport;
  await page.setViewportSize(viewport);
  await openDialFresh(page, url);
  await fillDialShotFields(page, { yieldG: '36', timeS: '28', taste: 'Balanced' });
  await scrollCelebrationTargets(page);
  await page.getByRole('button', { name: /Log shot & calculate grind adjustment/i }).click();
  await waitForCameo(page);
  await assertRingVisible(page);
  const overlap = await checkCameoOverlap(page);
  const shotPath = path.join(OUT_DIR, `egg-realflow-${tag}-${VERSION_TAG}.png`);
  await page.screenshot({ path: shotPath, fullPage: false });
  await waitForCelebrationGone(page);
  return { shotPath, overlap, tag };
}

async function captureNearMiss(page, viewport, url) {
  const { tag } = viewport;
  await page.setViewportSize(viewport);
  await openDialFresh(page, url);
  await fillDialShotFields(page, { yieldG: '36', timeS: '28', taste: 'Sour' });
  await scrollCelebrationTargets(page);
  await page.getByRole('button', { name: /Log shot & calculate grind adjustment/i }).click();
  await delay(500);
  const cameoCount = await page.getByTestId('perfect-shot-cameo').count();
  const ring = await page.getByTestId('dial-yield-tile').evaluate(
    (el) => el.classList.contains('perfect-shot-yield-ring'),
  );
  if (cameoCount !== 0 || ring) {
    throw new Error(`Near-miss showed celebration at ${tag} (cameo=${cameoCount}, ring=${ring})`);
  }
  const shotPath = path.join(OUT_DIR, `egg-nearmiss-${tag}-${VERSION_TAG}.png`);
  await page.screenshot({ path: shotPath, fullPage: false });
  return shotPath;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const preview = startPreviewServer(PORT);
  const url = `http://127.0.0.1:${PORT}/`;
  const overlapReports = [];
  const manifest = [];

  try {
    await waitForServer(url);
    const browser = await chromium.launch();
    const page = await browser.newPage();

    try {
      for (const viewport of VIEWPORTS) {
        const normal = await captureSevenTapPair(page, viewport, url, 'suit');
        manifest.push({ path: normal.shotPath, kind: 'normal' });
        overlapReports.push({ viewport: viewport.tag, variant: 'suit', ...normal.overlap });

        const gold = await captureSevenTapPair(page, viewport, url, 'gold');
        manifest.push({ path: gold.shotPath, kind: 'gold' });
        overlapReports.push({ viewport: viewport.tag, variant: 'gold', ...gold.overlap });

        const afterPath = await captureAfterFade(page, viewport, url);
        manifest.push({ path: afterPath, kind: 'after' });

        const real = await captureRealFlowOnTarget(page, viewport, url);
        manifest.push({ path: real.shotPath, kind: 'realflow' });
        overlapReports.push({ viewport: viewport.tag, variant: 'realflow', ...real.overlap });

        const nearPath = await captureNearMiss(page, viewport, url);
        manifest.push({ path: nearPath, kind: 'nearmiss' });

        for (const entry of manifest.slice(-5)) {
          process.stderr.write(`ok ${entry.path}\n`);
        }
      }

      console.log(JSON.stringify({ manifest, overlapReports }, null, 2));

      let failed = false;
      for (const report of overlapReports) {
        if (!report.ok) {
          console.error('overlap fail', report);
          failed = true;
        }
      }
      if (failed) process.exit(1);
    } finally {
      await browser.close();
    }
  } finally {
    await preview.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
