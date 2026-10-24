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
import sharp from 'sharp';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = '/workspace/pl-state/egg-screens';
const PORT = 4179;
const VERSION_TAG = 'v3';

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
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    if (regs) {
      for (const reg of regs) await reg.unregister();
    }
    const keys = await caches?.keys?.();
    if (keys) {
      for (const key of keys) await caches.delete(key);
    }
  });
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
  await page.getByTestId('perfect-shot-cameo').waitFor({ state: 'detached', timeout: 10_000 });
  await delay(200);
}

/**
 * v45 ticket: timed screenshots at 0.6s, 2.5s, 3.8s, and after 4.6s (ring + cameo gone).
 * @returns {Promise<{ paths: Record<string, string>, timings: object }>}
 */
async function captureV45Timeline(page, url) {
  const viewport = { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  await openDialFresh(page, url);
  await fillDialShotFields(page);
  await scrollCelebrationTargets(page);

  const timings = {
    triggerMs: null,
    ringVisibleMs: null,
    cameoVisibleMs: null,
    exitClassMs: null,
    cameoDetachedMs: null,
    ringGoneMs: null,
  };

  const logo = page.getByTestId('app-header-logo');
  const triggerStart = Date.now();
  for (let i = 0; i < 7; i += 1) {
    await logo.click({ delay: 40 });
  }
  timings.triggerMs = 0;

  const pollEndMs = 5500;
  const pollPromise = (async () => {
    while (Date.now() - triggerStart < pollEndMs) {
      const elapsed = Date.now() - triggerStart;
      if (timings.ringVisibleMs === null) {
        const hasRing = await page.getByTestId('dial-yield-tile').evaluate(
          (el) => el.classList.contains('perfect-shot-yield-ring'),
        );
        if (hasRing) timings.ringVisibleMs = elapsed;
      }
      if (timings.cameoVisibleMs === null) {
        const count = await page.getByTestId('perfect-shot-cameo').count();
        if (count > 0) timings.cameoVisibleMs = elapsed;
      }
      if (timings.exitClassMs === null) {
        const hasExit = await page.getByTestId('perfect-shot-cameo').evaluate(
          (el) => el?.classList.contains('perfect-shot-cameo--exit') ?? false,
        ).catch(() => false);
        if (hasExit) timings.exitClassMs = elapsed;
      }
      if (timings.cameoDetachedMs === null && timings.cameoVisibleMs !== null) {
        const count = await page.getByTestId('perfect-shot-cameo').count();
        if (count === 0) timings.cameoDetachedMs = elapsed;
      }
      if (timings.ringGoneMs === null && timings.ringVisibleMs !== null) {
        const hasRing = await page.getByTestId('dial-yield-tile').evaluate(
          (el) => el.classList.contains('perfect-shot-yield-ring'),
        );
        if (!hasRing) timings.ringGoneMs = elapsed;
      }
      await delay(16);
    }
  })();

  const shotAt = async (offsetMs, filename) => {
    const elapsed = Date.now() - triggerStart;
    const waitMore = offsetMs - elapsed;
    if (waitMore > 0) await delay(waitMore);
    await scrollCelebrationTargets(page);
    const outPath = path.join(OUT_DIR, filename);
    await page.screenshot({ path: outPath, fullPage: false });
    return outPath;
  };

  const paths = {
    at0p6s: await shotAt(700, 'v45-0p6s-390x844.png'),
    at2p5s: await shotAt(2500, 'v45-2p5s-390x844.png'),
    at3p8s: await shotAt(3800, 'v45-3p8s-390x844.png'),
    gone4p6s: await shotAt(4600, 'v45-gone-4p6s-390x844.png'),
  };

  await pollPromise;

  return { paths, timings };
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

function parseRgbCss(color) {
  const m = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] !== undefined ? Math.round(Number(m[4]) * 255) : 255,
  };
}

function isGoldBorderPixel(r, g, b, a) {
  return a >= 200 && r > 200 && g >= 160 && g <= 215 && b >= 70 && b <= 140;
}

/**
 * @returns {Promise<{ ok: boolean, details: object }>}
 */
async function checkGoldRing(page, { expectRing }) {
  const tile = page.getByTestId('dial-yield-tile');
  await tile.waitFor({ state: 'visible' });

  const styleReport = await tile.evaluate((el) => {
    const tileStyle = window.getComputedStyle(el);
    return {
      hasRingClass: el.classList.contains('perfect-shot-yield-ring'),
      tileOpacity: tileStyle.opacity,
      tileBoxShadow: tileStyle.boxShadow,
      tileBorderTopColor: tileStyle.borderTopColor,
    };
  });

  const ratio = await page.getByTestId('dial-yield-ratio').textContent();
  const box = await tile.boundingBox();
  let pixelGold = false;
  let samplePixels = [];

  if (box && expectRing) {
    const pad = 6;
    const clip = {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    };
    const buffer = await page.screenshot({ clip });
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const tileLeft = pad;
    const tileTop = pad;
    const tileW = box.width;
    const tileH = box.height;
    const midX = tileLeft + Math.floor(tileW / 2);
    const midY = tileTop + Math.floor(tileH / 2);
    const points = [
      { name: 'top-out', x: midX, y: Math.max(0, tileTop - 2) },
      { name: 'right-out', x: Math.min(info.width - 1, tileLeft + tileW + 1), y: midY },
      { name: 'bottom-out', x: midX, y: Math.min(info.height - 1, Math.floor(tileTop + tileH) + 1) },
      { name: 'left-out', x: Math.max(0, tileLeft - 2), y: midY },
    ];
    for (const pt of points) {
      const x = Math.floor(pt.x);
      const y = Math.floor(pt.y);
      const idx = (y * info.width + x) * 4;
      const px = { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] };
      const gold = isGoldBorderPixel(px.r, px.g, px.b, px.a);
      samplePixels.push({ ...pt, x, y, ...px, gold });
      if (gold) pixelGold = true;
    }
    pixelGold = pixelGold || samplePixels.some((p) => p.gold);
  }

  const borderRgb = parseRgbCss(styleReport.tileBorderTopColor);
  const borderGold = borderRgb ? isGoldBorderPixel(borderRgb.r, borderRgb.g, borderRgb.b, borderRgb.a) : false;
  const shadowGold = String(styleReport.tileBoxShadow).includes('240, 194, 106')
    || String(styleReport.tileBoxShadow).includes('f0c26a');
  const tileOpacityOk = Math.abs(Number(styleReport.tileOpacity) - 1) < 0.02;

  const ok = expectRing
    ? styleReport.hasRingClass
      && tileOpacityOk
      && shadowGold
      && pixelGold
      && ratio?.includes('on target')
    : !styleReport.hasRingClass && tileOpacityOk;

  return {
    ok,
    details: {
      expectRing,
      ...styleReport,
      borderRgb,
      borderGold,
      shadowGold,
      tileOpacityOk,
      pixelGold,
      samplePixels,
      ratio,
    },
  };
}

async function assertRingVisible(page) {
  const report = await checkGoldRing(page, { expectRing: true });
  if (!report.ok) {
    throw new Error(`Gold ring check failed: ${JSON.stringify(report.details)}`);
  }
  return report;
}

async function captureYieldRingZoom(page, outPath) {
  const tile = page.getByTestId('dial-yield-tile');
  const box = await tile.boundingBox();
  if (!box) throw new Error('Yield tile missing for zoom crop');
  const pad = 8;
  const buffer = await page.screenshot({
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    },
  });
  await sharp(buffer)
    .resize({ width: Math.round(box.width * 3) })
    .png()
    .toFile(outPath);
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
  const ring = await assertRingVisible(page);
  const prefix = variantLabel === 'gold' ? 'egg-gold' : 'egg-normal';
  const shotPath = path.join(OUT_DIR, `${prefix}-${tag}-${VERSION_TAG}.png`);
  await page.screenshot({ path: shotPath, fullPage: false });

  if (tag === '390x844' && variantLabel === 'suit') {
    const zoomPath = path.join(OUT_DIR, `egg-ring-zoom-390x844-${VERSION_TAG}.png`);
    await captureYieldRingZoom(page, zoomPath);
  }

  return { shotPath, overlap, ring, variantLabel, tag };
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
  const afterRing = await checkGoldRing(page, { expectRing: false });
  if (!afterRing.ok) {
    throw new Error(`After fade ring/opacity check failed at ${tag}: ${JSON.stringify(afterRing.details)}`);
  }
  return { afterPath, afterRing };
}

async function captureRealFlowOnTarget(page, viewport, url) {
  const { tag } = viewport;
  await page.setViewportSize(viewport);
  await openDialFresh(page, url);
  await fillDialShotFields(page, { yieldG: '36', timeS: '28', taste: 'Balanced' });
  await scrollCelebrationTargets(page);
  await page.getByRole('button', { name: /Log shot & calculate grind adjustment/i }).click();
  await waitForCameo(page);
  const ring = await assertRingVisible(page);
  const overlap = await checkCameoOverlap(page);
  const shotPath = path.join(OUT_DIR, `egg-realflow-${tag}-${VERSION_TAG}.png`);
  await page.screenshot({ path: shotPath, fullPage: false });
  await waitForCelebrationGone(page);
  return { shotPath, overlap, ring, tag };
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
  const ringReports = [];
  const manifest = [];

  try {
    await waitForServer(url);
    const browser = await chromium.launch();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();

    try {
      const v45 = await captureV45Timeline(page, url);
      manifest.push({ path: v45.paths.at0p6s, kind: 'v45-0p6s' });
      manifest.push({ path: v45.paths.at2p5s, kind: 'v45-2p5s' });
      manifest.push({ path: v45.paths.at3p8s, kind: 'v45-3p8s' });
      manifest.push({ path: v45.paths.gone4p6s, kind: 'v45-gone' });
      process.stderr.write(`v45 timings: ${JSON.stringify(v45.timings)}\n`);

      if (process.env.SHOT_EGG_V45_ONLY === '1') {
        console.log(JSON.stringify({ manifest, v45Timings: v45.timings }, null, 2));
        return;
      }

      for (const viewport of VIEWPORTS) {
        const normal = await captureSevenTapPair(page, viewport, url, 'suit');
        manifest.push({ path: normal.shotPath, kind: 'normal' });
        overlapReports.push({ viewport: viewport.tag, variant: 'suit', ...normal.overlap });
        ringReports.push({ viewport: viewport.tag, variant: 'suit', ...normal.ring });

        const gold = await captureSevenTapPair(page, viewport, url, 'gold');
        manifest.push({ path: gold.shotPath, kind: 'gold' });
        overlapReports.push({ viewport: viewport.tag, variant: 'gold', ...gold.overlap });
        ringReports.push({ viewport: viewport.tag, variant: 'gold', ...gold.ring });

        const after = await captureAfterFade(page, viewport, url);
        manifest.push({ path: after.afterPath, kind: 'after' });
        ringReports.push({ viewport: viewport.tag, variant: 'after', ...after.afterRing });

        const real = await captureRealFlowOnTarget(page, viewport, url);
        manifest.push({ path: real.shotPath, kind: 'realflow' });
        overlapReports.push({ viewport: viewport.tag, variant: 'realflow', ...real.overlap });
        ringReports.push({ viewport: viewport.tag, variant: 'realflow', ...real.ring });

        const nearPath = await captureNearMiss(page, viewport, url);
        manifest.push({ path: nearPath, kind: 'nearmiss' });

        for (const entry of manifest.slice(-5)) {
          process.stderr.write(`ok ${entry.path}\n`);
        }
      }

      console.log(JSON.stringify({ manifest, overlapReports, ringReports, v45Timings: v45.timings }, null, 2));

      let failed = false;
      for (const report of overlapReports) {
        if (!report.ok) {
          console.error('overlap fail', report);
          failed = true;
        }
      }
      for (const report of ringReports) {
        if (!report.ok) {
          console.error('ring fail', report);
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
