/**
 * Score the shipped 64×64 needle.onnx and the four unused 96×96 exports
 * on the hand-labelled frames. Does not change the app.
 *
 *   node scripts/needle-reader/exam.mjs --models
 *
 * New models: 4-channel rectify (RGB plus a copy of red), 360-bin
 * soft-argmax, confidence = softmax mass within ±5° (aux check included).
 * A frame counts only when that confidence is at least 0.22, the tau in
 * scripts/needle-reader/train_r2.py. That tau is not refit on these clips.
 * The shipped model keeps its own 0.6 gate. Bar uses the tap span on that
 * frame. Truth is the hand-label bar. Rest phases are 0.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { wrap360 } from '../../src/flairPressureLab/gaugeConfig.js';
import {
  barFromRestSpan,
  calibrateFromTaps,
  createCalibratedTracker,
  readCalibratedFrame,
} from '../../src/flairPressureLab/tapCalibrate.js';
import { rectifyNeedle } from '../../src/flairPressureLab/needleRectify.js';
import { setOpenCvForTests } from '../../src/flairPressureLab/opencvRuntime.js';
import {
  NEEDLE_INPUT_SIZE,
  NEEDLE_MODEL_INPUT,
  NEEDLE_MODEL_OUTPUT,
  configureNeedleRuntime,
  decodeNeedleOutput,
  prepareRegisteredFace,
} from '../../src/flairPressureLab/needleModel.js';
import { rectifyGaugeFace } from '../../src/flairPressureLab/faceRectify.js';
import { labelErrorStats, flipRatePct, quantile, round } from './metrics.mjs';
import {
  CLIPS_DIR,
  EXAM_IDS,
  circDiff,
  decodeStill,
  imageAngle,
  loadLabelRows,
  mapLabelPoint,
  probe,
  restOffsetDeg,
  streamFrames,
  truthBarForLabel,
} from './examLive.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'scripts/needle-reader/out');
const CONF_MIN = 0.22;
const SOFT_RADIUS = 3;
const CONF_RADIUS = 5;

const MODEL_SPECS = [
  { id: 'shipped', kind: 'shipped', file: 'public/flair-pressure-lab/needle.onnx' },
  { id: 'cartesian', kind: 'cartesian', file: 'scripts/needle-reader/export/needle-cartesian.onnx' },
  { id: 'cartesian-int8', kind: 'cartesian', file: 'scripts/needle-reader/export/needle-cartesian.int8.onnx' },
  { id: 'polar', kind: 'polar', file: 'scripts/needle-reader/export/needle-polar.onnx' },
  { id: 'polar-int8', kind: 'polar', file: 'scripts/needle-reader/export/needle-polar.int8.onnx' },
];

function softmax(values) {
  let max = -Infinity;
  for (let i = 0; i < values.length; i += 1) if (values[i] > max) max = values[i];
  const out = new Float64Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    out[i] = Math.exp(values[i] - max);
    sum += out[i];
  }
  for (let i = 0; i < out.length; i += 1) out[i] /= sum || 1;
  return out;
}

/** Soft-argmax ±3 bins. Confidence is the ±5° probability mass, cut when aux disagrees by more than 25°. */
export function decodeTipLogits(logits, aux = null) {
  const n = logits.length;
  let peak = 0;
  for (let i = 1; i < n; i += 1) if (logits[i] > logits[peak]) peak = i;
  const local = new Float64Array(SOFT_RADIUS * 2 + 1);
  for (let o = -SOFT_RADIUS; o <= SOFT_RADIUS; o += 1) local[o + SOFT_RADIUS] = logits[(peak + o + n) % n];
  const weight = softmax(local);
  let delta = 0;
  for (let i = 0; i < local.length; i += 1) delta += weight[i] * (i - SOFT_RADIUS);
  const angle = ((peak + delta) % n + n) % n;
  const prob = softmax(logits);
  let conf = 0;
  for (let o = -CONF_RADIUS; o <= CONF_RADIUS; o += 1) conf += prob[(peak + o + n) % n];
  if (aux && aux.length >= 2) {
    const auxDeg = ((Math.atan2(aux[1], aux[0]) * 180) / Math.PI) * 0.5;
    const auxMod = ((auxDeg % 180) + 180) % 180;
    const tip = angle % 180;
    const diff = Math.min(Math.abs(auxMod - tip), 180 - Math.abs(auxMod - tip));
    if (diff > 25) conf *= 0.25;
  }
  return { angle, conf };
}

function withRed(chw) {
  const plane = chw.length / 3;
  const out = new Float32Array(4 * plane);
  out.set(chw);
  out.set(chw.subarray(0, plane), 3 * plane);
  return out;
}

function mappedLabel(label, storedW, storedH, rotation) {
  const hub = mapLabelPoint(label.hub, storedW, storedH, rotation);
  const tip = mapLabelPoint(label.tip, storedW, storedH, rotation);
  const zero = mapLabelPoint(label.zero, storedW, storedH, rotation);
  const ten = mapLabelPoint(label.ten, storedW, storedH, rotation);
  return {
    ...label,
    hub,
    labelNeedle: imageAngle(hub, tip),
    labelZero: imageAngle(hub, zero),
    labelTen: imageAngle(hub, ten),
  };
}

async function openSessions() {
  const ort = await import('onnxruntime-web/wasm');
  const wasmDir = path.dirname(require.resolve('onnxruntime-web'));
  configureNeedleRuntime(ort, `${pathToFileURL(wasmDir).href}/`);
  const sessions = [];
  for (const spec of MODEL_SPECS) {
    const bytes = new Uint8Array(readFileSync(path.join(ROOT, spec.file)));
    const session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    sessions.push({ ...spec, session });
    process.stderr.write(`${spec.id} in=${session.inputNames.join(',')} out=${session.outputNames.join(',')}\n`);
  }
  return { ort, sessions };
}

async function runShipped(ort, session, cv, image, read) {
  if (!image || !read?.hub || read.lost) return { bar: null, conf: null, imageAngle: null };
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
  if (!face?.ok) return { bar: null, conf: null, imageAngle: null };
  const data = prepareRegisteredFace(face.image, face.cx, face.cy, face.radius, candidate.rotationDeg);
  const tensor = new ort.Tensor('float32', data, [1, 3, NEEDLE_INPUT_SIZE, NEEDLE_INPUT_SIZE]);
  const output = await session.run({ [NEEDLE_MODEL_INPUT]: tensor });
  const decoded = decodeNeedleOutput(output[NEEDLE_MODEL_OUTPUT]?.data);
  const crop = decoded?.angleDeg;
  const imageNeedle = crop == null ? null : wrap360(crop + (read.shiftDeg ?? 0));
  return {
    bar: decoded?.ok ? decoded.bar : null,
    rawBar: decoded?.bar ?? null,
    conf: decoded?.confidence ?? null,
    imageAngle: imageNeedle,
  };
}

async function runRectified(ort, session, image, read, kind) {
  if (!image || !read?.hub || read.lost || read.zeroDeg == null) {
    return { bar: null, conf: null, imageAngle: null };
  }
  const pose = {
    cx: read.hub.x,
    cy: read.hub.y,
    radius: read.radius,
    rotationDeg: read.zeroDeg,
  };
  const crop = rectifyNeedle(image, pose, { mode: kind });
  const data = withRed(crop.tensor);
  const dims = kind === 'polar' ? [1, 4, crop.height, crop.width] : [1, 4, crop.height, crop.width];
  const inputName = session.inputNames[0];
  const tensor = new ort.Tensor('float32', data, dims);
  const output = await session.run({ [inputName]: tensor });
  const names = session.outputNames;
  const logits = output[names[0]]?.data;
  const aux = names[1] ? output[names[1]]?.data : null;
  const decoded = decodeTipLogits(logits, aux);
  const imageNeedle = wrap360(decoded.angle + read.zeroDeg);
  const rawBar = barFromRestSpan(imageNeedle, read.zeroDeg, read.tenDeg);
  const bar = decoded.conf >= CONF_MIN ? rawBar : null;
  return { bar, rawBar, conf: decoded.conf, imageAngle: imageNeedle };
}

function emptyHit(label, truth) {
  return {
    id: label.id,
    phase: label.phase,
    t: label.t,
    truth,
    bar: null,
    rawBar: null,
    conf: null,
    needleErr: null,
    angleErr: null,
  };
}

async function scoreClip(clipId, labels, cv, ort, sessions) {
  const file = path.join(CLIPS_DIR, `${clipId}.mp4`);
  const side = JSON.parse(readFileSync(path.join(CLIPS_DIR, `${clipId}.json`), 'utf8'));
  const anchors = side.tapCalibration?.anchors;
  if (!anchors?.centre || !anchors.five || !anchors.ten) throw new Error(`${clipId} sidecar has no tap anchors`);
  const { width, height, storedW, storedH, rotation } = probe(file);
  const still = decodeStill(file, side.tapCalibration.atSec ?? 0, width, height);
  const calibrated = calibrateFromTaps(still, {
    centre: anchors.centre,
    five: anchors.five,
    ten: anchors.ten,
  });
  const offsetDeg = restOffsetDeg(labels, clipId);
  const clipLabels = labels
    .filter((row) => row.clip === clipId)
    .map((row) => mappedLabel(row, storedW, storedH, rotation));
  const hits = Object.fromEntries(sessions.map((spec) => [spec.id, []]));
  const ms = Object.fromEntries(sessions.map((spec) => [spec.id, []]));
  if (!calibrated.ok) {
    for (const label of clipLabels) {
      const truth = truthBarForLabel(label, offsetDeg);
      for (const spec of sessions) hits[spec.id].push(emptyHit(label, truth));
    }
    return { id: clipId, calOk: false, hits, ms };
  }
  const tracker = createCalibratedTracker(calibrated.calibration);
  const pending = new Map(clipLabels.map((label) => [label.id, label]));
  for await (const { timeS, image } of streamFrames(file, width, height)) {
    const read = readCalibratedFrame(image, tracker);
    const due = [];
    for (const label of pending.values()) {
      if (Math.abs(label.t - timeS) <= 0.08) due.push(label);
    }
    if (!due.length) continue;
    for (const label of due) pending.delete(label.id);
    for (const spec of sessions) {
      const t0 = performance.now();
      const pred = spec.kind === 'shipped'
        ? await runShipped(ort, spec.session, cv, image, read)
        : await runRectified(ort, spec.session, image, read, spec.kind);
      ms[spec.id].push(performance.now() - t0);
      for (const label of due) {
        const labelTruth = truthBarForLabel(label, offsetDeg);
        hits[spec.id].push({
          id: label.id,
          phase: label.phase,
          t: label.t,
          truth: labelTruth,
          bar: pred.bar,
          rawBar: pred.rawBar,
          conf: pred.conf,
          angleErr: circDiff(pred.imageAngle, label.labelNeedle),
          needleErr: pred.bar == null ? null : circDiff(pred.imageAngle, label.labelNeedle),
        });
      }
    }
    if (pending.size === 0) break;
  }
  for (const label of pending.values()) {
    const truth = truthBarForLabel(label, offsetDeg);
    for (const spec of sessions) hits[spec.id].push(emptyHit(label, truth));
  }
  return { id: clipId, calOk: true, hits, ms };
}

function fmt(value, width, digits = 2) {
  if (value == null || Number.isNaN(value)) return 'N/A'.padStart(width);
  return Number(value).toFixed(digits).padStart(width);
}

function summarize(id, hits, times) {
  const shown = hits.filter((hit) => hit.bar != null && hit.truth != null);
  const stats = labelErrorStats(shown.map((hit) => ({ barErr: hit.bar - hit.truth })));
  const ungatedHits = hits.filter((hit) => hit.rawBar != null && hit.truth != null);
  const ungated = labelErrorStats(ungatedHits.map((hit) => ({ barErr: hit.rawBar - hit.truth })));
  const angles = hits.map((hit) => hit.angleErr).filter((value) => value != null && Number.isFinite(value));
  const rest = hits.find((hit) => hit.phase === 'rest' || hit.phase === 'dry_1' || hit.phase === 'used_1');
  return {
    id,
    n: hits.length,
    shown: stats.n,
    coveragePct: hits.length ? (100 * stats.n) / hits.length : null,
    median: stats.median,
    p90: stats.p90,
    wildPct: stats.wildPct,
    flipPct: flipRatePct(shown.map((hit) => hit.needleErr)),
    rest: rest?.bar ?? null,
    ungatedN: ungated.n,
    ungatedMedian: ungated.median,
    ungatedWildPct: ungated.wildPct,
    angleMedian: angles.length ? quantile(angles, 0.5) : null,
    ms: times.length ? quantile(times, 0.5) : null,
  };
}

export async function runModelExam() {
  const only = process.env.EXAM_CLIP || '';
  const ids = only ? EXAM_IDS.filter((id) => id === only) : EXAM_IDS;
  if (only && !ids.length) throw new Error(`EXAM_CLIP ${only} is not one of the 10 exam clips`);
  for (const id of ids) {
    const file = path.join(CLIPS_DIR, `${id}.mp4`);
    if (!existsSync(file)) throw new Error(`missing exam clip ${id} in ${CLIPS_DIR}`);
  }
  const labels = loadLabelRows();
  let cv = require('@techstark/opencv-js');
  if (typeof cv.then === 'function') cv = await cv;
  if (!cv.Mat && cv.onRuntimeInitialized) {
    await new Promise((resolve) => {
      cv.onRuntimeInitialized = resolve;
    });
  }
  setOpenCvForTests(cv);
  const { ort, sessions } = await openSessions();
  const byModel = Object.fromEntries(sessions.map((spec) => [spec.id, { hits: [], ms: [] }]));
  const perClip = [];
  for (const id of ids) {
    process.stderr.write(`clip ${id}\n`);
    const result = await scoreClip(id, labels, cv, ort, sessions);
    perClip.push(result);
    for (const spec of sessions) {
      byModel[spec.id].hits.push(...result.hits[spec.id]);
      byModel[spec.id].ms.push(...result.ms[spec.id]);
    }
  }
  const lines = [
    'Model exam on hand-labelled frames, before the gate. Rest = 0. Classical bar is not the answer.',
    `command: node scripts/needle-reader/exam.mjs --models`,
    `clips: ${CLIPS_DIR}`,
    `New-model confidence gate is ${CONF_MIN} (±5° mass). Shipped gate is 0.6. Neither was fit on these clips.`,
    'coverage is labelled frames with a bar. median/p90/wild/flip use those frames. ms is this PC.',
    '',
  ];
  const summaries = [];
  for (const spec of sessions) {
    const summary = summarize(spec.id, byModel[spec.id].hits, byModel[spec.id].ms);
    summaries.push(summary);
    lines.push(spec.id);
    lines.push('clip                cov%     med     p90   wild%   flip%    rest      ms    n');
    for (const clip of perClip) {
      const row = summarize(clip.id, clip.hits[spec.id], clip.ms[spec.id]);
      lines.push([
        row.id.padEnd(16),
        fmt(row.coveragePct, 7, 1),
        fmt(row.median, 7, 3),
        fmt(row.p90, 7, 3),
        fmt(row.wildPct, 7, 1),
        fmt(row.flipPct, 7, 1),
        fmt(row.rest, 7, 3),
        fmt(row.ms, 7, 1),
        String(row.shown).padStart(4),
      ].join(' '));
    }
    lines.push([
      'overall'.padEnd(16),
      fmt(summary.coveragePct, 7, 1),
      fmt(summary.median, 7, 3),
      fmt(summary.p90, 7, 3),
      fmt(summary.wildPct, 7, 1),
      fmt(summary.flipPct, 7, 1),
      fmt(summary.rest, 7, 3),
      fmt(summary.ms, 7, 1),
      String(summary.shown).padStart(4),
    ].join(' '));
    lines.push(`ungated (ignore confidence, still on the tap span) n=${summary.ungatedN} med=${fmt(summary.ungatedMedian, 0, 3)} wild=${fmt(summary.ungatedWildPct, 0, 1)}% angleMed=${fmt(summary.angleMedian, 0, 1)}°`);
    lines.push('');
  }
  const text = `${lines.join('\n')}\n`;
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'exam-models.txt'), text);
  writeFileSync(path.join(OUT_DIR, 'exam-models.json'), `${JSON.stringify({
    confMin: CONF_MIN,
    summaries: summaries.map((row) => ({
      ...row,
      median: round(row.median, 3),
      p90: round(row.p90, 3),
      wildPct: round(row.wildPct, 2),
      flipPct: round(row.flipPct, 2),
      coveragePct: round(row.coveragePct, 2),
      rest: round(row.rest, 3),
      ms: round(row.ms, 2),
    })),
    clips: perClip.map((clip) => ({
      id: clip.id,
      calOk: clip.calOk,
      hits: clip.hits,
    })),
  }, null, 2)}\n`);
  process.stdout.write(text);
}
