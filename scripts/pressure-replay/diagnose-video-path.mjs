#!/usr/bin/env node
/**
 * Replay-build video-path probe. Numeric trace only — no frames leave the page.
 * Usage: node diagnose-video-path.mjs <y4m> <mp4> [outDir]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from '../lib/previewServer.mjs';

const y4mPath = process.argv[2];
const mp4Path = process.argv[3];
const outDir = process.argv[4] || '/tmp/632dbg';
const port = Number(process.env.PRESSURE_REPLAY_PORT || 4182);

if (!y4mPath || !mp4Path) {
  console.error('usage: diagnose-video-path.mjs <y4m> <mp4> [outDir]');
  process.exit(2);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
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
  let trace = [];
  try {
    const context = await browser.newContext();
    await context.grantPermissions(['camera'], { origin: 'http://127.0.0.1' });
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error('pageerror:', err));
    await page.goto(`${preview.url}#/flair-pressure-lab`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__pressureLabOpenCvReady === true, null, { timeout: 180_000 });
    await page.waitForFunction(
      () => Array.isArray(window.__pressureLabVideoTrace) && window.__pressureLabVideoTrace.length >= 8,
      null,
      { timeout: 60_000 },
    );
    await page.waitForTimeout(1500);
    trace = await page.evaluate(() => window.__pressureLabVideoTrace || []);
    await context.close();
  } finally {
    await browser.close();
    await preview.kill();
  }

  fs.writeFileSync(path.join(outDir, 'trace.json'), `${JSON.stringify(trace, null, 2)}\n`);
  const seed = trace.find((row) => row.event === 'seed' || row.event === 'discovery-reject');
  if (!seed) {
    console.error('no discovery event in trace');
    process.exit(1);
  }
  const frameIndex = seed.frameIndex ?? 0;
  const framePath = path.join(outDir, `frame-${String(frameIndex).padStart(4, '0')}.png`);
  execFileSync('ffmpeg', [
    '-y', '-i', mp4Path,
    '-vf', `select=eq(n\\,${frameIndex})`,
    '-frames:v', '1',
    '-update', '1',
    framePath,
  ], { stdio: 'inherit' });
  const summary = {
    frameIndex,
    t: seed.t,
    video: `${seed.videoW}x${seed.videoH}`,
    track: seed.track,
    canvas: seed.canvasW == null ? null : `${seed.canvasW}x${seed.canvasH}`,
    scaleX: seed.scaleX,
    scaleY: seed.scaleY,
    dpr: seed.dpr,
    element: `${seed.elementW}x${seed.elementH}`,
    discoveryCanvas: seed.discoveryCanvas,
    discoveryVideo: seed.discoveryVideo,
    seededPose: seed.after?.pose ?? null,
    event: seed.event,
    framePath,
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
