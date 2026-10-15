#!/usr/bin/env node
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import { startPreviewServer, waitForServer } from '../lib/previewServer.mjs';

const y4mPath = process.argv[2];
const durationS = Number(process.argv[3]);
const port = Number(process.argv[4] || 4176);

if (!y4mPath || !durationS) {
  console.error('usage: run-clip-browser.mjs <y4m> <durationS> [port]');
  process.exit(2);
}

async function main() {
  const preview = startPreviewServer(port);
  await waitForServer(preview.url);
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${y4mPath}`,
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  try {
    const context = await browser.newContext();
    await context.grantPermissions(['camera'], { origin: 'http://127.0.0.1' });
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error('pageerror:', err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('console:', msg.text());
    });
    await page.goto(`${preview.url}#/flair-pressure-lab`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => window.__pressureLabReplay?.getFrames, null, { timeout: 60_000 });
    const startBtn = page.getByRole('button', { name: /Start front camera/i });
    if (await startBtn.isVisible().catch(() => false)) {
      await startBtn.click();
    }
    await page.waitForTimeout(2000);
    await page.waitForFunction(
      () => (window.__pressureLabReplay?.getFrames?.() || []).length > 3,
      null,
      { timeout: 90_000 },
    );
    await delay(Math.ceil(durationS * 1500) + 3500);
    const frames = await page.evaluate(() => window.__pressureLabReplay.getFrames());
    process.stdout.write(JSON.stringify(frames));
    await context.close();
  } catch (err) {
    try {
      const page = browser.contexts()[0]?.pages()[0];
      if (page) {
        const debug = await page.evaluate(() => {
          const video = document.querySelector('video');
          return {
            hook: Boolean(window.__pressureLabReplay),
            frames: window.__pressureLabReplay?.getFrames?.()?.length ?? 0,
            hash: window.location.hash,
            videoReady: video?.readyState ?? null,
            videoWxH: video ? `${video.videoWidth}x${video.videoHeight}` : null,
            statusText: document.body?.innerText?.slice(0, 800),
          };
        });
        console.error('replay debug:', JSON.stringify(debug));
      }
    } catch {
      // ignore debug failures
    }
    await browser.close();
    await preview.kill();
    throw err;
  }
  await browser.close();
  await preview.kill();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
