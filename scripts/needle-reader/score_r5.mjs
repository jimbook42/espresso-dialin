/**
 * Phase R5d. Score held-out 20261024_124006 with the R5 model and frozen R4r1 gate.
 *
 *   TZ=UTC node scripts/needle-reader/score_r5.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPORAL_GATE, runTemporalGate } from '../../src/flairPressureLab/temporalGate.js';
import { acceptR2, loadPhaseR4Replay } from './score_r4.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXAM = '20261024_124006';
const RAW = '/workspace/pl-state/nr/train-r5/raw-frames.json';
const REPLAY = '/workspace/pl-state/nr/replay';
const PROFILE = path.join(ROOT, 'profiles/flair58-v1.json');
const LATENCY = '/workspace/pl-state/nr/train-r5/export/latency.json';
const LABELS_R3 = '/workspace/pl-state/nr/real/labels-r3.jsonl';
const R2_RAW = '/workspace/pl-state/nr/train-r2/raw-frames.json';
const OUT_TXT = '/workspace/pl-state/nr/phaseR5-results.txt';
const OUT_JSON = '/workspace/pl-state/nr/phaseR5-results.json';
const SLOT = 0.125;

function chosenGateConfig() {
  return {
    ...TEMPORAL_GATE,
    recovery: 'wide',
    prelock: true,
    classicalCarryS: 0,
    holdGapS: 0.5,
    holdBandBar: 0.5,
  };
}

function round(value, digits) {
  if (value == null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function roundHalfEven(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const floor = Math.floor(x);
  const frac = x - floor;
  if (Math.abs(frac - 0.5) < 1e-10) return sign * (floor % 2 === 0 ? floor : floor + 1);
  return sign * Math.round(x);
}

function buildStream(clip, rawFrames, anchors) {
  const replay = JSON.parse(readFileSync(path.join(REPLAY, `${clip}.json`), 'utf8')).frames;
  const classical = new Map();
  for (const frame of replay) {
    if (frame.timeS == null) continue;
    classical.set(roundHalfEven(frame.timeS / SLOT), frame);
  }
  const frames = rawFrames.filter((f) => f.clip === clip).sort((a, b) => a.timeS - b.timeS);
  return frames.map((frame) => {
    const slot = frame.timeS == null ? null : classical.get(roundHalfEven(frame.timeS / SLOT));
    const tracking = slot?.tracking === 'TRACKING' && slot.bar != null;
    const angle = frame.angle == null ? null : Number(frame.angle);
    const rest = frame.atSec != null
      && frame.timeS != null
      && Math.abs(frame.timeS - frame.atSec) <= 0.5
      && angle != null
      && angle <= 8;
    return {
      t: frame.timeS,
      r2Bar: acceptR2(angle, frame.conf == null ? null : Number(frame.conf), anchors),
      r2Conf: frame.conf == null ? null : Number(frame.conf),
      r2Angle: angle,
      classicalBar: tracking ? Number(slot.bar) : null,
      classicalConfidence: tracking && slot.confidence != null ? Number(slot.confidence) : null,
      rest,
      tracking: frame.tracking,
    };
  });
}

function scoreExam(stream, config) {
  const gated = runTemporalGate(stream, config);
  const shown = [];
  const restErrs = [];
  let flips = 0;
  for (let i = 0; i < stream.length; i += 1) {
    const sample = stream[i];
    const step = gated[i];
    const truth = sample.classicalBar;
    const bar = step.bar;
    if (sample.rest && bar != null) {
      restErrs.push(Math.abs(bar));
    }
    if (bar == null || truth == null) continue;
    const err = Math.abs(bar - truth);
    const wild = err > 1 && !sample.rest;
    shown.push({ t: sample.t, bar, truth, err, wild, rest: sample.rest });
    if (wild && Math.abs((sample.r2Angle ?? 0) - (sample.r2Angle ?? 0) + 180) >= 175) flips += 1;
  }
  const nonRest = shown.filter((row) => !row.rest);
  const cov = (100 * shown.length) / stream.length;
  const med = median(nonRest.map((row) => row.err));
  const wildPct = nonRest.length ? (100 * nonRest.filter((row) => row.wild).length) / nonRest.length : null;
  const restMax = restErrs.length ? Math.max(...restErrs) : null;
  const buckets = {};
  for (const row of shown) {
    const key = Math.floor(row.t / 10) * 10;
    buckets[key] = buckets[key] || { n: 0, err: [] };
    buckets[key].n += 1;
    buckets[key].err.push(row.err);
  }
  const per10 = Object.entries(buckets).map(([start, bucket]) => ({
    startS: Number(start),
    n: bucket.n,
    medianErr: median(bucket.err),
  })).sort((a, b) => a.startS - b.startS);
  const maxBar = shown.reduce((m, row) => Math.max(m, row.bar ?? 0), 0);
  const points = {
    coverage: Math.min(cov / 85, 1) * 20,
    median: med == null ? 0 : Math.min(0.25 / med, 1) * 20,
    wild: wildPct === 0 ? 20 : Math.min(5 / wildPct, 1) * 20,
    flips: flips === 0 ? 20 : 0,
    rest: restMax === 0 ? 20 : 0,
  };
  const total = Object.values(points).reduce((a, b) => a + b, 0);
  const pass = {
    coverage: cov > 85,
    median: med != null && med <= 0.25,
    wild: wildPct != null && wildPct < 5,
    flips: flips === 0,
    rest: restMax === 0,
  };
  return {
    coveragePct: round(cov, 2),
    medianErr: round(med, 3),
    wildPct: round(wildPct, 2),
    flips,
    restMax: round(restMax, 3),
    per10s: per10,
    maxBar: round(maxBar, 2),
    points,
    score100: round(total, 1),
    pass,
    verdict: Object.values(pass).every(Boolean) ? 'GO' : 'NO-GO',
  };
}

function sha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function main() {
  const anchors = JSON.parse(readFileSync(PROFILE, 'utf8')).scale.anchors;
  const raw = JSON.parse(readFileSync(RAW, 'utf8'));
  const config = chosenGateConfig();
  const stream = buildStream(EXAM, raw, anchors);
  const exam = scoreExam(stream, config);
  const replay = JSON.parse(readFileSync(path.join(REPLAY, `${EXAM}.json`), 'utf8'));
  const latency = JSON.parse(readFileSync(LATENCY, 'utf8'));
  const body = {
    verdict: exam.verdict,
    sha: sha(),
    examClip: EXAM,
    section1: exam,
    note: '124006 is one clip; classical TRACKING bar is comparison truth (not hand ground truth).',
    tapCalibration: replay.tapCalibration,
    storedRotationDeg: replay.storedRotationDeg,
    latency4x: latency,
  };
  const lines = [
    `Phase R5 exam. verdict ${exam.verdict}`,
    `SHA ${body.sha}`,
    `Held-out ${EXAM}. One clip — first read, not a statistical result.`,
    'Truth = classical tap-calibrated TRACKING bar from replay (no hand labels for 124006).',
    '',
    'SECTION 1 — Real-use /100',
    `  coverage ${exam.coveragePct}%  PASS>${85}? ${exam.pass.coverage ? 'PASS' : 'FAIL'}`,
    `  median ${exam.medianErr} bar  PASS<=0.25? ${exam.pass.median ? 'PASS' : 'FAIL'}`,
    `  wild ${exam.wildPct}%  PASS<5? ${exam.pass.wild ? 'PASS' : 'FAIL'}`,
    `  flips ${exam.flips}  PASS=0? ${exam.pass.flips ? 'PASS' : 'FAIL'}`,
    `  rest max ${exam.restMax}  PASS=0? ${exam.pass.rest ? 'PASS' : 'FAIL'}`,
    `  score /100 = ${exam.score100}  (${JSON.stringify(exam.points)})`,
    `  max bar shown ${exam.maxBar}`,
    '',
    'per 10s:',
    ...exam.per10s.map((row) => `  t=${row.startS}-${row.startS + 10}s n=${row.n} med=${row.medianErr}`),
    '',
    'SECTION 2 — Bench/setup: see phaseR5-results.json bench key (SEEN/leaky clips).',
  ];
  writeFileSync(OUT_TXT, `${lines.join('\n')}\n`);
  writeFileSync(OUT_JSON, `${JSON.stringify(body, null, 2)}\n`);
  process.stdout.write(lines.join('\n'));
}

main();
