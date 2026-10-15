#!/usr/bin/env node
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import { startPreviewServer, waitForServer } from '../lib/previewServer.mjs';
import { assessPressureLabPrivacy } from './privacyAssert.js';

const y4mPath = process.argv[2];
const durationS = Number(process.argv[3]);
const port = Number(process.argv[4] || 4176);

if (!y4mPath || !durationS) {
  console.error('usage: run-clip-browser.mjs <y4m> <durationS> [port]');
  process.exit(2);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function captureClip(context, previewUrl, { cpuThrottleRate = 1, waitMs }) {
  const requests = [];
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  if (cpuThrottleRate > 1) {
    await client.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottleRate });
  }

  await page.addInitScript(() => {
    window.__pressureLabPrivacy = { localStorageWrites: 0, indexedDbWrites: 0 };
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      window.__pressureLabPrivacy.localStorageWrites += 1;
      return origSet.call(this, key, value);
    };
    if (typeof indexedDB !== 'undefined' && indexedDB.open) {
      const origOpen = indexedDB.open.bind(indexedDB);
      indexedDB.open = (...args) => {
        window.__pressureLabPrivacy.indexedDbWrites += 1;
        return origOpen(...args);
      };
    }
  });

  page.on('request', (req) => {
    const post = req.postDataBuffer();
    requests.push({
      url: req.url(),
      method: req.method(),
      postBytes: post ? post.length : 0,
    });
  });

  page.on('pageerror', (err) => console.error('pageerror:', err));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('console:', msg.text());
  });

  await page.goto(`${previewUrl}#/flair-pressure-lab`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__pressureLabReplay?.getFrames, null, { timeout: 120_000 });
  const startBtn = page.getByRole('button', { name: /Start front camera/i });
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
  }
  await page.waitForTimeout(2000);
  await page.waitForFunction(
    () => (window.__pressureLabReplay?.getFrames?.() || []).length > 3,
    null,
    { timeout: 120_000 },
  );
  await delay(waitMs);
  const frames = await page.evaluate(() => window.__pressureLabReplay.getFrames());
  const storage = await page.evaluate(() => window.__pressureLabPrivacy || { localStorageWrites: 0, indexedDbWrites: 0 });
  await page.close();
  return { frames, requests, storage };
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

    const waitMs = Math.ceil(durationS * 1500) + 3500;
    const mainRun = await captureClip(context, preview.url, { cpuThrottleRate: 1, waitMs });
    const throttleRun = await captureClip(context, preview.url, {
      cpuThrottleRate: 4,
      waitMs: Math.min(waitMs, Math.ceil(durationS * 800) + 2500),
    });

    const privacy = assessPressureLabPrivacy(mainRun.requests, mainRun.storage, preview.url);
    const processMs = mainRun.frames.map((f) => f.processMs).filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
    const throttledMs = throttleRun.frames.map((f) => f.processMs).filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);

    const payload = {
      frames: mainRun.frames,
      privacy,
      timing: {
        processMsMedian: percentile(processMs, 50),
        processMsP95: percentile(processMs, 95),
        throttled4xMedian: percentile(throttledMs, 50),
        throttled4xP95: percentile(throttledMs, 95),
      },
    };
    process.stdout.write(JSON.stringify(payload));
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
