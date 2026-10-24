#!/usr/bin/env node
/**
 * Dial centre from the same tracker Phase 1 uses (discoverGaugeInFrame).
 * Prints one JSON object. Frames are decoded here and dropped.
 *
 *   node scripts/needle-reader/poses.mjs <video> [count]
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setOpenCvForTests } from '../../src/flairPressureLab/opencvRuntime.js';
import { discoverGaugeInFrame } from '../../src/flairPressureLab/gaugeTrack.js';

const WIDTH = 1280;
const HEIGHT = 720;
const FRAME_BYTES = WIDTH * HEIGHT * 4;
const file = process.argv[2];
const count = Number(process.argv[3] || 24);
if (!file) {
  process.stderr.write('usage: poses.mjs <video> [count]\n');
  process.exit(2);
}

function memAvailableMb() {
  const text = spawnSync('awk', ['/MemAvailable/ {print $2}', '/proc/meminfo'], { encoding: 'utf8' });
  return Number(text.stdout) / 1024;
}

function videoMeta() {
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_frames,r_frame_rate,duration',
    '-of', 'json', file,
  ], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(`ffprobe ${file}`);
  const stream = JSON.parse(probe.stdout).streams[0];
  const [num, den] = String(stream.r_frame_rate).split('/').map(Number);
  const fps = den ? num / den : num;
  const duration = Number(stream.duration);
  let frames = Number(stream.nb_frames);
  if (!Number.isFinite(frames) || frames <= 0) frames = Math.round(duration * fps);
  return { fps, frames };
}

function sampleIndices(frameCount, n) {
  const lo = Math.min(frameCount - 1, Math.floor(frameCount * 0.05));
  const hi = Math.max(lo + 1, Math.ceil(frameCount * 0.95) - 1);
  const span = hi - lo + 1;
  const take = Math.min(n, span);
  const indices = [];
  for (let i = 0; i < take; i += 1) indices.push(lo + Math.floor(((i + 0.5) * span) / take));
  return [...new Set(indices)];
}

function decode(indices) {
  const select = indices.map((index) => `eq(n\\,${index})`).join('+');
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-noautorotate',
    '-i', file,
    '-vf', `select='${select}',scale=${WIDTH}:${HEIGHT}:flags=bicubic`,
    '-fps_mode', 'vfr',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
  ], { maxBuffer: FRAME_BYTES * (indices.length + 2) });
  if (result.status !== 0) throw new Error(`ffmpeg ${file}`);
  const frames = [];
  for (let offset = 0; offset + FRAME_BYTES <= result.stdout.length; offset += FRAME_BYTES) {
    frames.push(result.stdout.subarray(offset, offset + FRAME_BYTES));
  }
  return frames;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (!sorted.length) return null;
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

let cv = createRequire(new URL('../../package.json', import.meta.url))('@techstark/opencv-js');
if (typeof cv?.then === 'function') cv = await cv;
if (!cv.Mat) await new Promise((resolve) => { cv.onRuntimeInitialized = resolve; });
setOpenCvForTests(cv);

const meta = videoMeta();
const indices = sampleIndices(meta.frames, count);
const frames = decode(indices);
const poses = [];
for (let i = 0; i < frames.length; i += 1) {
  const image = { width: WIDTH, height: HEIGHT, data: new Uint8ClampedArray(frames[i].buffer, frames[i].byteOffset, frames[i].byteLength) };
  const found = discoverGaugeInFrame(image);
  if (found?.ok && found.radius > 8) {
    poses.push({ index: indices[i], cx: found.cx, cy: found.cy, radius: found.radius, source: 'tracker' });
  } else {
    poses.push({ index: indices[i], ok: false });
  }
}
const good = poses.filter((pose) => pose.radius > 8);
const stable = good.length ? {
  cx: median(good.map((pose) => pose.cx)),
  cy: median(good.map((pose) => pose.cy)),
  radius: median(good.map((pose) => pose.radius)),
  frames: meta.frames,
  tracked: good.length,
  sampled: poses.length,
} : null;
process.stdout.write(JSON.stringify({ memMb: memAvailableMb(), stable, poses }) + '\n');
