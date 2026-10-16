#!/usr/bin/env node
/**
 * Build seeded small-gauge variants of the dry clips.
 * The measured dial is used only to composite. Replay scoring receives
 * expected bar from the dry manifest and no positions.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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
    const text = fs.readFileSync(OPENCV_PATH, 'utf8');
    (0, eval)(text);
    const cv = await globalThis.cv;
    if (cv?.Mat) setOpenCvForTests(cv);
  } catch (err) {
    process.stderr.write(`OpenCV unavailable for compositing measure (${err?.message || err}); using the rim search\n`);
  }
}

function measureDial(videoPath, width, height) {
  for (const timeS of [0.4, 1.2, 2.5, 0]) {
    const frame = readFrame(videoPath, timeS, width, height);
    if (!frame) continue;
    const found = discoverGaugeInFrame(frame);
    if (found?.ok && found.radius > 8) {
      return { cx: found.cx, cy: found.cy, radius: found.radius, timeS };
    }
  }
  return null;
}

function num(value) {
  return Number(value).toFixed(3);
}

function buildFilter(plan) {
  const { compositing: c } = plan;
  const s = c.outSide;
  const pinch = c.pinch;
  const x0 = s * pinch;
  const y0 = 0;
  const x1 = s * (1 - pinch);
  const y1 = 0;
  const x2 = 0;
  const y2 = s;
  const x3 = s;
  const y3 = s;
  const hot = c.hotspot;
  const occ = c.occluder;
  const add = (cx, cy, rx, ry, gain) => `if(lt(hypot((X-${num(cx)})/${num(rx)},(Y-${num(cy)})/${num(ry)}),1),${gain},0)`;
  const expr = `clip(p(X,Y)+${add(hot.cx, hot.cy, hot.rx, hot.ry, 170)}-${add(occ.cx, occ.cy, occ.rx, occ.ry, 150)},0,255)`;
  return [
    `crop=${c.cropSide}:${c.cropSide}:${c.cropX}:${c.cropY}`,
    `scale=${s}:${s}:flags=bilinear`,
    `perspective=${num(x0)}:${num(y0)}:${num(x1)}:${num(y1)}:${num(x2)}:${num(y2)}:${num(x3)}:${num(y3)}:sense=destination`,
    `pad=${SYNTHETIC_WIDTH}:${SYNTHETIC_HEIGHT}:${c.originX}:${c.originY}:black`,
    'format=rgb24',
    `geq=r='${expr.replaceAll('p(X,Y)', 'r(X,Y)')}':g='${expr.replaceAll('p(X,Y)', 'g(X,Y)')}':b='${expr.replaceAll('p(X,Y)', 'b(X,Y)')}'`,
  ].join(',');
}

function renderClip(sourcePath, destPath, plan) {
  execFileSync('ffmpeg', [
    '-y',
    '-i', sourcePath,
    '-vf', buildFilter(plan),
    '-an',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    destPath,
  ], { stdio: 'inherit' });
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
    const dial = measureDial(sourcePath, width, height);
    if (!dial) throw new Error(`no dial measured for compositing ${clip.id}`);
    const variant = planSmallGaugeVariant({
      clipId: clip.id,
      frameWidth: width,
      frameHeight: height,
      dialCx: dial.cx,
      dialCy: dial.cy,
      dialRadius: dial.radius,
    });
    const row = scoringClip(clip, variant);
    const dest = path.join(OUT_DIR, row.file);
    process.stderr.write(
      `${clip.id} dial r=${dial.radius.toFixed(1)} at ${dial.cx.toFixed(0)},${dial.cy.toFixed(0)} `
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
