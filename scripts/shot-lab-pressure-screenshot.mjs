#!/usr/bin/env node
/**
 * Preview screenshot: shot screen at 390×844 with simulated scale + pressure.
 * Requires: npm run build:scale (VITE_SCALE_ALLOW_SIM) and VITE_PRESSURE_ALLOW_SIM=true build.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT_DIR = '/workspace/pl-state/lab-screens';
const VIEWPORT = { width: 390, height: 844 };

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173';
  await page.addInitScript(() => {
    const settings = {
      id: 'global',
      labCameraPressureEnabled: true,
      smartScaleDeviceId: 'simulated',
    };
    localStorage.setItem('espresso-dialin.global-settings-v1', JSON.stringify(settings));
  });
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const outPath = path.join(OUT_DIR, 'shot-lab-pressure-390x844.png');
  await page.screenshot({ path: outPath, fullPage: false });
  await browser.close();
  console.log('Wrote', outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
