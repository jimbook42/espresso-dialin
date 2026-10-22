import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadPressureReplayManifest, resolveClipPath } from '/workspace/cursor-dialin-6.39/scripts/pressure-replay/manifest.js';
import { discoverGaugeInFrame, readRectifiedPressure, registerDialRotationFromProfile } from '/workspace/cursor-dialin-6.39/src/flairPressureLab/gaugeTrack.js';
import { setOpenCvForTests } from '/workspace/cursor-dialin-6.39/src/flairPressureLab/opencvRuntime.js';
import { rectifyGaugeFace } from '/workspace/cursor-dialin-6.39/src/flairPressureLab/faceRectify.js';
import { prepareEdges } from '/workspace/cursor-dialin-6.39/src/flairPressureLab/framePrep.js';
import { detectNeedleAngle, refineNeedleAngle } from '/workspace/cursor-dialin-6.39/src/flairPressureLab/needleFromFrame.js';
import { TIP_INNER_RATIO, OUTER_RADIUS_RATIO, angleToBar, wrap360 } from '/workspace/cursor-dialin-6.39/src/flairPressureLab/gaugeConfig.js';
import { FLAIR_STATELESS_SESSION } from '/workspace/cursor-dialin-6.39/src/flairPressureLab/canonicalDial.js';
import { measureDialColorBands, registerDialFromColorBands } from '/workspace/cursor-dialin-6.39/src/flairPressureLab/colorRegistration.js';
import { ESPRESSO_SECTOR } from '/workspace/cursor-dialin-6.39/src/flairPressureLab/dialFaceTemplate.js';
import {
  configureNeedleRuntime,
  decodeNeedleOutput,
  prepareRegisteredFace,
  NEEDLE_INPUT_SIZE,
  NEEDLE_MODEL_INPUT,
  NEEDLE_MODEL_OUTPUT,
} from '/workspace/cursor-dialin-6.39/src/flairPressureLab/needleModel.js';

const ROOT = '/workspace/cursor-dialin-6.39';
const OPENCV_PATH = path.join(ROOT, 'public/flair-pressure-lab/opencv.js');

function probeSize(videoPath) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', videoPath,
  ], { encoding: 'utf8' }).trim();
  const [width, height] = out.split('x').map(Number);
  return { width, height };
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
  const loaded = require(copy);
  const cv = await loaded;
  setOpenCvForTests(cv);
  return cv;
}

async function main() {
  const cv = await loadCv();
  const require = createRequire(import.meta.url);
  const ort = await import('onnxruntime-web/wasm');
  const wasmDir = path.dirname(require.resolve('onnxruntime-web'));
  configureNeedleRuntime(ort, `${pathToFileURL(wasmDir).href}/`);
  const modelBytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'public/flair-pressure-lab/needle.onnx')));
  const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
  const manifest = loadPressureReplayManifest();
  const times = [0.4, 1.2, 2.4];
  for (let index = 0; index < manifest.clips.length; index += 1) {
    const clip = manifest.clips[index];
    const videoPath = resolveClipPath(clip, process.env.FLAIR_REPLAY_DIR);
    if (!fs.existsSync(videoPath)) {
      console.log(index, 'missing');
      continue;
    }
    const { width, height } = probeSize(videoPath);
    for (const timeS of times) {
      const frame = readFrame(videoPath, timeS, width, height);
      if (!frame) continue;
      const found = discoverGaugeInFrame(frame);
      if (!found?.ok) {
        console.log(index, timeS, 'nodial');
        continue;
      }
      const classical = readRectifiedPressure(frame, found);
      const rectified = rectifyGaugeFace(cv, frame, found);
      if (!rectified?.ok) {
        console.log(index, timeS, 'norect', classical.bar);
        continue;
      }
      const sink = {};
      let needle = detectNeedleAngle(
        rectified.image, rectified.cx, rectified.cy,
        rectified.radius * TIP_INNER_RATIO, rectified.radius * OUTER_RADIUS_RATIO, sink,
      );
      needle.angleDeg = refineNeedleAngle(
        rectified.image, rectified.cx, rectified.cy,
        rectified.radius * TIP_INNER_RATIO, rectified.radius * OUTER_RADIUS_RATIO, needle.angleDeg,
      );
      const edges = prepareEdges(rectified.image, {
        contrastRadius: Math.max(2, Math.round(rectified.radius * 0.05)),
      }).edges;
      const { measureRimProfile } = await import('/workspace/cursor-dialin-6.39/src/flairPressureLab/gaugeTrack.js');
      const profile = measureRimProfile(
        edges, rectified.image.width, rectified.image.height,
        rectified.cx, rectified.cy, rectified.radius,
        { bins: 360, innerRatio: 0.76, outerRatio: 0.88 },
      );
      const reg = registerDialRotationFromProfile(profile, needle.angleDeg);
      async function modelAt(rotationDeg) {
        const data = prepareRegisteredFace(
          rectified.image, rectified.cx, rectified.cy, rectified.radius, rotationDeg,
        );
        const output = await session.run({
          [NEEDLE_MODEL_INPUT]: new ort.Tensor('float32', data, [1, 3, NEEDLE_INPUT_SIZE, NEEDLE_INPUT_SIZE]),
        });
        return decodeNeedleOutput(output[NEEDLE_MODEL_OUTPUT].data);
      }
      const bands = measureDialColorBands(
        rectified.image, rectified.cx, rectified.cy, rectified.radius, needle.angleDeg,
      );
      const color = registerDialFromColorBands(bands);
      const plus = await modelAt(reg.rotationDeg || 0);
      const byColor = await modelAt(color.rotationDeg || 0);
      const none = await modelAt(0);
      const rel = wrap360(needle.angleDeg - (reg.rotationDeg || 0));
      const colorRel = wrap360(needle.angleDeg - (color.rotationDeg || 0));
      function redDeg(rotationDeg) {
        const data = prepareRegisteredFace(
          rectified.image, rectified.cx, rectified.cy, rectified.radius, rotationDeg,
        );
        const plane = NEEDLE_INPUT_SIZE * NEEDLE_INPUT_SIZE;
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (let j = 0; j < NEEDLE_INPUT_SIZE; j += 1) {
          for (let i = 0; i < NEEDLE_INPUT_SIZE; i += 1) {
            const o = j * NEEDLE_INPUT_SIZE + i;
            const r = data[o];
            const g = data[plane + o];
            const b = data[2 * plane + o];
            if (r < 0.45 || r < g + 0.12 || r < b + 0.12) continue;
            const dx = (i + 0.5) / NEEDLE_INPUT_SIZE - 0.5;
            const dy = (j + 0.5) / NEEDLE_INPUT_SIZE - 0.5;
            if (dx * dx + dy * dy < 0.04) continue;
            sx += dx;
            sy += dy;
            n += 1;
          }
        }
        if (n < 8) return null;
        return wrap360((Math.atan2(sy, sx) * 180) / Math.PI);
      }
      const mid = (ESPRESSO_SECTOR.startDeg + ESPRESSO_SECTOR.endDeg) / 2;
      const red0 = redDeg(0);
      const redC = redDeg(color.rotationDeg || 0);
      console.log([
        index,
        timeS.toFixed(1),
        `r${Math.round(rectified.radius)}`,
        `tmpl${reg.ok ? 1 : 0}/${Math.round(reg.rotationDeg || 0)}`,
        `col${color.ok ? 1 : 0}/${Math.round(color.rotationDeg || 0)}`,
        `cls${classical.bar == null ? 'na' : classical.bar.toFixed(2)}`,
        `relT${angleToBar(rel, FLAIR_STATELESS_SESSION)?.toFixed(2) ?? 'na'}`,
        `relC${angleToBar(colorRel, FLAIR_STATELESS_SESSION)?.toFixed(2) ?? 'na'}`,
        `mT${plus.bar == null ? 'na' : plus.bar.toFixed(2)}/${plus.confidence.toFixed(2)}`,
        `mC${byColor.bar == null ? 'na' : byColor.bar.toFixed(2)}/${byColor.confidence.toFixed(2)}`,
        `m0${none.bar == null ? 'na' : none.bar.toFixed(2)}/${none.confidence.toFixed(2)}`,
        `red0${red0 == null ? 'na' : Math.round(red0)}`,
        `redC${redC == null ? 'na' : Math.round(redC)}`,
        `mid${Math.round(mid)}`,
        rectified.warped ? 'w' : 'c',
      ].join(' '));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
