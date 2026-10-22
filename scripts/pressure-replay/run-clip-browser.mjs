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
  console.error('usage: run-clip-browser.mjs <y4m> <durationS> [port] <mp4> [taps.json]');
  process.exit(2);
}

/**
 * How qc.sh turns on tap tracking. The lab has no clip names in it.
 * Pass one of:
 *   PRESSURE_TAP_CAL=/path/to/taps.json
 *   PRESSURE_TAP_CAL=cx,cy,fx,fy,tx,ty
 *   a 6th argument that is a taps.json path
 *   or <mp4>.taps.json beside the source video
 * JSON: { "atSec": 0, "centre": [x, y], "five": [x, y], "ten": [x, y] }
 * Pixels are unmirrored video pixels. atSec is the rest moment; the lab
 * calibrates only inside the half-second that starts there. Omit atSec to
 * calibrate on the first frame that locks (clips that open on the rest shot).
 * This file is copied onto window.__pressureLabTapCal before the page boots.
 */
function loadTapCal() {
  const raw = process.env.PRESSURE_TAP_CAL || process.argv[6] || '';
  if (!raw) {
    const sidecar = `${mp4Path}.taps.json`;
    if (!fs.existsSync(sidecar)) return null;
    return JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  }
  if (raw.includes(',')) {
    const nums = raw.split(/[,\s]+/).map(Number);
    if (nums.length < 6 || nums.some((n) => !Number.isFinite(n))) {
      throw new Error('PRESSURE_TAP_CAL needs cx,cy,fx,fy,tx,ty');
    }
    return {
      centre: [nums[0], nums[1]],
      five: [nums[2], nums[3]],
      ten: [nums[4], nums[5]],
    };
  }
  return JSON.parse(fs.readFileSync(raw, 'utf8'));
}

const tapCal = loadTapCal();

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
    if (cfg.tapCal) window.__pressureLabTapCal = cfg.tapCal;
  }, {
    durationS,
    untilS,
    frameCount,
    frameBase: new URL('/replay-frames/', previewUrl).href,
    tapCal,
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
  const smoothness = await page.evaluate(() => window.__pressureReplaySmoothness?.() || { longTasks: 0, scaleTicks: 0, slots: 0 });
  await page.close();
  return { frames, requests, storage, smoothness };
}

function extractReplayFrames(src) {
  const dest = path.join('/workspace/pl-data/frames', `pressure-frames-png-${path.basename(src, '.mp4')}`);
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
    const series = (run, key) => run.frames
      .map((frame) => frame[key])
      .filter((value) => value != null && !Number.isNaN(value))
      .sort((a, b) => a - b);
    const processedPct = (run) => {
      const slots = run.smoothness?.slots || 0;
      if (!slots) return null;
      return (run.frames.length / slots) * 100;
    };

    const payload = {
      frames: mainRun.frames,
      privacy,
      timing: {
        processMsMedian: percentile(series(mainRun, 'processMs'), 50),
        processMsP95: percentile(series(mainRun, 'processMs'), 95),
        throttled4xMedian: percentile(series(throttleRun, 'processMs'), 50),
        throttled4xP95: percentile(series(throttleRun, 'processMs'), 95),
        e2eMedian: percentile(series(mainRun, 'e2eMs'), 50),
        e2eP95: percentile(series(mainRun, 'e2eMs'), 95),
        e2e4xMedian: percentile(series(throttleRun, 'e2eMs'), 50),
        e2e4xP95: percentile(series(throttleRun, 'e2eMs'), 95),
        mainMedian: percentile(series(mainRun, 'mainThreadMs'), 50),
        mainP95: percentile(series(mainRun, 'mainThreadMs'), 95),
        main4xMedian: percentile(series(throttleRun, 'mainThreadMs'), 50),
        main4xP95: percentile(series(throttleRun, 'mainThreadMs'), 95),
        cvMedian: percentile(series(mainRun, 'cvMs'), 50),
        cvP95: percentile(series(mainRun, 'cvMs'), 95),
        cv4xMedian: percentile(series(throttleRun, 'cvMs'), 50),
        cv4xP95: percentile(series(throttleRun, 'cvMs'), 95),
        stageTrack4xP95: percentile(series(throttleRun, 'stageTrack'), 95),
        stageTrackDraw4xP95: percentile(series(throttleRun, 'stageTrackDraw'), 95),
        stageNeedle4xP95: percentile(series(throttleRun, 'stageNeedle'), 95),
        stageNeedleDraw4xP95: percentile(series(throttleRun, 'stageNeedleDraw'), 95),
        stageDiscovery4xP95: percentile(series(throttleRun, 'stageDiscovery'), 95),
        stageTrackBlit4xP95: percentile(series(throttleRun, 'stageTrackBlit'), 95),
        stageTrackRead4xP95: percentile(series(throttleRun, 'stageTrackRead'), 95),
        stageTrackResize4xP95: percentile(series(throttleRun, 'stageTrackResize'), 95),
        stageTrackOutput4xP95: percentile(series(throttleRun, 'stageTrackOutput'), 95),
        stageTrack4xMax: series(throttleRun, 'stageTrack').at(-1) ?? null,
        stageTrackDraw4xMax: series(throttleRun, 'stageTrackDraw').at(-1) ?? null,
        stageNeedle4xMax: series(throttleRun, 'stageNeedle').at(-1) ?? null,
        stageNeedleDraw4xMax: series(throttleRun, 'stageNeedleDraw').at(-1) ?? null,
        stageDiscovery4xMax: series(throttleRun, 'stageDiscovery').at(-1) ?? null,
        e2e4xOver50: series(throttleRun, 'e2eMs').filter((value) => value > 50).length,
        discDraw4xP95: percentile(series(throttleRun, 'discDrawMs'), 95),
        discWait4xP95: percentile(series(throttleRun, 'discWaitMs'), 95),
        readWall4xP95: percentile(series(throttleRun, 'readWallMs'), 95),
        discDraw4xMedian: percentile(series(throttleRun, 'discDrawMs'), 50),
        discWait4xMedian: percentile(series(throttleRun, 'discWaitMs'), 50),
        readWall4xMedian: percentile(series(throttleRun, 'readWallMs'), 50),
        sync4xP95: percentile(series(throttleRun, 'syncMs'), 95),
        readPaths4x: Object.fromEntries(['reading', 'no-pose', 'no-position', 'rim-weak', 'drop', 'no-crop', 'no-needle-crop'].map((path) => {
          const rows = throttleRun.frames.filter((frame) => frame.readPath === path);
          const walls = rows.map((frame) => frame.readWallMs).filter((value) => value != null).sort((a, b) => a - b);
          return [path, { n: rows.length, readP95: percentile(walls, 95) }];
        })),
        e2e4xMax: series(throttleRun, 'e2eMs').at(-1) ?? null,
        framesProcessedPct: processedPct(mainRun),
        framesProcessed4xPct: processedPct(throttleRun),
        longTasks: mainRun.smoothness?.longTasks ?? null,
        longTasks4x: throttleRun.smoothness?.longTasks ?? null,
        harnessLongTasks: mainRun.smoothness?.harnessLongTasks ?? null,
        appLongTasks: mainRun.smoothness?.appLongTasks ?? null,
        harnessLongTasks4x: throttleRun.smoothness?.harnessLongTasks ?? null,
        appLongTasks4x: throttleRun.smoothness?.appLongTasks ?? null,
        workerMedian: percentile([...(mainRun.smoothness?.searchDurations || [])].sort((a, b) => a - b), 50),
        workerP95: percentile([...(mainRun.smoothness?.searchDurations || [])].sort((a, b) => a - b), 95),
        worker4xMedian: percentile([...(throttleRun.smoothness?.searchDurations || [])].sort((a, b) => a - b), 50),
        worker4xP95: percentile([...(throttleRun.smoothness?.searchDurations || [])].sort((a, b) => a - b), 95),
        searchPct: mainRun.frames.length
          ? (mainRun.frames.filter((frame) => frame.searchNeeded).length / mainRun.frames.length) * 100
          : null,
        search4xPct: throttleRun.frames.length
          ? (throttleRun.frames.filter((frame) => frame.searchNeeded).length / throttleRun.frames.length) * 100
          : null,
        longTaskMax4x: throttleRun.smoothness?.longTaskMax ?? null,
        longTaskDurations4x: throttleRun.smoothness?.longTaskDurations ?? null,
        scaleTicks4x: throttleRun.smoothness?.scaleTicks ?? null,
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
