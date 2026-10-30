/**
 * Score the live r7 shot reader against hand labels.
 *   node scripts/needle-reader/exam.mjs --live
 *
 * Clips: C:\Users\Isaac\dialin-exam-clips (override with DIALIN_EXAM_CLIPS).
 * Truth is the hand-label bar. Rest-phase frames are 0. The classical bar is
 * recorded as a stage and is not the answer.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { wrap360 } from '../../src/flairPressureLab/gaugeConfig.js';
import {
  calibrateFromTaps,
  createCalibratedTracker,
  mapStoredTapPoint,
  readCalibratedFrame,
} from '../../src/flairPressureLab/tapCalibrate.js';
import { rectifyGaugeFace } from '../../src/flairPressureLab/faceRectify.js';
import { setOpenCvForTests } from '../../src/flairPressureLab/opencvRuntime.js';
import {
  NEEDLE_INPUT_SIZE,
  NEEDLE_MODEL_INPUT,
  NEEDLE_MODEL_OUTPUT,
  configureNeedleRuntime,
  decodeNeedleOutput,
  prepareRegisteredFace,
} from '../../src/flairPressureLab/needleModel.js';
import { createShotLabR7Publisher } from '../../src/flairPressureLab/shotLabR7Live.js';
import { rollingDisplayBar } from '../../src/flairPressureLab/pressureDisplaySmoothing.js';
import {
  coveragePct,
  flipRatePct,
  jitterRms,
  labelErrorStats,
  quantile,
  restOffsetBar,
  round,
} from './metrics.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CLIPS_DIR = process.env.DIALIN_EXAM_CLIPS || 'C:\\Users\\Isaac\\dialin-exam-clips';
const LABELS_PATH = path.join(ROOT, 'scripts/pressure-label/fixtures/labels-2026-10-22.json');
const MANIFEST_PATH = path.join(ROOT, 'scripts/pressure-label/fixtures/manifest-2026-10-22.json');
const MODEL_PATH = path.join(ROOT, 'public/flair-pressure-lab/needle.onnx');
const OUT_DIR = path.join(ROOT, 'scripts/needle-reader/out');
const FFMPEG_BIN = process.env.FFMPEG
  || 'C:\\Users\\Isaac\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin\\ffmpeg.exe';
const FFPROBE_BIN = process.env.FFPROBE || path.join(path.dirname(FFMPEG_BIN), 'ffprobe.exe');
export const FRAME_S = 0.125;
export const EXAM_IDS = [
  '20261015_225219',
  '20261015_225307',
  '20261017_084814',
  '20261017_084919',
  '20261017_134943',
  '20261017_135116',
  '20261018_094055',
  '20261018_094151',
  '20261018_160844',
  '20261018_160931',
];
export const REST_PHASES = new Set(['rest', 'dry_1', 'used_1']);

export function imageAngle(from, to) {
  return wrap360((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
}

function clockwise(fromDeg, toDeg) {
  return wrap360(toDeg - fromDeg);
}

function medianOf(values) {
  const sorted = values.filter((value) => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Same bar map as scripts/pressure-label/eval-calibrated.mjs. */
export function truthBar(needleDeg, zeroDeg, tenDeg) {
  const span = clockwise(zeroDeg, tenDeg);
  if (!(span > 40) || span > 280) return null;
  let delta = clockwise(zeroDeg, needleDeg);
  if (delta > 300) delta -= 360;
  if (delta < -18 || delta > span + 18) return null;
  return Math.max(-0.6, Math.min(10.6, (delta / span) * 10));
}

export function restOffsetDeg(rows, holdClip) {
  const deltas = rows
    .filter((row) => row.clip !== holdClip && REST_PHASES.has(row.phase))
    .map((row) => clockwise(row.labelZero, row.labelNeedle));
  return medianOf(deltas) ?? 0;
}

/** Rest-phase frames are 0. Every other labelled frame uses labelBarFor. */
export function truthBarForLabel(row, offsetDeg) {
  if (REST_PHASES.has(row.phase)) return 0;
  const zero = wrap360(row.labelZero + offsetDeg);
  return truthBar(row.labelNeedle, zero, row.labelTen);
}

function normRot(rotation) {
  return ((Math.round(Number(rotation) || 0) % 360) + 360) % 360;
}

/**
 * Hand labels are stored-pixel coordinates. Dry clips were marked on 3840×2160
 * and the replay is the 1280×720 scale of that. The phone and the sidecar taps
 * use the autorotated picture.
 */
export function mapLabelPoint(point, storedW, storedH, rotation) {
  let mapped = { x: point.x, y: point.y };
  if (mapped.x > storedW || mapped.y > storedH) {
    mapped = {
      x: mapped.x * (storedW / 3840),
      y: mapped.y * (storedH / 2160),
    };
  }
  return mapStoredTapPoint(mapped, storedW, storedH, rotation) || mapped;
}

export function circDiff(a, b) {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const d = Math.abs(clockwise(b, a));
  return Math.min(d, 360 - d);
}

export function loadLabelRows() {
  const marks = JSON.parse(readFileSync(LABELS_PATH, 'utf8')).frames;
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const rows = [];
  for (const entry of manifest) {
    const mark = marks[entry.id];
    if (!mark || mark.unclear) continue;
    const hub = { x: mark.hub[0], y: mark.hub[1] };
    const tip = { x: mark.tip[0], y: mark.tip[1] };
    const zero = { x: mark.zero[0], y: mark.zero[1] };
    const ten = { x: mark.ten[0], y: mark.ten[1] };
    rows.push({
      id: entry.id,
      clip: entry.clip,
      t: entry.t,
      phase: entry.phase,
      hub,
      tip,
      zero,
      ten,
      labelNeedle: imageAngle(hub, tip),
      labelZero: imageAngle(hub, zero),
      labelTen: imageAngle(hub, ten),
    });
  }
  return rows;
}

function tool(bin, fallback) {
  if (existsSync(bin)) return bin;
  return fallback;
}

export function probe(file) {
  const ffprobe = tool(FFPROBE_BIN, 'ffprobe');
  const result = spawnSync(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:stream_side_data=rotation',
    '-of', 'json', file,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffprobe ${file}: ${result.stderr}`);
  const stream = JSON.parse(result.stdout).streams?.[0];
  const storedW = Number(stream?.width);
  const storedH = Number(stream?.height);
  const rotation = normRot(stream?.side_data_list?.[0]?.rotation || 0);
  if (!(storedW > 0) || !(storedH > 0)) throw new Error(`bad probe ${file}`);
  const swapped = rotation === 90 || rotation === 270;
  return {
    storedW,
    storedH,
    rotation,
    width: swapped ? storedH : storedW,
    height: swapped ? storedW : storedH,
  };
}

function rgbaImage(buffer, width, height) {
  const expect = width * height * 4;
  if (buffer.length !== expect) throw new Error(`frame bytes ${buffer.length} != ${expect}`);
  const data = new Uint8ClampedArray(expect);
  data.set(buffer);
  return { width, height, data };
}

export function decodeStill(file, atSec, width, height) {
  const ffmpeg = tool(FFMPEG_BIN, 'ffmpeg');
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-i', file,
    '-ss', String(atSec),
    '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
  ], { maxBuffer: width * height * 4 + 1024 });
  if (result.status !== 0) throw new Error(`still ${file} @ ${atSec}: ${result.stderr}`);
  return rgbaImage(result.stdout, width, height);
}

export async function* streamFrames(file, width, height) {
  const ffmpeg = tool(FFMPEG_BIN, 'ffmpeg');
  const child = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-i', file,
    '-vf', 'fps=8',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const errors = [];
  child.stderr.on('data', (chunk) => errors.push(chunk));
  const bytes = width * height * 4;
  let pending = Buffer.alloc(0);
  let index = 0;
  try {
    for await (const chunk of child.stdout) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= bytes) {
        const frame = pending.subarray(0, bytes);
        pending = pending.subarray(bytes);
        yield { timeS: index * FRAME_S, image: rgbaImage(frame, width, height) };
        index += 1;
      }
    }
  } finally {
    if (child.exitCode == null) child.kill();
  }
  const code = await new Promise((resolve) => {
    if (child.exitCode != null) resolve(child.exitCode);
    else child.on('close', resolve);
  });
  if (code !== 0) throw new Error(`ffmpeg ${file} (${code}): ${Buffer.concat(errors).toString().slice(-500)}`);
}

async function loadModel() {
  const ort = await import('onnxruntime-web/wasm');
  const wasmDir = path.dirname(require.resolve('onnxruntime-web'));
  configureNeedleRuntime(ort, `${pathToFileURL(wasmDir).href}/`);
  const bytes = new Uint8Array(readFileSync(MODEL_PATH));
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return { ort, session };
}

/** Same crop and decode as r5SampleFromTapFrame, with a session already loaded. */
async function r5Sample(ort, session, cv, image, read) {
  if (!image || !read?.hub || read.lost) return { r5Bar: null, r5Conf: null, r5Angle: null };
  const candidate = {
    cx: read.hub.x,
    cy: read.hub.y,
    radius: read.radius ?? 60,
    rotationDeg: read.shiftDeg ?? 0,
  };
  let face = null;
  try {
    face = rectifyGaugeFace(cv, image, candidate, { track: false });
  } catch {
    face = null;
  }
  if (!face?.ok) return { r5Bar: null, r5Conf: null, r5Angle: null };
  const data = prepareRegisteredFace(
    face.image,
    face.cx,
    face.cy,
    face.radius,
    candidate.rotationDeg,
  );
  const tensor = new ort.Tensor('float32', data, [1, 3, NEEDLE_INPUT_SIZE, NEEDLE_INPUT_SIZE]);
  const output = await session.run({ [NEEDLE_MODEL_INPUT]: tensor });
  const decoded = decodeNeedleOutput(output[NEEDLE_MODEL_OUTPUT]?.data);
  if (!decoded?.ok || decoded.bar == null) {
    return { r5Bar: null, r5Conf: decoded?.confidence ?? null, r5Angle: decoded?.angleDeg ?? null };
  }
  return {
    r5Bar: decoded.bar,
    r5Conf: decoded.confidence ?? null,
    r5Angle: decoded.angleDeg ?? null,
  };
}

function nearestSnap(snaps, timeS) {
  let best = null;
  let bestDt = 0.08;
  for (const snap of snaps) {
    const dt = Math.abs(snap.timeS - timeS);
    if (dt < bestDt) {
      best = snap;
      bestDt = dt;
    }
  }
  return best;
}

async function scoreClip(clipId, labels, cv, ort, session) {
  const file = path.join(CLIPS_DIR, `${clipId}.mp4`);
  const side = path.join(CLIPS_DIR, `${clipId}.json`);
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  const { width, height, storedW, storedH, rotation } = probe(file);
  const doc = JSON.parse(readFileSync(side, 'utf8'));
  const anchors = doc.tapCalibration?.anchors;
  if (!anchors?.centre || !anchors.five || !anchors.ten) {
    throw new Error(`${clipId} sidecar has no tap anchors`);
  }
  const atSec = doc.tapCalibration.atSec ?? 0;
  const still = decodeStill(file, atSec, width, height);
  const calibrated = calibrateFromTaps(still, {
    centre: anchors.centre,
    five: anchors.five,
    ten: anchors.ten,
  });
  const offsetDeg = restOffsetDeg(labels, clipId);
  const clipLabels = labels.filter((row) => row.clip === clipId);
  if (!calibrated.ok) {
    return {
      id: clipId,
      calOk: false,
      calReason: calibrated.reason || calibrated.redo || 'no-calibration',
      frames: [],
      labelHits: clipLabels.map((row) => ({
        id: row.id,
        phase: row.phase,
        truth: truthBarForLabel(row, offsetDeg),
        published: null,
      })),
      ms: [],
    };
  }
  const tracker = createCalibratedTracker(calibrated.calibration);
  const publisher = createShotLabR7Publisher(calibrated.calibration);
  publisher.beginShot(0);
  const frames = [];
  const snaps = [];
  const ms = [];
  const displaySamples = [];
  let lastR5 = { r5Bar: null, r5Conf: null, r5Angle: null };
  let frameCount = 0;
  for await (const { timeS, image } of streamFrames(file, width, height)) {
    const t0 = performance.now();
    const read = readCalibratedFrame(image, tracker);
    const r5ForGate = lastR5;
    lastR5 = await r5Sample(ort, session, cv, image, read);
    const gated = publisher.stepFrame({
      nowMs: timeS * 1000,
      read,
      r5Bar: r5ForGate.r5Bar,
      r5Conf: r5ForGate.r5Conf,
      r5Angle: r5ForGate.r5Angle,
    });
    const published = gated.bar;
    if (published != null) displaySamples.push({ tS: timeS, bar: published, confident: true });
    const display = published == null ? null : rollingDisplayBar(displaySamples, timeS);
    ms.push(performance.now() - t0);
    frames.push({
      timeS,
      bar: published,
      tracking: published == null ? 'LOST' : 'TRACKING',
      reason: gated.reason,
    });
    snaps.push({
      timeS,
      published,
      display,
      reason: gated.reason,
      hub: read?.hub ? { x: read.hub.x, y: read.hub.y } : null,
      r5Bar: r5ForGate.r5Bar,
      r5Angle: r5ForGate.r5Angle,
      classicalBar: read?.bar ?? null,
      classicalAngle: gated.classicalStep?.needleDeg ?? read?.needleDeg ?? null,
      r6Bar: gated.classicalStep?.published ? gated.classicalStep.bar : null,
    });
    frameCount += 1;
    if (frameCount % 80 === 0) process.stderr.write(`  ${clipId} ${timeS.toFixed(1)}s\n`);
  }
  const labelHits = clipLabels.map((label) => {
    const snap = nearestSnap(snaps, label.t);
    const hub = mapLabelPoint(label.hub, storedW, storedH, rotation);
    const tip = mapLabelPoint(label.tip, storedW, storedH, rotation);
    const zero = mapLabelPoint(label.zero, storedW, storedH, rotation);
    const ten = mapLabelPoint(label.ten, storedW, storedH, rotation);
    const mapped = {
      ...label,
      hub,
      labelNeedle: imageAngle(hub, tip),
      labelZero: imageAngle(hub, zero),
      labelTen: imageAngle(hub, ten),
    };
    const truth = truthBarForLabel(mapped, offsetDeg);
    if (!snap) {
      return {
        id: label.id,
        phase: label.phase,
        t: label.t,
        truth,
        published: null,
        display: null,
        reason: 'no-frame',
        hubPx: null,
        r5Bar: null,
        classicalBar: null,
        r6Bar: null,
        needleErr: null,
      };
    }
    const publishedAngle = snap.reason === 'classical-direct' ? snap.classicalAngle : snap.r5Angle;
    return {
      id: label.id,
      phase: label.phase,
      t: label.t,
      truth,
      published: snap.published,
      display: snap.display,
      reason: snap.reason,
      hubPx: snap.hub ? Math.hypot(snap.hub.x - hub.x, snap.hub.y - hub.y) : null,
      r5Bar: snap.r5Bar,
      classicalBar: snap.classicalBar,
      r6Bar: snap.r6Bar,
      needleErr: circDiff(publishedAngle, mapped.labelNeedle),
    };
  });
  return { id: clipId, calOk: true, calReason: null, frames, labelHits, ms };
}

function fmt(value, width, digits = 2) {
  if (value == null || Number.isNaN(value)) return 'N/A'.padStart(width);
  return Number(value).toFixed(digits).padStart(width);
}

function absErrs(hits, key) {
  const errs = [];
  for (const hit of hits) {
    if (hit[key] == null || hit.truth == null || !Number.isFinite(hit[key]) || !Number.isFinite(hit.truth)) continue;
    errs.push(Math.abs(hit[key] - hit.truth));
  }
  return errs;
}

function errStats(errs) {
  if (!errs.length) return { n: 0, median: null, p90: null, wildPct: null };
  const wild = errs.filter((err) => err > 1).length;
  return {
    n: errs.length,
    median: quantile(errs, 0.5),
    p90: quantile(errs, 0.9),
    wildPct: (100 * wild) / errs.length,
  };
}

function reasonCounts(hits) {
  const counts = {};
  for (const hit of hits) {
    const key = hit.published == null ? (hit.reason || 'withheld') : (hit.reason || 'ok');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function clipSummary(result) {
  const hits = result.labelHits || [];
  const shown = hits.filter((hit) => hit.published != null && hit.truth != null);
  const label = labelErrorStats(shown.map((hit) => ({
    barErr: hit.truth == null ? null : hit.published - hit.truth,
  })));
  const restHits = hits.filter((hit) => REST_PHASES.has(hit.phase) && hit.published != null);
  const restLabel = restHits.length
    ? Math.max(...restHits.map((hit) => Math.abs(hit.published)))
    : null;
  const hiddenGood = hits.filter((hit) => (
    hit.published == null
    && hit.r5Bar != null
    && hit.truth != null
    && Math.abs(hit.r5Bar - hit.truth) <= 0.3
  )).length;
  return {
    id: result.id,
    calOk: result.calOk,
    calReason: result.calReason,
    frames: result.frames.length,
    coveragePct: round(coveragePct(result.frames), 2),
    medianAbsBar: round(label.median, 3),
    p90AbsBar: round(label.p90, 3),
    wildPct: round(label.wildPct, 2),
    labelN: label.n,
    flipPct: round(flipRatePct(shown.map((hit) => hit.needleErr)), 2),
    restOffsetBar: round(restOffsetBar(result.frames), 3),
    restLabelAbs: round(restLabel, 3),
    jitterRms: round(jitterRms(result.frames), 4),
    msFrame: round(medianOf(result.ms), 1),
    hubPx: round(medianOf(hits.map((hit) => hit.hubPx)), 1),
    r5Median: round(errStats(absErrs(hits, 'r5Bar')).median, 3),
    classicalMedian: round(errStats(absErrs(hits, 'classicalBar')).median, 3),
    r6Median: round(errStats(absErrs(hits, 'r6Bar')).median, 3),
    displayMedian: round(errStats(absErrs(hits, 'display')).median, 3),
    hiddenGood,
    reasons: reasonCounts(hits),
    streamReasons: reasonCounts(result.frames.map((frame) => ({
      published: frame.bar,
      reason: frame.reason,
    }))),
    hits,
  };
}

function render(rows) {
  const lines = [
    'Live r7 exam. Hand labels and rest = 0. Classical bar is not the answer.',
    'command: node scripts/needle-reader/exam.mjs --live',
    `clips: ${CLIPS_DIR}`,
    'The model sample is applied one frame later, matching the live hook.',
    'median/p90/wild/flip are labelled frames only. Coverage, rest, jitter, and ms/frame are the 125 ms stream.',
    '',
    ['clip'.padEnd(16), 'cov%'.padStart(7), 'med'.padStart(7), 'p90'.padStart(7), 'wild%'.padStart(7), 'flip%'.padStart(7), 'rest'.padStart(7), 'ms'.padStart(7), 'n'.padStart(4)].join(' '),
  ];
  for (const row of rows) {
    lines.push([
      row.id.padEnd(16),
      fmt(row.coveragePct, 7, 1),
      fmt(row.medianAbsBar, 7, 3),
      fmt(row.p90AbsBar, 7, 3),
      fmt(row.wildPct, 7, 1),
      fmt(row.flipPct, 7, 1),
      fmt(row.restOffsetBar, 7, 3),
      fmt(row.msFrame, 7, 1),
      fmt(row.labelN, 4, 0),
    ].join(' '));
  }
  lines.push('');
  lines.push('Stage split on labelled frames (median abs bar, except hub in px). hidden = model within 0.3 bar and gate withheld.');
  lines.push(['clip'.padEnd(16), 'hub'.padStart(7), 'r5'.padStart(7), 'class'.padStart(7), 'r6'.padStart(7), 'gate'.padStart(7), 'disp'.padStart(7), 'hide'.padStart(5)].join(' '));
  for (const row of rows) {
    lines.push([
      row.id.padEnd(16),
      fmt(row.hubPx, 7, 1),
      fmt(row.r5Median, 7, 3),
      fmt(row.classicalMedian, 7, 3),
      fmt(row.r6Median, 7, 3),
      fmt(row.medianAbsBar, 7, 3),
      fmt(row.displayMedian, 7, 3),
      fmt(row.hiddenGood, 5, 0),
    ].join(' '));
    const parts = Object.entries(row.reasons);
    const stream = Object.entries(row.streamReasons || {});
    lines.push(`  ${row.calOk ? 'calibrated' : `calibration failed (${row.calReason})`}; label reasons ${parts.length ? parts.map(([key, value]) => `${key}=${value}`).join(' ') : 'none'}`);
    lines.push(`  stream reasons ${stream.length ? stream.map(([key, value]) => `${key}=${value}`).join(' ') : 'none'}`);
  }
  return lines;
}

export async function runLiveExam() {
  for (const id of EXAM_IDS) {
    if (!existsSync(path.join(CLIPS_DIR, `${id}.mp4`))) {
      throw new Error(`missing exam clip ${id} in ${CLIPS_DIR}`);
    }
  }
  if (!existsSync(tool(FFMPEG_BIN, 'ffmpeg')) && tool(FFMPEG_BIN, 'ffmpeg') === FFMPEG_BIN) {
    throw new Error(`ffmpeg not found at ${FFMPEG_BIN}`);
  }
  const labels = loadLabelRows();
  const requireCv = createRequire(import.meta.url);
  let cv = requireCv('@techstark/opencv-js');
  if (typeof cv.then === 'function') cv = await cv;
  if (!cv.Mat && cv.onRuntimeInitialized) {
    await new Promise((resolve) => {
      cv.onRuntimeInitialized = resolve;
    });
  }
  setOpenCvForTests(cv);
  const { ort, session } = await loadModel();
  const only = process.env.EXAM_CLIP || '';
  const ids = only ? EXAM_IDS.filter((id) => id === only) : EXAM_IDS;
  if (only && !ids.length) throw new Error(`EXAM_CLIP ${only} is not one of the 10 exam clips`);
  const rows = [];
  for (const id of ids) {
    process.stderr.write(`clip ${id}\n`);
    const result = await scoreClip(id, labels, cv, ort, session);
    rows.push(clipSummary(result));
    process.stderr.write(`done ${id} cov=${rows.at(-1).coveragePct} med=${rows.at(-1).medianAbsBar}\n`);
  }
  const allHits = rows.flatMap((row) => row.hits);
  const shown = allHits.filter((hit) => hit.published != null && hit.truth != null);
  const overallLabel = labelErrorStats(shown.map((hit) => ({
    barErr: hit.published - hit.truth,
  })));
  const frameTotal = rows.reduce((sum, row) => sum + row.frames, 0);
  const shownFrames = rows.reduce((sum, row) => sum + ((row.coveragePct ?? 0) / 100) * row.frames, 0);
  const lines = render(rows);
  const overall = {
    coveragePct: round(medianOf(rows.map((row) => row.coveragePct)), 2),
    streamCoveragePct: frameTotal ? round((100 * shownFrames) / frameTotal, 2) : null,
    medianAbsBar: round(overallLabel.median, 3),
    p90AbsBar: round(overallLabel.p90, 3),
    wildPct: round(overallLabel.wildPct, 2),
    labelN: overallLabel.n,
    flipPct: round(flipRatePct(shown.map((hit) => hit.needleErr)), 2),
    restAbsMax: round(Math.max(...rows.map((row) => Math.abs(row.restOffsetBar ?? 0))), 3),
    msFrame: round(medianOf(rows.map((row) => row.msFrame)), 1),
  };
  lines.push('');
  lines.push(`overall stream coverage=${fmt(overall.streamCoveragePct, 0, 1)}%  labelled n=${overall.labelN} median=${fmt(overall.medianAbsBar, 0, 3)} p90=${fmt(overall.p90AbsBar, 0, 3)} wild=${fmt(overall.wildPct, 0, 1)}% flip=${fmt(overall.flipPct, 0, 1)}%`);
  lines.push(`overall rest max|.|=${fmt(overall.restAbsMax, 0, 3)}  ms/frame median-of-clips=${fmt(overall.msFrame, 0, 1)}`);
  const byPhase = {};
  for (const hit of shown) {
    const bucket = byPhase[hit.phase] || [];
    bucket.push(Math.abs(hit.published - hit.truth));
    byPhase[hit.phase] = bucket;
  }
  lines.push('');
  lines.push('Published error by phase');
  for (const [phase, errs] of Object.entries(byPhase)) {
    const stats = errStats(errs);
    lines.push(`${phase}: n=${stats.n} median=${fmt(stats.median, 0, 3)} p90=${fmt(stats.p90, 0, 3)} wild=${fmt(stats.wildPct, 0, 1)}%`);
  }
  const text = `${lines.join('\n')}\n`;
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'exam-live.txt'), text);
  writeFileSync(path.join(OUT_DIR, 'exam-live.json'), `${JSON.stringify({ overall, clips: rows.map(({ hits, ...row }) => row) }, null, 2)}\n`);
  process.stdout.write(text);
}
