#!/usr/bin/env node
/**
 * Gauge tap setup v2 screenshots (fixture frame, real calibrateFromTaps flow).
 * Requires: npm run build first.
 * Run: /workspace/bin/box-test-slot node scripts/lab-tap-gauge-screenshots.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ROOT, startPreviewServer, waitForServer } from './lib/previewServer.mjs';
import { ISAAC_GAUGE_DIAL_FOCUS, ISAAC_GAUGE_TAPS } from '../src/flairPressureLab/fixtures/isaacGaugeTapCoords.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = '/workspace/pl-state/lab-tap';
const PORT = 4181;
const FIXTURE = '/flair-pressure-lab/fixtures/isaac-gauge-crop.jpg';

const VIEWPORTS = [
  { width: 390, height: 844, tag: '390x844' },
  { width: 360, height: 640, tag: '360x640' },
];

/** Must match fixture hook initialFocus + initialHalf in this script. */
const FIXTURE_CROP = {
  cx: ISAAC_GAUGE_DIAL_FOCUS.x,
  cy: ISAAC_GAUGE_DIAL_FOCUS.y,
  half: 125,
};

function videoPointToScreen(vp, box, crop, mirror = false) {
  if (!box || !crop) return null;
  let lx = (vp.x - (crop.cx - crop.half)) / (2 * crop.half);
  const ly = (vp.y - (crop.cy - crop.half)) / (2 * crop.half);
  if (mirror) lx = 1 - lx;
  return { x: box.x + lx * box.width, y: box.y + ly * box.height };
}

async function currentCrop(page) {
  const crop = await page.evaluate(() => window.__labGaugeTapViewState?.crop);
  return crop ?? FIXTURE_CROP;
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
  await page.evaluate(({ labEnabled }) => new Promise((resolve, reject) => {
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
        labCameraPressureEnabled: labEnabled,
        lastSelectedBeanId: 'lab-bean',
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
  }), { labEnabled: labOn });
}

async function openGaugeSheet(page) {
  await page.goto(`http://127.0.0.1:${PORT}/#/`, { waitUntil: 'networkidle' });
  await clearDb(page);
  await seedDb(page, { labOn: true });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTitle('Settings').click();
  await page.getByTestId('lab-gauge-calibrate-link').click();
  await page.getByLabel('Close gauge setup').waitFor({ timeout: 15_000 });
}

async function viewportBox(page) {
  return page.getByTestId('gauge-tap-viewport').boundingBox();
}

async function placeVideoTap(page, videoPoint) {
  const box = await viewportBox(page);
  const crop = await currentCrop(page);
  const screen = videoPointToScreen(videoPoint, box, crop, false);
  if (!screen) throw new Error('could not map video tap to screen');
  const localX = screen.x - box.x;
  const localY = screen.y - box.y;
  await page.getByTestId('gauge-tap-viewport').click({ position: { x: localX, y: localY } });
  await page.getByRole('button', { name: 'Confirm tap' }).click();
  await page.waitForTimeout(120);
}

async function captureLabOff(page, tag) {
  await clearDb(page);
  await seedDb(page, { labOn: false });
  await page.reload({ waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT_DIR, `v2-lab-off-${tag}.png`) });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const distIndex = path.join(ROOT, 'dist', 'index.html');
  const { default: fs } = await import('node:fs');
  if (!fs.existsSync(distIndex)) {
    throw new Error('Run production build before screenshots (dist/index.html missing).');
  }

  const server = startPreviewServer(PORT);
  await waitForServer(`http://127.0.0.1:${PORT}/`);

  async function runInconsistent(vp) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
    });
    await context.addInitScript(({ fixture, origin, focus }) => {
      window.__labGaugeTapFixture = {
        src: `${origin}${fixture}`,
        autoFreeze: true,
        mirror: false,
        initialFocus: focus,
        initialHalf: 125,
      };
    }, {
      fixture: FIXTURE,
      origin: `http://127.0.0.1:${PORT}`,
      focus: ISAAC_GAUGE_DIAL_FOCUS,
    });
    const page = await context.newPage();
    try {
      await openGaugeSheet(page);
      await page.getByText(/Frame held.*centre marker/i).waitFor({ timeout: 20_000 });
      await page.waitForTimeout(400);
      const { centre, five, ten } = ISAAC_GAUGE_TAPS;
      await placeVideoTap(page, centre);
      await placeVideoTap(page, { x: five.x + 45, y: five.y + 50 });
      await placeVideoTap(page, { x: ten.x + 50, y: ten.y + 45 });
      await page.getByTestId('gauge-tap-note').filter({ hasText: /miss|line up|printed/i }).waitFor({ timeout: 15_000 });
      await page.screenshot({ path: path.join(OUT_DIR, `v2-inconsistent-${vp.tag}.png`) });
    } catch (err) {
      process.stderr.write(`v2-inconsistent-${vp.tag} skipped: ${err.message}\n`);
    } finally {
      await context.close();
    }
  }

  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
      });
      await context.addInitScript(({ fixture, origin, focus }) => {
        window.__labGaugeTapFixture = {
          src: `${origin}${fixture}`,
          autoFreeze: true,
          mirror: false,
          initialFocus: focus,
          initialHalf: 125,
        };
      }, {
        fixture: FIXTURE,
        origin: `http://127.0.0.1:${PORT}`,
        focus: ISAAC_GAUGE_DIAL_FOCUS,
      });

      const page = await context.newPage();
      await openGaugeSheet(page);
      await page.getByText(/Frame held.*centre marker/i).waitFor({ timeout: 20_000 });
      await page.getByTestId('gauge-tap-viewport').waitFor({ timeout: 15_000 });
      await page.screenshot({ path: path.join(OUT_DIR, `v2-frozen-zoomed-${vp.tag}.png`) });

      const centre = ISAAC_GAUGE_TAPS.centre;
      const box = await viewportBox(page);
      const cScreen = videoPointToScreen(centre, box, await currentCrop(page), false);
      await page.mouse.move(cScreen.x, cScreen.y);
      await page.mouse.down();
      await page.mouse.move(cScreen.x + 4, cScreen.y - 3);
      await page.mouse.up();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT_DIR, `v2-marker-centre-${vp.tag}.png`) });
      await placeVideoTap(page, centre);

      await placeVideoTap(page, ISAAC_GAUGE_TAPS.five);
      const ten = ISAAC_GAUGE_TAPS.ten;
      const box2 = await viewportBox(page);
      const tScreen = videoPointToScreen(ten, box2, await currentCrop(page), false);
      await page.mouse.click(tScreen.x, tScreen.y);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT_DIR, `v2-marker-ten-${vp.tag}.png`) });
      await page.getByRole('button', { name: 'Confirm tap' }).click();

      await page.getByRole('button', { name: 'Accept calibration' }).waitFor({ timeout: 25_000 });
      const meta = await page.getByTestId('gauge-review-meta').textContent();
      if (!meta || !/Hub at \(39[0-9], 50[0-9]/.test(meta)) {
        const note = await page.getByTestId('gauge-tap-note').textContent();
        throw new Error(`review failed meta=${meta} note=${note}`);
      }
      await page.screenshot({ path: path.join(OUT_DIR, `v2-review-rays-${vp.tag}.png`) });

      await captureLabOff(page, vp.tag);
      await context.close();
      await runInconsistent(vp);
    }
  } finally {
    await browser.close();
    await server.kill();
  }
  process.stdout.write('v2 lab-tap screenshots written to /workspace/pl-state/lab-tap/\n');
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err}\n`);
  process.exit(1);
});
