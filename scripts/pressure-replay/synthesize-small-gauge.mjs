#!/usr/bin/env node
/**
 * Build seeded small-gauge variants of the dry clips.
 * The measured dial is used only to composite. Replay scoring receives
 * expected bar from the dry manifest and no positions.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadPressureReplayManifest, resolveClipPath } from './manifest.js';
import {
  SYNTHETIC_HEIGHT,
  SYNTHETIC_WIDTH,
  planSmallGaugeVariant,
  scoringClip,
} from './syntheticLayout.js';
import { discoverGaugeInFrame } from '../../src/flairPressureLab/gaugeTrack.js';
import { setOpenCvForTests } from '../../src/flairPressureLab/opencvRuntime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = process.env.FLAIR_SYNTHETIC_DIR || '/workspace/flair-replay/synthetic';
const OPENCV_PATH = path.join(ROOT, 'public/flair-pressure-lab/opencv.js');

function probeSize(videoPath) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0:s=x',
    videoPath,
  ], { encoding: 'utf8' }).trim();
  const [width, height] = out.split('x').map(Number);
  if (!width || !height) throw new Error(`no size for ${videoPath}`);
  return { width, height };
}

function readFrame(videoPath, timeS, width, height) {
  const data = execFileSync('ffmpeg', [
    '-v', 'error',
    '-ss', String(timeS),
    '-i', videoPath,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    'pipe:1',
  ], { maxBuffer: width * height * 4 + 1024 });
  if (data.length < width * height * 4) return null;
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, width * height * 4),
    width,
    height,
  };
}

async function loadCv() {
  if (!fs.existsSync(OPENCV_PATH)) return;
  try {
    // The bundle calls require('fs') on Node. The app package is ESM, so load
    // a .cjs copy from outside the package, where that require exists.
    const copy = path.join(os.tmpdir(), 'flair-pressure-opencv.cjs');
    fs.copyFileSync(OPENCV_PATH, copy);
    const require = createRequire(path.join(os.tmpdir(), 'flair-pressure-opencv-load.cjs'));
    const loaded = require(copy);
    const cv = await loaded;
    if (cv?.Mat) setOpenCvForTests(cv);
    else process.stderr.write('OpenCV loaded without Mat; using the rim search\n');
  } catch (err) {
    process.stderr.write(`OpenCV unavailable for compositing measure (${err?.message || err}); using the rim search\n`);
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measureDials(videoPath, width, height) {
  const hits = [];
  for (const timeS of [0.2, 0.6, 1.0, 1.6, 2.4, 3.5, 5, 8]) {
    const frame = readFrame(videoPath, timeS, width, height);
    if (!frame) continue;
    const found = discoverGaugeInFrame(frame);
    if (found?.ok && found.confidence >= 0.22 && found.radius >= 20) {
      hits.push({ cx: found.cx, cy: found.cy, radius: found.radius, confidence: found.confidence });
    }
  }
  if (!hits.length) return null;
  const ranked = [...hits].sort((a, b) => b.confidence - a.confidence);
  const core = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2)));
  const mx = median(core.map((item) => item.cx));
  const my = median(core.map((item) => item.cy));
  const mr = median(core.map((item) => item.radius));
  const near = hits.filter((item) => Math.hypot(item.cx - mx, item.cy - my) <= mr * 2.5);
  return near.length ? near : core;
}

function num(value) {
  return Number(value).toFixed(3);
}

function paintEllipse(data, width, height, shape, rgba) {
  const x0 = Math.max(0, Math.floor(shape.cx - shape.rx));
  const x1 = Math.min(width - 1, Math.ceil(shape.cx + shape.rx));
  const y0 = Math.max(0, Math.floor(shape.cy - shape.ry));
  const y1 = Math.min(height - 1, Math.ceil(shape.cy + shape.ry));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = (x - shape.cx) / shape.rx;
      const dy = (y - shape.cy) / shape.ry;
      if (dx * dx + dy * dy > 1) continue;
      const o = (y * width + x) * 4;
      data[o] = rgba[0];
      data[o + 1] = rgba[1];
      data[o + 2] = rgba[2];
      data[o + 3] = rgba[3];
    }
  }
}

function writeOverlay(plan, dest) {
  const data = Buffer.alloc(SYNTHETIC_WIDTH * SYNTHETIC_HEIGHT * 4);
  paintEllipse(data, SYNTHETIC_WIDTH, SYNTHETIC_HEIGHT, plan.compositing.hotspot, [255, 250, 235, 200]);
  paintEllipse(data, SYNTHETIC_WIDTH, SYNTHETIC_HEIGHT, plan.compositing.occluder, [8, 8, 10, 220]);
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${SYNTHETIC_WIDTH}x${SYNTHETIC_HEIGHT}`,
    '-i', 'pipe:0',
    '-frames:v', '1',
    dest,
  ], { input: data, stdio: ['pipe', 'inherit', 'inherit'] });
}

function buildFilter(plan) {
  const { compositing: c } = plan;
  const pinch = c.pinch;
  const corners = [
    c.outW * pinch, 0,
    c.outW * (1 - pinch), 0,
    0, c.outH,
    c.outW, c.outH,
  ].map(num).join(':');
  return [
    `crop=${c.cropW}:${c.cropH}:${c.cropX}:${c.cropY}`,
    `scale=${c.outW}:${c.outH}:flags=bilinear`,
    `perspective=${corners}:sense=destination`,
    `pad=${SYNTHETIC_WIDTH}:${SYNTHETIC_HEIGHT}:${c.originX}:${c.originY}:black`,
    'format=rgba',
  ].join(',');
}

function renderClip(sourcePath, destPath, plan) {
  const overlay = `${destPath}.overlay.png`;
  writeOverlay(plan, overlay);
  try {
    execFileSync('ffmpeg', [
      '-y',
      '-i', sourcePath,
      '-i', overlay,
      '-filter_complex', `[0:v]${buildFilter(plan)}[base];[base][1:v]overlay=0:0:format=auto`,
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '18',
      destPath,
    ], { stdio: 'inherit' });
  } finally {
    fs.rmSync(overlay, { force: true });
  }
}

async function main() {
  await loadCv();
  const manifest = loadPressureReplayManifest();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const clips = [];
  for (const clip of manifest.clips) {
    const sourcePath = resolveClipPath(clip);
    if (!fs.existsSync(sourcePath)) throw new Error(`missing dry clip ${sourcePath}`);
    const { width, height } = probeSize(sourcePath);
    const dials = measureDials(sourcePath, width, height);
    if (!dials?.length) throw new Error(`no dial measured for compositing ${clip.id}`);
    const variant = planSmallGaugeVariant({
      clipId: clip.id,
      frameWidth: width,
      frameHeight: height,
      observations: dials,
    });
    const row = scoringClip(clip, variant);
    const dest = path.join(OUT_DIR, row.file);
    const sample = dials[0];
    process.stderr.write(
      `${clip.id} ${dials.length} sightings, first r=${sample.radius.toFixed(1)} at ${sample.cx.toFixed(0)},${sample.cy.toFixed(0)} `
      + `→ diameter ${variant.compositing.diameter.toFixed(1)} → ${dest}\n`,
    );
    renderClip(sourcePath, dest, variant);
    clips.push(row);
  }
  const manifestPath = path.join(__dirname, 'synthetic-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify({ version: 1, clips }, null, 2)}\n`);
  process.stdout.write(`Wrote ${manifestPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
