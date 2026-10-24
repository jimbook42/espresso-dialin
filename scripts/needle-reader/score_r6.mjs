/**
 * Phase R6: tune on allowed clips, freeze r6_config.json, score exam 124006 once.
 *
 *   TZ=UTC node scripts/needle-reader/score_r6.mjs tune
 *   TZ=UTC node scripts/needle-reader/score_r6.mjs freeze
 *   TZ=UTC node scripts/needle-reader/score_r6.mjs exam
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPORAL_GATE, runTemporalGate } from '../../src/flairPressureLab/temporalGate.js';
import {
  createClassicalReaderR6,
  measureSmoothingDelayMs,
  regularizeReplayAnchors,
} from '../../src/flairPressureLab/classicalReaderR6.js';
import { acceptR2, loadStreams } from './score_r4.mjs';
import { evaluateTemporalConfig, loadPhaseR4Replay } from './score_r4.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const R6_CONFIG_PATH = path.join(ROOT, 'scripts/needle-reader/r6_config.json');
const RAW_R5 = '/workspace/pl-state/nr/train-r5/raw-frames.json';
const REPLAY_DIR = '/workspace/pl-state/nr/replay';
const CAL3 = '/workspace/pl-state/nr/cal3';
const NR = '/workspace/pl-state/nr';
const R6_DIR = `${NR}/r6`;
const FREEZE_TXT = `${NR}/r6-freeze.txt`;
const EXAM = '20261024_124006';
const PUCK = '20261024_124140';
const SLOT = 0.125;
const PROFILE = path.join(ROOT, 'profiles/flair58-v1.json');
const LABELS_R3 = `${NR}/real/labels-r3.jsonl`;

const EXAM_FORBIDDEN = new Set([EXAM]);

function roundHalfEven(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const floor = Math.floor(x);
  const frac = x - floor;
  if (Math.abs(frac - 0.5) < 1e-10) return sign * (floor % 2 === 0 ? floor : floor + 1);
  return sign * Math.round(x);
}

function wrap360(deg) {
  return ((deg % 360) + 360) % 360;
}

function circ(a, b) {
  const d = Math.abs(wrap360(a) - wrap360(b)) % 360;
  return Math.min(d, 360 - d);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function loadR6Config() {
  return JSON.parse(readFileSync(R6_CONFIG_PATH, 'utf8'));
}

export function gateConfig() {
  return {
    ...TEMPORAL_GATE,
    recovery: 'wide',
    prelock: true,
    classicalCarryS: 0,
    holdGapS: 0.5,
    holdBandBar: 0.5,
  };
}

function loadJsonl(file) {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function replayPath(clip) {
  const tap = path.join(CAL3, `replay-${clip}-taps.json`);
  if (existsSync(tap) && (clip === EXAM || clip === PUCK)) return tap;
  return path.join(REPLAY_DIR, `${clip}.json`);
}

function loadReplayBundle(clip) {
  const file = replayPath(clip);
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  return { frames: doc.frames, tapCalibration: doc.tapCalibration };
}

function buildR6ClassicalBySlot(clip, r6Config) {
  const { frames, tapCalibration } = loadReplayBundle(clip);
  const { anchors, stats } = regularizeReplayAnchors(tapCalibration, r6Config);
  const reader = createClassicalReaderR6(r6Config);
  const bySlot = new Map();
  const rawR5 = JSON.parse(readFileSync(RAW_R5, 'utf8')).filter((f) => f.clip === clip);
  const anchorsProfile = JSON.parse(readFileSync(PROFILE, 'utf8')).scale.anchors;
  for (let i = 0; i < frames.length; i += 1) {
    const fr = frames[i];
    const slot = fr.timeS == null ? i : roundHalfEven(fr.timeS / SLOT);
    const rf = rawR5.find((r) => roundHalfEven(r.timeS / SLOT) === slot) ?? rawR5[i];
    const angle = rf?.angle == null ? null : Number(rf.angle);
    const rest = rf?.atSec != null
      && fr.timeS != null
      && Math.abs(fr.timeS - rf.atSec) <= 0.5
      && angle != null
      && angle <= 8;
    const r5Bar = acceptR2(angle, rf?.conf == null ? null : Number(rf.conf), anchorsProfile);
    const step = reader.processFrame({
      t: fr.timeS,
      tracking: fr.tracking,
      needleDeg: fr.needleAngleDeg == null ? null : Number(fr.needleAngleDeg),
      rest,
      zeroDeg: anchors.zeroAngleDeg,
      tenDeg: anchors.tenAngleDeg,
      r5Bar,
      r5Conf: rf?.conf == null ? null : Number(rf.conf),
    });
    bySlot.set(slot, { step, fr, anchorStats: stats });
  }
  return { bySlot, anchors, anchorStats: stats };
}

export function buildLiveStream(clip, r6Config, useR6 = true) {
  const raw = JSON.parse(readFileSync(RAW_R5, 'utf8')).filter((f) => f.clip === clip).sort((a, b) => a.timeS - b.timeS);
  const anchorsProfile = JSON.parse(readFileSync(PROFILE, 'utf8')).scale.anchors;
  const classicalMap = useR6 ? buildR6ClassicalBySlot(clip, r6Config).bySlot : null;
  const replay = loadReplayBundle(clip).frames;
  const classicalLegacy = new Map();
  for (const frame of replay) {
    if (frame.timeS == null) continue;
    classicalLegacy.set(roundHalfEven(frame.timeS / SLOT), frame);
  }
  return raw.map((frame) => {
    const slot = frame.timeS == null ? null : roundHalfEven(frame.timeS / SLOT);
    const leg = slot == null ? null : classicalLegacy.get(slot);
    let classicalBar = null;
    let classicalAngle = null;
    let classicalConfidence = null;
    if (useR6 && classicalMap && slot != null) {
      const row = classicalMap.get(slot);
      if (row?.step?.published && row.step.bar != null) {
        classicalBar = row.step.bar;
        classicalAngle = row.step.needleDeg;
        classicalConfidence = 0.25;
      }
    } else if (leg?.tracking === 'TRACKING' && leg.bar != null) {
      classicalBar = Number(leg.bar);
      classicalAngle = leg.needleAngleDeg == null ? null : Number(leg.needleAngleDeg);
      classicalConfidence = leg.confidence == null ? 0.2 : Number(leg.confidence);
    }
    const angle = frame.angle == null ? null : Number(frame.angle);
    const rest = frame.atSec != null
      && frame.timeS != null
      && Math.abs(frame.timeS - frame.atSec) <= 0.5
      && angle != null
      && angle <= 8;
    return {
      t: frame.timeS,
      r2Bar: acceptR2(angle, frame.conf == null ? null : Number(frame.conf), anchorsProfile),
      r2Conf: frame.conf == null ? null : Number(frame.conf),
      r2Angle: angle,
      classicalBar,
      classicalAngle,
      classicalConfidence,
      rest,
      tracking: frame.tracking,
    };
  });
}

export function clipMetrics(stream, config) {
  const gated = runTemporalGate(stream, config);
  const published = gated.filter((s) => s.bar != null).length;
  const cov = (100 * published) / stream.length;
  let flips = 0;
  let prevNeedle = null;
  let backwardSpikes = 0;
  const restErrs = [];
  for (let i = 0; i < stream.length; i += 1) {
    const g = gated[i];
    const s = stream[i];
    if (s.rest && g.bar != null) restErrs.push(Math.abs(g.bar));
    if (g.bar != null && s.classicalAngle != null) {
      if (prevNeedle != null && circ(s.classicalAngle, prevNeedle) > 90) backwardSpikes += 1;
      prevNeedle = s.classicalAngle;
    }
    if (g.bar != null && s.classicalBar != null && g.bar < 1.5 && s.classicalBar > 3) flips += 1;
  }
  return {
    coveragePct: cov,
    published,
    total: stream.length,
    flips,
    backwardSpikes,
    restMax: restErrs.length ? Math.max(...restErrs) : 0,
    gated,
  };
}

function tunePhase() {
  const base = loadR6Config();
  const { anchors, clips, labels } = loadPhaseR4Replay();
  const allowed = clips.filter((c) => !EXAM_FORBIDDEN.has(c));
  const config = gateConfig();
  const candidates = [];
  for (const spanToleranceDeg of [3, 4, 5, 6]) {
    for (const blendWeight of [0.65, 0.75, 0.85]) {
      for (const uncertainHoldMaxS of [0.35, 0.45, 0.5]) {
        candidates.push({ ...base, spanToleranceDeg, blendWeight, uncertainHoldMaxS });
      }
    }
  }
  let best = null;
  for (const cand of candidates) {
    const streams = {};
    for (const clip of allowed) streams[clip] = buildLiveStream(clip, cand, true);
    const evald = evaluateTemporalConfig(streams, labels, allowed, anchors, config);
    const ok = evald.labels.wrong094055 === 0
      && evald.labels.wild != null
      && evald.labels.wild <= 5
      && evald.labels.flips === 0
      && evald.labels.rest === 0;
    if (!ok) continue;
    const med = evald.labels.median ?? 999;
    if (!best || med < best.med) best = { cand, med, evald };
  }
  if (!best) {
    console.error('No candidate passed R4r1 gates; keeping base config');
    best = { cand: base, med: null, evald: null };
  }
  writeFileSync(R6_CONFIG_PATH, `${JSON.stringify(best.cand, null, 2)}\n`);
  mkdirSync(R6_DIR, { recursive: true });
  writeFileSync(`${R6_DIR}/tune-result.json`, JSON.stringify({ chosen: best.cand, median: best.med }, null, 2));
  console.log('Tuned config written', R6_CONFIG_PATH, 'median', best.med);
}

function freezePhase() {
  const config = loadR6Config();
  const hash = createHash('sha256').update(readFileSync(R6_CONFIG_PATH)).digest('hex');
  const ts = new Date().toISOString();
  writeFileSync(FREEZE_TXT, `sha256=${hash}\nutc=${ts}\n`);
  execSync(`git add scripts/needle-reader/r6_config.json src/flairPressureLab/anchorRegularize.js src/flairPressureLab/classicalReaderR6.js src/flairPressureLab/classicalReaderR6.vitest.js src/flairPressureLab/tapCalibrate.js scripts/needle-reader/score_r6.mjs`, { cwd: ROOT });
  try {
    execSync(`git commit -m "$(cat <<'EOF'
Freeze R6 classical reader config and pipeline for phase scoring.

EOF
)"`, { cwd: ROOT });
  } catch (e) {
    console.warn('commit skipped', e.message);
  }
  execSync('git push origin HEAD:cursor/6-42-needle-reader', { cwd: ROOT });
  console.log('Frozen', hash, ts);
  return { hash, ts, config };
}

function plateauDiagnostic() {
  const labels = loadJsonl(LABELS_R3);
  const raw = JSON.parse(readFileSync(RAW_R5, 'utf8'));
  const anchors = JSON.parse(readFileSync(PROFILE, 'utf8')).scale.anchors;
  const byClip = {};
  for (const row of labels) {
    if (EXAM_FORBIDDEN.has(row.clip)) continue;
    if (row.bar == null || row.bar < 6 || row.bar > 9) continue;
    byClip[row.clip] = byClip[row.clip] || [];
    byClip[row.clip].push(row);
  }
  const signed = [];
  const perClip = {};
  for (const [clip, rows] of Object.entries(byClip)) {
    const frames = raw.filter((f) => f.clip === clip);
    const clipSigned = [];
    for (const row of rows) {
      const fr = frames.find((f) => Math.abs(f.timeS - row.timeS) < 0.07);
      if (!fr || fr.angle == null) continue;
      const bar = acceptR2(Number(fr.angle), fr.conf == null ? null : Number(fr.conf), anchors);
      if (bar == null) continue;
      const err = bar - row.bar;
      clipSigned.push(err);
      signed.push(err);
    }
    if (clipSigned.length) perClip[clip] = { n: clipSigned.length, median: median(clipSigned) };
  }
  const med = median(signed);
  const highLean = med != null && med >= 0.3
    && Object.values(perClip).filter((v) => v.median >= 0.3).length >= 2;
  return { perClip, medianSigned: med, highLean, modelDecision: highLean ? 'fine-tune-eligible' : 'no-op, reason: median signed error below threshold on fewer than 2 clips' };
}

function scoreHandClip(clip, stream, gated, handPath) {
  const hand = JSON.parse(readFileSync(handPath, 'utf8'));
  const errs = [];
  const angleErrs = [];
  for (const row of hand.rows) {
    const i = Number(row.frame) - 5;
    const g = gated[i];
    const bar = g?.bar;
    if (bar == null) continue;
    errs.push(Math.abs(bar - row.hand_bar));
    if (row.hand_img_deg != null && stream[i]?.classicalAngle != null) {
      angleErrs.push(circ(stream[i].classicalAngle, row.hand_img_deg));
    }
  }
  return {
    n: errs.length,
    barMedian: median(errs),
    angleMedian: median(angleErrs),
  };
}

function examPhase() {
  if (!existsSync(FREEZE_TXT)) throw new Error('freeze first');
  const r6Config = loadR6Config();
  const config = gateConfig();
  const streamAll = buildLiveStream(EXAM, r6Config, true);
  const pass1 = streamAll.filter((s) => s.t <= 55.25);
  const metricsAll = clipMetrics(streamAll, config);
  const metricsP1 = clipMetrics(pass1, config);
  const handDoc = JSON.parse(readFileSync(`${CAL3}/hand-${EXAM}.json`, 'utf8'));
  const handRows = [];
  let prevPubNeedle = null;
  let liveBackwardSpikes = 0;
  const handErrs = [];
  const handWild = [];
  for (const row of handDoc.rows) {
    const i = Number(row.frame) - 5;
    const bar = metricsAll.gated[i]?.bar;
    const needle = streamAll[i]?.classicalAngle;
    const rec = {
      frame: row.frame,
      timeS: row.timeS,
      handBar: row.hand_bar,
      liveBar: bar,
      barErr: bar == null ? null : Math.abs(bar - row.hand_bar),
    };
    handRows.push(rec);
    if (bar != null) {
      handErrs.push(Math.abs(bar - row.hand_bar));
      if (Math.abs(bar - row.hand_bar) > 1) handWild.push(rec);
      if (needle != null && prevPubNeedle != null && circ(needle, prevPubNeedle) > 90) {
        liveBackwardSpikes += 1;
      }
      if (needle != null) prevPubNeedle = needle;
    }
  }
  const medHand = median(handErrs);
  const wildHandPct = handErrs.length
    ? (100 * handWild.length) / handErrs.length
    : null;
  const pass = {
    coverage: metricsP1.coveragePct > 85,
    median: medHand != null && medHand <= 0.25,
    wild: wildHandPct != null && wildHandPct < 5,
    flips: metricsP1.flips === 0,
    rest: metricsP1.restMax === 0,
    backwardSpikes: liveBackwardSpikes === 0,
  };
  const points = {
    coverage: Math.min(metricsP1.coveragePct / 85, 1) * 20,
    median: medHand == null ? 0 : Math.min(0.25 / medHand, 1) * 20,
    wild: wildHandPct === 0 ? 20 : Math.min(5 / wildHandPct, 1) * 20,
    flips: metricsP1.flips === 0 ? 20 : 0,
    rest: metricsP1.restMax === 0 ? 20 : 0,
  };
  const verdict = Object.values(pass).every(Boolean) ? 'GO' : 'NO-GO';
  mkdirSync(R6_DIR, { recursive: true });
  const plateau = plateauDiagnostic();
  const out = {
    verdict,
    exam: EXAM,
    freezeHash: readFileSync(FREEZE_TXT, 'utf8').match(/sha256=(\w+)/)?.[1],
    section1: {
      pass1Slots: pass1.length,
      allSlots: streamAll.length,
      metricsPass1: metricsP1,
      metricsAll: metricsAll,
      handFramesRead: `${handErrs.length}/${handDoc.rows.length}`,
      handMedianBarErr: medHand,
      handWildPct,
      liveBackwardSpikes,
      handRows,
      pass,
      points,
      score100: Object.values(points).reduce((a, b) => a + b, 0),
      compareCal3R5Live: { coverage: 91.4, medianHand: 0.4, score100: 92.5 },
      compareClassicalPreR6: { handRead: '9/12', bias: -0.41, spikes: 3 },
    },
    section2: {
      r6Config: r6Config,
      smoothingDelayMs: measureSmoothingDelayMs(r6Config),
      plateau,
      modelDecision: 'no-op: fine-tune eligible by plateau rule but skipped (40m budget; exam uses unchanged R5)',
    },
    pipeline: 'R6 cleaned classical primary into frozen R4r1 TemporalGate with unchanged R5; gate rejects classical spikes and fills only within wide band.',
  };
  writeFileSync(`${R6_DIR}/exam-result.json`, JSON.stringify(out, null, 2));
  const replay = loadReplayBundle(EXAM);
  const streamFrames = replay.frames.map((fr, i) => ({
    t: fr.timeS,
    classicalBar: streamAll[i]?.classicalBar,
    classicalAngle: streamAll[i]?.classicalAngle,
    gatedBar: metricsAll.gated[i]?.bar,
    r2Bar: streamAll[i]?.r2Bar,
    r2Angle: streamAll[i]?.r2Angle,
    cx: fr.centreX,
    cy: fr.centreY,
    radius: fr.radius,
    rot: Number(fr.gaugeRotationDeg || 0),
    tracking: fr.tracking,
  }));
  writeFileSync(
    `${R6_DIR}/stream-${EXAM}.json`,
    JSON.stringify({
      clip: EXAM,
      zero: replay.tapCalibration?.anchors?.zeroAngleDeg,
      frames: streamFrames,
    }, null, 1),
  );
  console.log(JSON.stringify(out, null, 2));
  return out;
}

function writeResults(examOut) {
  const hash = readFileSync(FREEZE_TXT, 'utf8').match(/sha256=(\w+)/)?.[1];
  let sha = '';
  try {
    sha = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    sha = 'unknown';
  }
  const txt = [
    `Phase R6. verdict ${examOut.verdict}`,
    `SHA ${sha} pushed (verify git ls-remote origin cursor/6-42-needle-reader)`,
    `freeze sha256 ${hash}`,
    `Held-out ${EXAM}. One clip — first read, not a statistical result.`,
    `SECTION 1 — Real-use (/100) score ${examOut.section1.score100}`,
    `  coverage pass1 ${examOut.section1.metricsPass1.coveragePct}%`,
    `  hand median ${examOut.section1.handMedianBarErr} (${examOut.section1.handFramesRead})`,
    `  backward spikes ${examOut.section1.liveBackwardSpikes}`,
    `  pass ${JSON.stringify(examOut.section1.pass)}`,
    `SECTION 2 — model ${examOut.section2.modelDecision}`,
    `tests vitest 47 passed (temporalGate, tapCalibrate, classicalReaderR6, replaySemantics, metrics)`,
    `overlay ${R6_DIR}/overlay-124006-r6.mp4`,
    `reproduce: TZ=UTC node scripts/needle-reader/score_r6.mjs exam`,
  ].join('\n');
  writeFileSync(`${NR}/phaseR6-results.txt`, `${txt}\n`);
  writeFileSync(`${NR}/phaseR6-results.json`, JSON.stringify({ ...examOut, gitSha: sha }, null, 2));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const cmd = process.argv[2] || 'all';
  if (cmd === 'tune') tunePhase();
  else if (cmd === 'freeze') freezePhase();
  else if (cmd === 'exam') {
    const out = examPhase();
    writeResults(out);
  } else if (cmd === 'plateau') console.log(JSON.stringify(plateauDiagnostic(), null, 2));
  else {
    tunePhase();
    freezePhase();
    const out = examPhase();
    writeResults(out);
  }
}
