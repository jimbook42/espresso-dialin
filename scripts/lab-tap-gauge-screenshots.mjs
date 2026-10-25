#!/usr/bin/env node
/**
 * Gauge tap setup v3 screenshots (fixture frame, trusted taps, loupe fill).
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

async function moveMarkerToVideoPoint(page, videoPoint) {
  const box = await viewportBox(page);
  const crop = await currentCrop(page);
  const screen = videoPointToScreen(videoPoint, box, crop, false);
  if (!screen) throw new Error('could not map video tap to screen');
  await page.mouse.move(screen.x, screen.y);
  await page.mouse.down();
  await page.mouse.move(screen.x + 2, screen.y - 1);
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function loupeFillRatio(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="gauge-tap-loupe"]');
    if (!canvas) return 0;
    const loupeSize = canvas.width || canvas.clientWidth;
    const ctx = canvas.getContext('2d');
    if (!ctx || !loupeSize) return 0;
    const data = ctx.getImageData(0, 0, loupeSize, loupeSize).data;
    const cx = loupeSize / 2;
    const cy = loupeSize / 2;
    const r = loupeSize / 2 - 2;
    let inside = 0;
    let filled = 0;
    for (let y = 0; y < loupeSize; y += 1) {
      for (let x = 0; x < loupeSize; x += 1) {
        if (Math.hypot(x - cx, y - cy) > r) continue;
        inside += 1;
        const a = data[(y * loupeSize + x) * 4 + 3];
        if (a > 8) filled += 1;
      }
    }
    return inside ? filled / inside : 0;
  });
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

      const centre = ISAAC_GAUGE_TAPS.centre;
      await moveMarkerToVideoPoint(page, centre);
      let fill = await loupeFillRatio(page);
      if (fill < 0.95) {
        throw new Error(`v3-loupe-centre fill=${fill.toFixed(3)} on ${vp.tag}`);
      }
      await page.screenshot({ path: path.join(OUT_DIR, `v3-loupe-centre-${vp.tag}.png`) });

      const crop = await currentCrop(page);
      const edgePoint = {
        x: crop.cx - crop.half + 8,
        y: crop.cy - crop.half + 8,
      };
      await moveMarkerToVideoPoint(page, edgePoint);
      fill = await loupeFillRatio(page);
      if (fill < 0.95) {
        throw new Error(`v3-loupe-edge fill=${fill.toFixed(3)} on ${vp.tag}`);
      }
      await page.screenshot({ path: path.join(OUT_DIR, `v3-loupe-edge-${vp.tag}.png`) });

      await placeVideoTap(page, centre);
      await placeVideoTap(page, ISAAC_GAUGE_TAPS.five);
      const ten = ISAAC_GAUGE_TAPS.ten;
      await moveMarkerToVideoPoint(page, ten);
      await page.getByRole('button', { name: 'Confirm tap' }).click();

      await page.getByRole('button', { name: 'Accept calibration' }).waitFor({ timeout: 25_000 });
      const meta = await page.getByTestId('gauge-review-meta').textContent();
      const hubX = ISAAC_GAUGE_TAPS.centre.x;
      const hubY = ISAAC_GAUGE_TAPS.centre.y;
      const hubRe = new RegExp(`Hub at \\(${hubX}, ${hubY}\\)`);
      if (!meta || !hubRe.test(meta)) {
        const note = await page.getByTestId('gauge-tap-note').textContent();
        throw new Error(`review hub mismatch meta=${meta} expected (${hubX}, ${hubY}) note=${note}`);
      }
      await page.screenshot({ path: path.join(OUT_DIR, `v3-review-rays-${vp.tag}.png`) });
      await context.close();
    }
  } finally {
    await browser.close();
    await server.kill();
  }
  process.stdout.write('v3 lab-tap screenshots written to /workspace/pl-state/lab-tap/\n');
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err}\n`);
  process.exit(1);
});
