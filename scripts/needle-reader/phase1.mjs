#!/usr/bin/env node
/**
 * Phase 1 gate. One command:
 *   TZ=UTC node scripts/needle-reader/phase1.mjs
 *
 * Fits the Flair anchors, checks the rest photo, and compares the Python
 * and JS rectify tensors on real /workspace/flair-train frames.
 * Writes /workspace/pl-state/nr/phase1-parity.txt and .json.
 * Frames are decoded in this process and dropped. Nothing is saved into the app.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { proposeGaugeCandidate } from '../../src/flairPressureLab/faceRectify.js';
import { discoverGaugeInFrame } from '../../src/flairPressureLab/gaugeTrack.js';
import {
  buildFlair58Profile,
  fitAnchorsFromLabels,
  parseGaugeProfile,
} from '../../src/flairPressureLab/gaugeProfile.js';
import {
  measureTensorAngle,
  rectifyNeedle,
} from '../../src/flairPressureLab/needleRectify.js';
import { setOpenCvForTests } from '../../src/flairPressureLab/opencvRuntime.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LABELS = path.join(ROOT, 'scripts/pressure-label/fixtures/labels-2026-10-22.json');
const PROFILE_PATH = path.join(ROOT, 'profiles/flair58-v1.json');
const PHOTO = '/workspace/flair-train/dry/20261015_225359.jpg';
const TRAIN = '/workspace/flair-train';
const OUT_TXT = '/workspace/pl-state/nr/phase1-parity.txt';
const OUT_JSON = '/workspace/pl-state/nr/phase1-parity.json';
const PY = path.join(ROOT, 'scripts/needle-reader/rectify.py');
const PHOTO_PY = path.join(ROOT, 'scripts/needle-reader/reference_photo.py');
const WIDTH = 1280;
const HEIGHT = 720;
const FRAME_BYTES = WIDTH * HEIGHT * 4;
const PER_CLIP = 22;
const MIN_FRAMES = 200;
const EPSILON = 1e-4;
const ANGLE_EPSILON_DEG = 0.3;
const MODES = ['cartesian', 'polar'];

function memAvailableMb() {
  const text = readFileSync('/proc/meminfo', 'utf8');
  const match = text.match(/MemAvailable:\s+(\d+)\s+kB/);
  return match ? Number(match[1]) / 1024 : 0;
}

function angDiff(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function listClips() {
  const files = [];
  for (const kind of ['dry', 'used', 'real']) {
    const dir = path.join(TRAIN, kind);
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.mp4')) files.push(path.join(dir, name));
    }
  }
  return files.sort();
}

function videoMeta(file) {
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
  return { fps, duration, frames };
}

function sampleIndices(frameCount, count) {
  const lo = Math.min(frameCount - 1, Math.floor(frameCount * 0.04));
  const hi = Math.max(lo + 1, Math.ceil(frameCount * 0.96) - 1);
  const span = hi - lo + 1;
  const n = Math.min(count, span);
  const indices = [];
  for (let i = 0; i < n; i += 1) {
    indices.push(lo + Math.floor(((i + 0.5) * span) / n));
  }
  return [...new Set(indices)];
}

function decodeClip(file, indices) {
  const select = indices.map((index) => `eq(n\\,${index})`).join('+');
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-noautorotate',
    '-i', file,
    '-vf', `select='${select}',scale=${WIDTH}:${HEIGHT}:flags=bicubic`,
    '-fps_mode', 'vfr',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
  ], { maxBuffer: FRAME_BYTES * (indices.length + 2) });
  if (result.status !== 0) {
    throw new Error(`ffmpeg ${file}: ${(result.stderr || '').toString().slice(-400)}`);
  }
  const frames = [];
  for (let offset = 0; offset + FRAME_BYTES <= result.stdout.length; offset += FRAME_BYTES) {
    frames.push(result.stdout.subarray(offset, offset + FRAME_BYTES));
  }
  if (frames.length !== indices.length) {
    throw new Error(`ffmpeg ${file} produced ${frames.length} frames, wanted ${indices.length}`);
  }
  return frames;
}

function loadOpenCv() {
  const require = createRequire(new URL('../../package.json', import.meta.url));
  return require('@techstark/opencv-js');
}

function poseFor(image) {
  const found = discoverGaugeInFrame(image);
  if (found?.ok && found.radius > 8) {
    return { cx: found.cx, cy: found.cy, radius: found.radius, source: 'tracker' };
  }
  const blob = proposeGaugeCandidate(image);
  if (blob?.ok && blob.radius > 8) {
    return { cx: blob.cx, cy: blob.cy, radius: blob.radius, source: 'face-blob' };
  }
  return {
    cx: image.width / 2,
    cy: image.height / 2,
    radius: Math.min(image.width, image.height) * 0.22,
    source: 'frame-center',
  };
}

function startWorker() {
  const child = spawn('python3', [PY, '--worker'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (buf) => { stderr += buf.toString(); });
  let pending = '';
  const waiters = [];
  child.stdout.on('data', (buf) => {
    pending += buf.toString();
    let nl = pending.indexOf('\n');
    while (nl >= 0) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(line);
      nl = pending.indexOf('\n');
    }
  });
  child.on('exit', (code) => {
    const waiter = waiters.shift();
    if (waiter) waiter.reject(new Error(`rectify worker exited ${code}: ${stderr.slice(-500)}`));
  });
  return {
    child,
    request(job) {
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
        child.stdin.write(`${JSON.stringify(job)}\n`);
      });
    },
    close() {
      child.stdin.end();
    },
  };
}

function tensorDelta(jsTensor, pyBuffer) {
  const copy = new ArrayBuffer(pyBuffer.byteLength);
  Buffer.from(copy).set(pyBuffer);
  const py = new Float32Array(copy);
  if (py.length !== jsTensor.length) {
    throw new Error(`tensor length ${py.length} != ${jsTensor.length}`);
  }
  let max = 0;
  let sum = 0;
  for (let i = 0; i < py.length; i += 1) {
    const delta = Math.abs(py[i] - jsTensor[i]);
    if (delta > max) max = delta;
    sum += delta;
  }
  return { max, mean: sum / py.length };
}

function fitReport() {
  const raw = JSON.parse(readFileSync(LABELS, 'utf8'));
  const fit = fitAnchorsFromLabels(Object.values(raw.frames));
  const built = buildFlair58Profile(fit);
  const stored = parseGaugeProfile(JSON.parse(readFileSync(PROFILE_PATH, 'utf8')));
  const anchorDelta = Math.max(
    Math.abs(stored.scale.anchors[1].deg - built.scale.anchors[1].deg),
    Math.abs(stored.scale.anchors[2].deg - built.scale.anchors[2].deg),
    Math.abs(stored.rest.pinOffsetDeg - built.rest.pinOffsetDeg),
  );
  return { fit, stored, anchorDelta, profileMatchesFit: anchorDelta < 1e-6 };
}

function photoReport() {
  const result = spawnSync('python3', [PHOTO_PY, PHOTO], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`reference photo failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

async function parity(profile) {
  const mem = memAvailableMb();
  if (mem < 3072) throw new Error(`need >= 3 GB MemAvailable, have ${mem.toFixed(0)} MB`);
  let cv = loadOpenCv();
  if (typeof cv?.then === 'function') cv = await cv;
  if (!cv.Mat) await new Promise((resolve) => { cv.onRuntimeInitialized = resolve; });
  setOpenCvForTests(cv);

  const dir = mkdtempSync(path.join(tmpdir(), 'nr-phase1-'));
  const framePath = path.join(dir, 'frame.rgba');
  const outPath = path.join(dir, 'out.f32');
  const worker = startWorker();
  const spec = {
    size: profile.rectify.cartesian.size,
    dialRadiusPx: profile.rectify.cartesian.dialRadiusPx,
    radiusBins: profile.rectify.polar.radiusBins,
    angleBins: profile.rectify.polar.angleBins,
    outerRadiusPx: profile.rectify.polar.outerRadiusPx,
  };
  const summary = {
    frames: 0,
    poseSources: {},
    modes: {},
  };
  for (const mode of MODES) {
    summary.modes[mode] = { maxAbs: 0, meanAbsSum: 0, maxAngleDeg: 0, frames: 0 };
  }
  try {
    let index = 0;
    for (const file of listClips()) {
      const meta = videoMeta(file);
      const indices = sampleIndices(meta.frames, PER_CLIP);
      process.stderr.write(`decode ${path.basename(file)} ${indices.length} frames\n`);
      const frames = decodeClip(file, indices);
      for (let i = 0; i < frames.length; i += 1) {
        const rgba = frames[i];
        const image = {
          width: WIDTH,
          height: HEIGHT,
          data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength),
        };
        const located = poseFor(image);
        const pose = {
          cx: located.cx,
          cy: located.cy,
          radius: located.radius,
          rotationDeg: (index * 15) % 360,
        };
        summary.poseSources[located.source] = (summary.poseSources[located.source] || 0) + 1;
        writeFileSync(framePath, rgba);
        for (const mode of MODES) {
          const js = rectifyNeedle(image, pose, { mode, profile });
          const line = await worker.request({
            path: framePath,
            out: outPath,
            width: WIDTH,
            height: HEIGHT,
            mode,
            pose,
            spec: { ...spec, mode },
          });
          const py = JSON.parse(line);
          const delta = tensorDelta(js.tensor, readFileSync(outPath));
          const angleDelta = angDiff(measureTensorAngle(js.tensor, js.spec), py.angle);
          const bucket = summary.modes[mode];
          bucket.maxAbs = Math.max(bucket.maxAbs, delta.max);
          bucket.meanAbsSum += delta.mean;
          bucket.maxAngleDeg = Math.max(bucket.maxAngleDeg, angleDelta);
          bucket.frames += 1;
        }
        index += 1;
        if (index % 20 === 0) {
          process.stderr.write(`parity ${index} cartesian max ${summary.modes.cartesian.maxAbs.toExponential(2)} polar max ${summary.modes.polar.maxAbs.toExponential(2)}\n`);
        }
      }
    }
    summary.frames = index;
  } finally {
    worker.close();
    rmSync(dir, { recursive: true, force: true });
  }
  for (const mode of MODES) {
    const bucket = summary.modes[mode];
    bucket.meanAbs = bucket.frames ? bucket.meanAbsSum / bucket.frames : null;
    delete bucket.meanAbsSum;
    bucket.pass = bucket.frames >= MIN_FRAMES
      && bucket.maxAbs <= EPSILON
      && bucket.maxAngleDeg <= ANGLE_EPSILON_DEG;
  }
  summary.epsilon = EPSILON;
  summary.angleEpsilonDeg = ANGLE_EPSILON_DEG;
  summary.pass = summary.frames >= MIN_FRAMES && MODES.every((mode) => summary.modes[mode].pass);
  return summary;
}

function formatFit(fit) {
  const lines = [
    `anchors  0 bar = 0°,  5 bar = ${fit.anchor5Deg.toFixed(3)}°,  10 bar = ${fit.anchor10Deg.toFixed(3)}°`,
    `rest needle past 0 pin  ${fit.pinOffsetDeg.toFixed(3)}°   (n=${fit.n}, rest n=${fit.nRest})`,
    `pin→5 ${fit.pinToFiveDeg.toFixed(3)}°   pin→10 ${fit.pinToTenDeg.toFixed(3)}°`,
    `LOCO spread  pin ${fit.spread.pinOffsetDeg.spread.toFixed(3)}°   5 bar ${fit.spread.anchor5Deg.spread.toFixed(3)}°   10 bar ${fit.spread.anchor10Deg.spread.toFixed(3)}°`,
  ];
  return lines;
}

function formatPhoto(photo) {
  const m = photo.measured;
  const d = photo.deltaFromEyeDeg;
  return [
    `hub (${photo.hub.x}, ${photo.hub.y}) face r ${photo.faceRadiusPx} px`,
    `needle ${photo.needleDeg.toFixed(2)}°   pin ${photo.pinDeg.toFixed(2)}°`,
    `pin→5 ${m.pinToFiveDeg.toFixed(2)}°  (eye 82, Δ ${d.pinToFiveDeg})`,
    `pin→10 ${m.pinToTenDeg.toFixed(2)}°  (eye 170, Δ ${d.pinToTenDeg})`,
    `rest needle past pin ${m.restNeedleDeg.toFixed(2)}°  (eye 7, Δ ${d.restNeedleDeg})`,
    `coarse band  ${photo.withinCoarseBand ? 'PASS' : 'FAIL'}  tolerance ±${photo.coarseToleranceDeg.pinToFiveDeg}/±${photo.coarseToleranceDeg.pinToTenDeg}/±${photo.coarseToleranceDeg.restNeedleDeg}`,
  ];
}

function formatParity(summary) {
  const lines = [
    `frames ${summary.frames}   epsilon ${summary.epsilon}   angle ${summary.angleEpsilonDeg}°`,
    `poses ${Object.entries(summary.poseSources).map(([k, v]) => `${k}=${v}`).join(' ')}`,
  ];
  for (const mode of MODES) {
    const bucket = summary.modes[mode];
    lines.push(
      `${mode}  maxAbs ${bucket.maxAbs.toExponential(3)}  meanAbs ${bucket.meanAbs.toExponential(3)}  maxAngle ${bucket.maxAngleDeg.toFixed(4)}°  ${bucket.pass ? 'PASS' : 'FAIL'}`,
    );
  }
  return lines;
}

function gateTable({ fit, photo, summary, profileMatchesFit }) {
  const rows = [
    ['profile anchors fitted', profileMatchesFit ? 'PASS' : 'FAIL', `5° ${fit.anchor5Deg.toFixed(3)}  10° ${fit.anchor10Deg.toFixed(3)}  pin+ ${fit.pinOffsetDeg.toFixed(3)}`],
    ['LOCO spread reported', 'PASS', `pin ${fit.spread.pinOffsetDeg.spread.toFixed(3)}  5 ${fit.spread.anchor5Deg.spread.toFixed(3)}  10 ${fit.spread.anchor10Deg.spread.toFixed(3)}`],
    ['reference photo', photo.withinCoarseBand ? 'PASS' : 'FAIL', `5 ${photo.measured.pinToFiveDeg}  10 ${photo.measured.pinToTenDeg}  rest ${photo.measured.restNeedleDeg}`],
    ['parity frames', summary.frames >= MIN_FRAMES ? 'PASS' : 'FAIL', String(summary.frames)],
    ['cartesian tensors', summary.modes.cartesian.pass ? 'PASS' : 'FAIL', `maxAbs ${summary.modes.cartesian.maxAbs.toExponential(3)}  angle ${summary.modes.cartesian.maxAngleDeg.toFixed(4)}°`],
    ['polar tensors', summary.modes.polar.pass ? 'PASS' : 'FAIL', `maxAbs ${summary.modes.polar.maxAbs.toExponential(3)}  angle ${summary.modes.polar.maxAngleDeg.toFixed(4)}°`],
  ];
  const pass = rows.every((row) => row[1] === 'PASS');
  return { rows, pass };
}

async function main() {
  const mb = memAvailableMb();
  if (mb < 3072) throw new Error(`need >= 3 GB MemAvailable, have ${mb.toFixed(0)} MB`);
  process.stderr.write(`mem ${mb.toFixed(0)} MB\n`);
  const fitted = fitReport();
  process.stderr.write('anchors fitted\n');
  const photo = photoReport();
  process.stderr.write(`photo coarse ${photo.withinCoarseBand}\n`);
  const summary = await parity(fitted.stored);
  const gate = gateTable({ ...fitted, photo, summary });
  const text = [
    'Phase 1 gate — gauge profile, rectify, preprocessing parity',
    '',
    'Fit (labels, rest needle = 0 bar)',
    ...formatFit(fitted.fit).map((line) => `  ${line}`),
    `  stored profile matches fit  ${fitted.profileMatchesFit ? 'PASS' : 'FAIL'}`,
    '',
    'Reference photo  /workspace/flair-train/dry/20261015_225359.jpg',
    ...formatPhoto(photo).map((line) => `  ${line}`),
    '',
    'Parity (JS vs Python, real frames, both modes)',
    ...formatParity(summary).map((line) => `  ${line}`),
    '',
    'Gate',
    ...gate.rows.map((row) => `  ${row[1].padEnd(4)}  ${row[0].padEnd(28)}  ${row[2]}`),
    '',
    gate.pass ? 'PHASE 1 PASS' : 'PHASE 1 FAIL',
    '',
  ].join('\n');
  mkdirSync(path.dirname(OUT_TXT), { recursive: true });
  writeFileSync(OUT_TXT, text);
  writeFileSync(OUT_JSON, JSON.stringify({
    pass: gate.pass,
    epsilon: EPSILON,
    angleEpsilonDeg: ANGLE_EPSILON_DEG,
    fit: fitted.fit,
    profileMatchesFit: fitted.profileMatchesFit,
    photo,
    parity: summary,
    gate: gate.rows.map(([name, status, detail]) => ({ name, status, detail })),
  }, null, 2));
  process.stdout.write(text);
  if (!gate.pass) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
