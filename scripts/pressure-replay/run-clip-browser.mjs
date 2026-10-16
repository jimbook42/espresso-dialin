#!/usr/bin/env node
import { chromium } from 'playwright';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { startPreviewServer, waitForServer } from '../lib/previewServer.mjs';
import { assessPressureLabPrivacy } from './privacyAssert.js';

const y4mPath = process.argv[2];
const durationS = Number(process.argv[3]);
const port = Number(process.argv[4] || 4176);
const mp4Path = process.argv[5];

if (!y4mPath || !durationS || !mp4Path) {
  console.error('usage: run-clip-browser.mjs <y4m> <durationS> [port] <mp4>');
  process.exit(2);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function captureClip(context, previewUrl, { cpuThrottleRate = 1, durationS, frameDir, frameCount }) {
  const requests = [];
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  if (cpuThrottleRate > 1) {
    await client.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottleRate });
  }

  // Same span the camera harness used: it kept sampling for 1.5× the file
  // plus the startup wait, and the fake camera looped under that clock.
  const untilS = durationS * 1.5 + 5.5;
  await page.route('**/replay-frames/*.png', (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    if (!/^\d{4}\.png$/.test(name)) {
      return route.abort();
    }
    return route.fulfill({
      path: path.join(frameDir, name),
      contentType: 'image/png',
    });
  });
  await page.addInitScript((cfg) => {
    window.__pressureReplayDurationS = cfg.durationS;
    window.__pressureReplayUntilS = cfg.untilS;
    window.__pressureReplayFrameCount = cfg.frameCount;
    window.__pressureReplayFrameBase = cfg.frameBase;
  }, {
    durationS,
    untilS,
    frameCount,
    frameBase: new URL('/replay-frames/', previewUrl).href,
  });

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
  await page.waitForFunction(() => window.__pressureLabOpenCvReady === true, null, { timeout: 180_000 });
  await page.waitForFunction(() => window.__pressureLabReplay?.getFrames, null, { timeout: 120_000 });
  // The lab opens the camera itself once OpenCV and the worker are warm.
  // Clicking Start again resets the tracker after the fake video has moved.
  await page.waitForFunction(() => window.__pressureLabPipelineReady === true, null, { timeout: 180_000 });
  await page.waitForFunction(
    () => window.__pressureReplayDrained === true || Boolean(window.__pressureReplayError),
    null,
    { timeout: Math.ceil(durationS * 1000) + 180_000 },
  );
  const replayError = await page.evaluate(() => window.__pressureReplayError || '');
  if (replayError) throw new Error(replayError);
  const frames = await page.evaluate(() => window.__pressureLabReplay.getFrames());
  const storage = await page.evaluate(() => window.__pressureLabPrivacy || { localStorageWrites: 0, indexedDbWrites: 0 });
  await page.close();
  return { frames, requests, storage };
}

function extractReplayFrames(src) {
  const dest = path.join('/tmp', `pressure-frames-png-${path.basename(src, '.mp4')}`);
  const stamp = path.join(dest, '.ok');
  const fresh = fs.existsSync(stamp) && fs.statSync(stamp).mtimeMs >= fs.statSync(src).mtimeMs;
  if (!fresh) {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    // One still per 125ms slot, from the start of the file. Both replays
    // read these bytes, so a seek cannot pick a different picture.
    const result = spawnSync('ffmpeg', [
      '-y', '-i', src, '-vf', 'fps=8', path.join(dest, '%04d.png'),
    ], { stdio: 'ignore' });
    if (result.status !== 0) throw new Error(`frame extract failed for ${src}`);
    fs.writeFileSync(stamp, 'ok');
  }
  const names = fs.readdirSync(dest).filter((name) => /^\d{4}\.png$/.test(name));
  if (!names.length) throw new Error(`no frames extracted for ${src}`);
  return { frameDir: dest, frameCount: names.length };
}

async function main() {
  const { frameDir, frameCount } = extractReplayFrames(mp4Path);
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

    const mainRun = await captureClip(context, preview.url, { cpuThrottleRate: 1, durationS, frameDir, frameCount });
    const throttleRun = await captureClip(context, preview.url, { cpuThrottleRate: 4, durationS, frameDir, frameCount });

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
