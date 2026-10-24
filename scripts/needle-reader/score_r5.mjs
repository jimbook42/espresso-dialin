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
import { acceptR2 } from './score_r4.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXAM = '20261024_124006';
const RAW = '/workspace/pl-state/nr/train-r5/raw-frames.json';
const R2_RAW = '/workspace/pl-state/nr/train-r2/raw-frames.json';
const REPLAY = '/workspace/pl-state/nr/replay';
const PROFILE = path.join(ROOT, 'profiles/flair58-v1.json');
const LATENCY = '/workspace/pl-state/nr/train-r5/export/latency.json';
const LABELS_R3 = '/workspace/pl-state/nr/real/labels-r3.jsonl';
const LABEL_STATS = '/workspace/pl-state/nr/real/labels-r3-stats.json';
const HPARAMS = '/workspace/pl-state/nr/train-r5/hparams.json';
const OUT_TXT = '/workspace/pl-state/nr/phaseR5-results.txt';
const OUT_JSON = '/workspace/pl-state/nr/phaseR5-results.json';
const SLOT = 0.125;
const FLIP_DEG = TEMPORAL_GATE.flipDeg ?? 25;

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

function circ(a, b) {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
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
      classicalAngle: tracking && slot.needleAngleDeg != null ? Number(slot.needleAngleDeg) : null,
      rest,
      tracking: frame.tracking,
    };
  });
}

function scoreExam(stream, config) {
  const gated = runTemporalGate(stream, config);
  const published = gated.filter((step) => step.bar != null).length;
  const cov = (100 * published) / stream.length;
  const errs = [];
  const restErrs = [];
  let flips = 0;
  const per10 = {};
  let maxBar = 0;
  for (let i = 0; i < stream.length; i += 1) {
    const sample = stream[i];
    const step = gated[i];
    const bar = step.bar;
    if (bar != null) maxBar = Math.max(maxBar, bar);
    if (sample.rest) {
      if (bar != null) restErrs.push(Math.abs(bar));
      continue;
    }
    if (bar == null || sample.classicalBar == null) continue;
    const err = Math.abs(bar - sample.classicalBar);
    const wild = err > 1;
    errs.push({ t: sample.t, err, wild, bar, truth: sample.classicalBar });
    if (wild && bar < 1.5 && sample.classicalBar > 3) flips += 1;
    const bucket = Math.floor(sample.t / 10) * 10;
    per10[bucket] = per10[bucket] || [];
    per10[bucket].push(err);
  }
  const med = median(errs.map((row) => row.err));
  const wildPct = errs.length ? (100 * errs.filter((row) => row.wild).length) / errs.length : null;
  const restMax = restErrs.length ? Math.max(...restErrs) : 0;
  const per10rows = Object.entries(per10).map(([start, bucket]) => ({
    startS: Number(start),
    n: bucket.length,
    medianErr: round(median(bucket), 3),
  })).sort((a, b) => a.startS - b.startS);
  const points = {
    coverage: Math.min(cov / 85, 1) * 20,
    median: med == null ? 0 : Math.min(0.25 / med, 1) * 20,
    wild: wildPct === 0 ? 20 : Math.min(5 / wildPct, 1) * 20,
    flips: flips === 0 ? 20 : 0,
    rest: restMax === 0 ? 20 : 0,
  };
  const pass = {
    coverage: cov > 85,
    median: med != null && med <= 0.25,
    wild: wildPct != null && wildPct < 5,
    flips: flips === 0,
    rest: restMax === 0,
  };
  return {
    coveragePct: round(cov, 2),
    published,
    totalFrames: stream.length,
    medianErr: round(med, 3),
    wildPct: round(wildPct, 2),
    flips,
    restMax: round(restMax, 3),
    per10s: per10rows,
    maxBar: round(maxBar, 2),
    points,
    score100: round(Object.values(points).reduce((a, b) => a + b, 0), 1),
    pass,
    verdict: Object.values(pass).every(Boolean) ? 'GO' : 'NO-GO',
  };
}

function loadJsonl(file) {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function benchPack2(raw, r2raw, anchors, config) {
  const labels = loadJsonl(LABELS_R3).filter((row) => String(row.source || '').startsWith('isaac2'));
  const byClip = {};
  for (const row of labels) {
    byClip[row.clip] = byClip[row.clip] || [];
    byClip[row.clip].push(row);
  }
  let r5errs = [];
  let r2errs = [];
  for (const [clip, rows] of Object.entries(byClip)) {
    const stream = buildStream(clip, raw, anchors);
    const gated = runTemporalGate(stream, config);
    const r2stream = buildStream(clip, r2raw, anchors);
    const r2gated = runTemporalGate(r2stream, config);
    for (const row of rows) {
      const idx = stream.findIndex((s) => Math.abs(s.t - row.timeS) < 0.07);
      if (idx < 0 || row.bar == null) continue;
      const bar = gated[idx]?.bar;
      if (bar != null) r5errs.push(Math.abs(bar - row.bar));
      const bar2 = r2gated[idx]?.bar;
      if (bar2 != null) r2errs.push(Math.abs(bar2 - row.bar));
    }
  }
  const hi = labels.filter((row) => row.bar != null && row.bar >= 7 && row.bar <= 10);
  return {
    pack2Frames: labels.length,
    r5Median: round(median(r5errs), 3),
    r2Median: round(median(r2errs), 3),
    highBarFrames: hi.length,
  };
}

function sha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function remoteSha() {
  try {
    return execSync('git ls-remote origin refs/heads/cursor/6-42-needle-reader', { cwd: ROOT, encoding: 'utf8' })
      .trim().split(/\s+/)[0];
  } catch {
    return null;
  }
}

function main() {
  const anchors = JSON.parse(readFileSync(PROFILE, 'utf8')).scale.anchors;
  const raw = JSON.parse(readFileSync(RAW, 'utf8'));
  const r2raw = JSON.parse(readFileSync(R2_RAW, 'utf8'));
  const config = chosenGateConfig();
  const stream = buildStream(EXAM, raw, anchors);
  const exam = scoreExam(stream, config);
  const replay = JSON.parse(readFileSync(path.join(REPLAY, `${EXAM}.json`), 'utf8'));
  const replay140 = JSON.parse(readFileSync(path.join(REPLAY, '20261024_124140.json'), 'utf8'));
  const latency = JSON.parse(readFileSync(LATENCY, 'utf8'));
  const labelStats = JSON.parse(readFileSync(LABEL_STATS, 'utf8'));
  const hparams = JSON.parse(readFileSync(HPARAMS, 'utf8'));
  const bench = benchPack2(raw, r2raw, anchors, config);
  const localSha = sha();
  const pushedSha = remoteSha();
  const body = {
    verdict: exam.verdict,
    sha: localSha,
    pushedSha,
    examClip: EXAM,
    section1: exam,
    section2: {
      note: 'Bench only; SEEN/leaky (training data). Not part of /100.',
      tapLock: {
        '20261024_124006': {
          method: 'legacy automatic gauge tracker (no Isaac taps); tapCalibration.applied=false',
          storedRotationDeg: replay.storedRotationDeg ?? -90,
          tapCalibration: replay.tapCalibration,
        },
        '20261024_124140': {
          method: 'legacy automatic gauge tracker (no Isaac taps); tapCalibration.applied=false',
          storedRotationDeg: replay140.storedRotationDeg ?? 90,
          tapCalibration: replay140.tapCalibration,
        },
      },
      rotationSanity: {
        '20261024_124006': 'ffprobe rotation -90°; H.264 replay stored with -noautorotate; PNG stills autorotate upright (matches newshots/samples/124006_*.jpg).',
        '20261024_124140': 'ffprobe rotation +90°; same pipeline; matches newshots/samples/124140_*.jpg.',
      },
      pack2Bench: bench,
      latency4x: latency,
    },
    labels: labelStats,
    hparams,
    likelyCause: exam.verdict === 'NO-GO'
      ? 'Coverage fail: new clip has no tap lock (classical TRACKING on only ~55% of frames) and the temporal gate withholds pre-lock / disagree frames; shot peak ~2.7 bar so high-bar training did not apply on this exam pull.'
      : null,
    artifacts: {
      trainR5: '/workspace/pl-state/nr/train-r5/',
      labelsR3: LABELS_R3,
      onnx: '/workspace/pl-state/nr/train-r5/export/needle-cartesian.int8.onnx',
    },
    reproduce: [
      'TZ=UTC /workspace/bin/box-test-slot --build node scripts/needle-reader/build_r5_replay.mjs',
      '/workspace/venvs/nr/bin/python scripts/needle-reader/merge_r3.py',
      'TZ=UTC BOX_TEST_TIMEOUT=60m /workspace/bin/box-test-slot --build /workspace/venvs/nr/bin/python scripts/needle-reader/train_r2.py all --variant r5',
      'TZ=UTC node scripts/needle-reader/score_r5.mjs',
      'timeout 10m npx vitest run scripts/pressure-replay/replayClipConfig.vitest.js',
    ],
    note: '124006 is one clip; classical TRACKING bar is comparison truth (not hand ground truth).',
  };
  const lines = [
    `Phase R5. verdict ${exam.verdict}`,
    `SHA ${localSha}  pushed ${pushedSha}`,
    `Held-out ${EXAM}. One clip — first read, not a statistical result.`,
    'Truth = classical TRACKING bar from replay (no hand labels for 124006).',
    '',
    'SECTION 1 — Real-use (/100)',
    `  coverage ${exam.coveragePct}% (${exam.published}/${exam.totalFrames} published)  ${exam.pass.coverage ? 'PASS' : 'FAIL'}  (>85%)`,
    `  median ${exam.medianErr} bar  ${exam.pass.median ? 'PASS' : 'FAIL'}  (<=0.25)`,
    `  wild ${exam.wildPct}%  ${exam.pass.wild ? 'PASS' : 'FAIL'}  (<5%)`,
    `  flips ${exam.flips}  ${exam.pass.flips ? 'PASS' : 'FAIL'}  (=0)`,
    `  rest max ${exam.restMax}  ${exam.pass.rest ? 'PASS' : 'FAIL'}  (=0)`,
    `  /100 = ${exam.score100}  points ${JSON.stringify(exam.points)}`,
    `  max bar reached ${exam.maxBar}`,
    '',
    'per 10s (published vs classical, non-rest):',
    ...exam.per10s.map((row) => `  t=${row.startS}-${row.startS + 10}s n=${row.n} med=${row.medianErr}`),
    '',
    'SECTION 2 — Bench/setup (not in /100)',
    '  Tap: legacy tracker lock on first ~0 bar TRACKING frame; no manual taps.',
    `  124006 rotation ${body.section2.tapLock['20261024_124006'].storedRotationDeg}°`,
    `  124140 rotation ${body.section2.tapLock['20261024_124140'].storedRotationDeg}°`,
    `  pack-2 bench n=${bench.pack2Frames} R5 med=${bench.r5Median} R2 med=${bench.r2Median} (SEEN)`,
    `  latency 4x model=${latency.model4xMs}ms total=${latency.total4xMs}ms`,
    '',
    `labels-r3: ${labelStats.n} rows; 7-10 bar before ${labelStats.bands7to10.beforeFrames7to10} after ${labelStats.bands7to10.afterFrames7to10}`,
    `skipped review2: ${labelStats.skippedReview2.join(', ')}`,
    '',
    exam.verdict === 'NO-GO' ? `Likely cause: ${body.likelyCause}` : '',
  ].filter(Boolean);
  writeFileSync(OUT_TXT, `${lines.join('\n')}\n`);
  writeFileSync(OUT_JSON, `${JSON.stringify(body, null, 2)}\n`);
  process.stdout.write(lines.join('\n'));
}

main();
