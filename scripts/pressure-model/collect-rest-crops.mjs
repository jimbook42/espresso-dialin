/**
 * Registered 64×64 rest crops from the dry bench clips.
 * Labels come from the replay manifest (the printed bar those clips sit at).
 * A crop is kept only when the classical relative bar already matches that label,
 * using the same rotation priority as the live reader (template, else colour).
 * Writes uint8 tensors under scripts/pressure-model/data. No frames are saved.
 *
 *   node scripts/pressure-model/collect-rest-crops.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadPressureReplayManifest, resolveClipPath } from '../pressure-replay/manifest.js';
import {
  discoverGaugeInFrame,
  measureRimProfile,
  registerDialRotationFromProfile,
} from '../../src/flairPressureLab/gaugeTrack.js';
import { setOpenCvForTests } from '../../src/flairPressureLab/opencvRuntime.js';
import { rectifyGaugeFace } from '../../src/flairPressureLab/faceRectify.js';
import { prepareEdges } from '../../src/flairPressureLab/framePrep.js';
import { detectNeedleAngle, refineNeedleAngle } from '../../src/flairPressureLab/needleFromFrame.js';
import {
  NEEDLE_LIKENESS_GATE,
  TIP_INNER_RATIO,
  OUTER_RADIUS_RATIO,
  angleToBar,
  wrap360,
} from '../../src/flairPressureLab/gaugeConfig.js';
import { FLAIR_STATELESS_SESSION } from '../../src/flairPressureLab/canonicalDial.js';
import { measureDialColorBands, registerDialFromColorBands } from '../../src/flairPressureLab/colorRegistration.js';
import { NEEDLE_INPUT_SIZE, prepareRegisteredFace } from '../../src/flairPressureLab/needleModel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(__dirname, 'data');
const OPENCV_PATH = path.join(ROOT, 'public/flair-pressure-lab/opencv.js');
const SAMPLES = 16;

function probeSize(videoPath) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', videoPath,
  ], { encoding: 'utf8' }).trim();
  const [width, height] = out.split('x').map(Number);
  return { width, height };
}

function probeDuration(videoPath) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath,
  ], { encoding: 'utf8' }).trim();
  return Number(out) || 4;
}

function readFrame(videoPath, timeS, width, height) {
  const data = execFileSync('ffmpeg', [
    '-v', 'error', '-ss', String(timeS), '-i', videoPath,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ], { maxBuffer: width * height * 4 + 1024 });
  if (data.length < width * height * 4) return null;
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, width * height * 4),
    width,
    height,
  };
}

async function loadCv() {
  const copy = path.join(os.tmpdir(), 'flair-pressure-opencv.cjs');
  fs.copyFileSync(OPENCV_PATH, copy);
  const require = createRequire(path.join(os.tmpdir(), 'flair-pressure-opencv-load.cjs'));
  const cv = await require(copy);
  setOpenCvForTests(cv);
  return cv;
}

function sampleTimes(durationS) {
  const start = durationS * 0.12;
  const end = durationS * 0.88;
  const times = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    times.push(start + ((end - start) * i) / Math.max(1, SAMPLES - 1));
  }
  return times;
}

async function main() {
  const cv = await loadCv();
  const manifest = loadPressureReplayManifest();
  const plane = NEEDLE_INPUT_SIZE * NEEDLE_INPUT_SIZE;
  const chunks = [];
  const angleDeg = [];
  const confidence = [];
  let seen = 0;
  let missed = 0;
  for (const clip of manifest.clips) {
    const videoPath = resolveClipPath(clip, process.env.FLAIR_REPLAY_DIR);
    if (!fs.existsSync(videoPath)) continue;
    const { width, height } = probeSize(videoPath);
    const duration = probeDuration(videoPath);
    for (const timeS of sampleTimes(duration)) {
      seen += 1;
      const frame = readFrame(videoPath, timeS, width, height);
      if (!frame) continue;
      const found = discoverGaugeInFrame(frame);
      if (!found?.ok) continue;
      const rectified = rectifyGaugeFace(cv, frame, found);
      if (!rectified?.ok) continue;
      const sink = {};
      let needle = detectNeedleAngle(
        rectified.image,
        rectified.cx,
        rectified.cy,
        rectified.radius * TIP_INNER_RATIO,
        rectified.radius * OUTER_RADIUS_RATIO,
        sink,
      );
      needle.angleDeg = refineNeedleAngle(
        rectified.image,
        rectified.cx,
        rectified.cy,
        rectified.radius * TIP_INNER_RATIO,
        rectified.radius * OUTER_RADIUS_RATIO,
        needle.angleDeg,
      );
      if ((needle.likeness ?? 0) < NEEDLE_LIKENESS_GATE) {
        missed += 1;
        continue;
      }
      const edges = prepareEdges(rectified.image, {
        contrastRadius: Math.max(2, Math.round(rectified.radius * 0.05)),
      }).edges;
      const profile = measureRimProfile(
        edges,
        rectified.image.width,
        rectified.image.height,
        rectified.cx,
        rectified.cy,
        rectified.radius,
        { bins: 360, innerRatio: 0.76, outerRatio: 0.88 },
      );
      const template = registerDialRotationFromProfile(profile, needle.angleDeg);
      const bands = measureDialColorBands(
        rectified.image,
        rectified.cx,
        rectified.cy,
        rectified.radius,
        needle.angleDeg,
      );
      const color = registerDialFromColorBands(bands);
      const candidates = [];
      if (template.ok) candidates.push(template.rotationDeg);
      if (color.ok) candidates.push(color.rotationDeg);
      let rotation = null;
      let relative = null;
      for (const candidate of candidates) {
        const angle = wrap360(needle.angleDeg - candidate);
        const bar = angleToBar(angle, FLAIR_STATELESS_SESSION);
        if (bar == null || Math.abs(bar - clip.expectedBar) > clip.tolerance) continue;
        rotation = candidate;
        relative = angle;
        break;
      }
      if (rotation == null) {
        missed += 1;
        continue;
      }
      const tensor = prepareRegisteredFace(
        rectified.image,
        rectified.cx,
        rectified.cy,
        rectified.radius,
        rotation,
      );
      const rgb = Buffer.alloc(plane * 3);
      for (let i = 0; i < plane; i += 1) {
        rgb[i * 3] = Math.round(tensor[i] * 255);
        rgb[i * 3 + 1] = Math.round(tensor[plane + i] * 255);
        rgb[i * 3 + 2] = Math.round(tensor[2 * plane + i] * 255);
      }
      chunks.push(rgb);
      angleDeg.push(relative);
      confidence.push(1);
    }
  }
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'rest-images.bin'), Buffer.concat(chunks));
  fs.writeFileSync(path.join(DATA, 'rest-labels.json'), JSON.stringify({
    size: NEEDLE_INPUT_SIZE,
    count: chunks.length,
    angleDeg,
    confidence,
    easy: angleDeg.map(() => 0),
  }));
  process.stderr.write(`rest crops ${chunks.length} from ${seen} samples, skipped ${missed}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
