#!/usr/bin/env node
/**
 * Derive a single replay crop from a reference frame (geometry only — no manifest bar values).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCK = '/tmp/box-test.lock';
const DEFAULT_FRAME = '/workspace/flair-replay/720/20261015_225219.mp4';
const REFERENCE_STILL = process.env.FLAIR_REPLAY_REFERENCE_STILL
  || '/workspace/flair-replay/20261015_225359.jpg';
const OUT_SPEC = path.join(__dirname, 'replayCrop.json');
const TARGET_NR = 0.28;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function even(n) {
  const v = Math.round(n);
  return v % 2 === 0 ? v : v + 1;
}

function extractVideoFrame(videoPath, pngPath, timeS = 1) {
  execFileSync(
    'ffmpeg',
    ['-y', '-ss', String(timeS), '-i', videoPath, '-frames:v', '1', pngPath],
    { stdio: 'pipe' },
  );
}

async function loadGreyFrame(inputPath, isVideo) {
  const tmp = path.join('/tmp', `replay-crop-src-${Date.now()}.png`);
  if (isVideo) extractVideoFrame(inputPath, tmp);
  else await sharp(inputPath).rotate().resize({ height: 720, withoutEnlargement: false }).png().toFile(tmp);
  const { data, info } = await sharp(tmp).greyscale().raw().toBuffer({ resolveWithObject: true });
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  return { data, width: info.width, height: info.height };
}

/** Score how strongly a circle at (cx,cy,r) matches a gauge rim. */
function scoreRim(data, width, height, cx, cy, radius) {
  const samples = 48;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < samples; i += 1) {
    const a = (i / samples) * Math.PI * 2;
    const x = Math.round(cx + radius * Math.cos(a));
    const y = Math.round(cy + radius * Math.sin(a));
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
    const inner = (y * width + x) - 1;
    const outer = (y * width + x) + 1;
    const edge = Math.abs(data[inner] - data[outer]);
    sum += edge;
    count += 1;
  }
  return count ? sum / count : 0;
}

function locateGaugeRim(data, width, height) {
  let best = { cx: width * 0.59, cy: height * 0.49, radius: 55, score: 0 };
  for (let cy = Math.round(height * 0.35); cy <= Math.round(height * 0.65); cy += 6) {
    for (let cx = Math.round(width * 0.45); cx <= Math.round(width * 0.75); cx += 6) {
      for (let radius = 40; radius <= 75; radius += 5) {
        const score = scoreRim(data, width, height, cx, cy, radius);
        if (score > best.score) best = { cx, cy, radius, score };
      }
    }
  }
  return best;
}

export function buildCropFromGauge(gauge, frameW, frameH, targetNr = TARGET_NR) {
  const targetR = targetNr * Math.min(frameW, frameH);
  const cropSize = even((gauge.radius * 2 * frameW) / targetR);
  const cropW = cropSize;
  const cropH = cropSize;
  let x = Math.round(gauge.cx - cropW / 2);
  let y = Math.round(gauge.cy - cropH / 2);
  x = even(clamp(x, 0, frameW - cropW));
  y = even(clamp(y, 0, frameH - cropH));
  return {
    sourceGauge: { cx: gauge.cx, cy: gauge.cy, radius: gauge.radius },
    frame: { w: frameW, h: frameH },
    crop: { x, y, w: cropW, h: cropH },
    output: { w: frameW, h: frameH },
    targetNr,
    targetRadiusPx: targetR,
  };
}

async function main() {
  const videoPath = process.argv[2] || DEFAULT_FRAME;
  const useVideo = fs.existsSync(videoPath);
  const sourcePath = useVideo ? videoPath : REFERENCE_STILL;
  const { data, width, height } = await loadGreyFrame(sourcePath, useVideo);
  const located = locateGaugeRim(data, width, height);
  const spec = buildCropFromGauge(located, width, height);
  spec.source = sourcePath;
  spec.rimScore = located.score;
  spec.notes = 'Single crop for all replay clips; geometry from reference frame only.';
  fs.writeFileSync(OUT_SPEC, `${JSON.stringify(spec, null, 2)}\n`);
  process.stdout.write(`Wrote ${OUT_SPEC} gauge@(${located.cx},${located.cy}) r=${located.radius} score=${located.score.toFixed(2)}\n`);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
