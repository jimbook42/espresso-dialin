#!/usr/bin/env node
/**
 * Gauge tap setup screenshots (simulated fixture frame, no real camera).
 * Requires: npm run build first.
 * Run: /workspace/bin/box-test-slot node scripts/lab-tap-gauge-screenshots.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ROOT, startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = '/workspace/pl-state/lab-tap';
const PORT = 4181;
const FIXTURE = '/flair-pressure-lab/fixtures/isaac-gauge-crop.jpg';

const VIEWPORTS = [
  { width: 390, height: 844, tag: '390x844' },
  { width: 360, height: 640, tag: '360x640' },
];

/** Fractions on the frozen frame box (Isaac crop, gauge ~centre-left). */
const TAP_FRACS = {
  centre: { x: 0.48, y: 0.58 },
  five: { x: 0.38, y: 0.54 },
  ten: { x: 0.58, y: 0.54 },
};

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
        labCameraPressureEnabled: true,
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
  }));
}

async function placeTap(page, frac) {
  const frame = page.locator('.touch-none').filter({ has: page.locator('canvas') }).first();
  const box = await frame.boundingBox();
  if (!box) throw new Error('frame box missing');
  const x = box.x + box.width * frac.x;
  const y = box.y + box.height * frac.y;
  await page.mouse.click(x, y);
  await page.getByRole('button', { name: 'Confirm tap' }).click();
}

async function openGaugeSheet(page) {
  await page.goto(`http://127.0.0.1:${PORT}/#/`, { waitUntil: 'networkidle' });
  await seedDb(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /gauge setup/i }).first().click();
  await page.getByText('Gauge setup (3 taps)').waitFor({ timeout: 15_000 });
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
      await context.addInitScript(({ fixture }) => {
        window.__labGaugeTapFixture = { src: fixture, autoFreeze: true };
      }, { fixture: FIXTURE });

      const page = await context.newPage();
      await openGaugeSheet(page);
      await page.getByText(/Frame held|Place marker on gauge centre/i).waitFor({ timeout: 20_000 });

      await page.screenshot({
        path: path.join(OUT_DIR, `v1-frozen-full-${vp.tag}.png`),
      });

      const frame = page.locator('.touch-none').filter({ has: page.locator('canvas') }).first();
      const box = await frame.boundingBox();
      if (!box) throw new Error('frame missing for loupe shot');
      const cx = box.x + box.width * TAP_FRACS.centre.x;
      const cy = box.y + box.height * TAP_FRACS.centre.y;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 6, cy - 4);
      await page.mouse.up();
      await page.locator('canvas').nth(1).waitFor({ state: 'visible', timeout: 5000 });
      await page.screenshot({
        path: path.join(OUT_DIR, `v1-zoom-marker-${vp.tag}.png`),
      });

      await page.getByRole('button', { name: 'Confirm tap' }).click();
      await placeTap(page, TAP_FRACS.five);
      await placeTap(page, TAP_FRACS.ten);
      await page.getByText(/Check rays|Accept calibration/i).waitFor({ timeout: 25_000 });
      await page.screenshot({
        path: path.join(OUT_DIR, `v1-review-rays-${vp.tag}.png`),
      });
      await context.close();
    }
  } finally {
    await browser.close();
    await server.kill();
  }
  process.stdout.write('lab-tap gauge screenshots written to /workspace/pl-state/lab-tap/\n');
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err}\n`);
  process.exit(1);
});
