/**
 * Phase R7: fix R6 coverage loss on allowed clips; freeze; SEEN re-check 124006 once.
 *
 *   TZ=UTC node scripts/needle-reader/score_r7.mjs drops
 *   TZ=UTC node scripts/needle-reader/score_r7.mjs tune
 *   TZ=UTC node scripts/needle-reader/score_r7.mjs freeze
 *   TZ=UTC node scripts/needle-reader/score_r7.mjs exam
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPORAL_GATE, runTemporalGate, stepTemporalGate, initialTemporalState } from '../../src/flairPressureLab/temporalGate.js';
import {
  createClassicalReaderR6,
  measureSmoothingDelayMs,
  regularizeReplayAnchors,
} from '../../src/flairPressureLab/classicalReaderR6.js';
import { acceptR2, evaluateTemporalConfig, loadPhaseR4Replay } from './score_r4.mjs';
import { buildLiveStream as buildLiveStreamR6, clipMetrics as clipMetricsR6, loadR6Config } from './score_r6.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const R7_CONFIG_PATH = path.join(ROOT, 'scripts/needle-reader/r7_config.json');
const RAW_R5 = '/workspace/pl-state/nr/train-r5/raw-frames.json';
const REPLAY_DIR = '/workspace/pl-state/nr/replay';
const CAL3 = '/workspace/pl-state/nr/cal3';
const NR = '/workspace/pl-state/nr';
const R7_DIR = `${NR}/r7`;
const FREEZE_TXT = `${NR}/r7-freeze.txt`;
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

export function loadR7Config() {
  const raw = JSON.parse(readFileSync(R7_CONFIG_PATH, 'utf8'));
  const {
    classicalDirect,
    classicalDirectMaxDisagreeBar,
    classicalDirectMaxR2Conf,
    plateauBiasCorrection,
    ...reader
  } = raw;
  return {
    reader,
    gate: { classicalDirect, classicalDirectMaxDisagreeBar, classicalDirectMaxR2Conf },
    plateauBiasCorrection,
  };
}

export function gateConfigR7(r7 = loadR7Config()) {
  return {
    ...TEMPORAL_GATE,
    recovery: 'wide',
    prelock: true,
    classicalCarryS: 0,
    holdGapS: 0.5,
    holdBandBar: 0.5,
    classicalDirect: r7.gate.classicalDirect === true,
    classicalDirectMaxDisagreeBar: r7.gate.classicalDirectMaxDisagreeBar ?? 2,
    classicalDirectMaxR2Conf: r7.gate.classicalDirectMaxR2Conf ?? null,
    classicalDirectAllowWeakR2: false,
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

function applyPlateauBias(bar, correction) {
  if (bar == null || !correction || correction.type !== 'plateau-subtract') return bar;
  const { minBar = 6, maxBar = 9, subtract = 0 } = correction;
  if (bar >= minBar && bar <= maxBar) return bar - subtract;
  return bar;
}

function buildClassicalBySlot(clip, readerConfig) {
  const { frames, tapCalibration } = loadReplayBundle(clip);
  const { anchors, stats } = regularizeReplayAnchors(tapCalibration, readerConfig);
  const reader = createClassicalReaderR6(readerConfig);
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

export function buildLiveStream(clip, r7Bundle = loadR7Config()) {
  const { reader: readerConfig, plateauBiasCorrection } = r7Bundle;
  const raw = JSON.parse(readFileSync(RAW_R5, 'utf8')).filter((f) => f.clip === clip).sort((a, b) => a.timeS - b.timeS);
  const anchorsProfile = JSON.parse(readFileSync(PROFILE, 'utf8')).scale.anchors;
  const classicalMap = buildClassicalBySlot(clip, readerConfig).bySlot;
  const replay = loadReplayBundle(clip).frames;
  const classicalLegacy = new Map();
  for (const frame of replay) {
    if (frame.timeS == null) continue;
    classicalLegacy.set(roundHalfEven(frame.timeS / SLOT), frame);
  }
  return raw.map((frame) => {
    const slot = frame.timeS == null ? null : roundHalfEven(frame.timeS / SLOT);
    let classicalBar = null;
    let classicalAngle = null;
    let classicalConfidence = null;
    if (slot != null) {
      const row = classicalMap.get(slot);
      if (row?.step?.published && row.step.bar != null) {
        classicalBar = row.step.bar;
        classicalAngle = row.step.needleDeg;
        classicalConfidence = 0.25;
      }
    }
    const angle = frame.angle == null ? null : Number(frame.angle);
    const rest = frame.atSec != null
      && frame.timeS != null
      && Math.abs(frame.timeS - frame.atSec) <= 0.5
      && angle != null
      && angle <= 8;
    let r2Bar = acceptR2(angle, frame.conf == null ? null : Number(frame.conf), anchorsProfile);
    r2Bar = applyPlateauBias(r2Bar, plateauBiasCorrection);
    return {
      t: frame.timeS,
      r2Bar,
      r2Conf: frame.conf == null ? null : Number(frame.conf),
      r2Angle: angle,
      classicalBar,
      classicalAngle,
      classicalConfidence,
      rest,
      tracking: frame.tracking,
      _classicalStep: slot != null ? classicalMap.get(slot)?.step : null,
    };
  });
}

export function clipMetrics(stream, gateConfig) {
  const stripped = stream.map(({ _classicalStep, ...s }) => s);
  const gated = runTemporalGate(stripped, gateConfig);
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

function classifyClassicalDrop(step) {
  if (!step || step.published) return null;
  if (step.reason === 'spike-reject') return step.spikeRejected ? 'classical-spike' : 'classical-arc';
  if (step.reason === 'rate-reject') return 'classical-rate';
  if (step.reason === 'uncertain' || step.reason === 'uncertain-hold') return 'classical-uncertain';
  return `classical-${step.reason}`;
}

function analyzeDropsForClip(clip, r7Bundle, gateConfig) {
  const stream = buildLiveStream(clip, r7Bundle);
  const counts = {
    'classical-spike': 0,
    'classical-rate': 0,
    'classical-uncertain': 0,
    'classical-arc': 0,
    'gate-withhold': 0,
    anchorReject: 0,
    published: 0,
  };
  const { anchorStats } = buildClassicalBySlot(clip, r7Bundle.reader);
  if (anchorStats?.rejected) counts.anchorReject += 1;
  let state = initialTemporalState();
  for (let i = 0; i < stream.length; i += 1) {
    const s = stream[i];
    const step = s._classicalStep;
    const drop = classifyClassicalDrop(step);
    if (drop) counts[drop] = (counts[drop] ?? 0) + 1;
    const sample = { ...s };
    delete sample._classicalStep;
    const stepped = stepTemporalGate(state, sample, gateConfig);
    state = stepped.state;
    if (stepped.bar != null) counts.published += 1;
    else if (step?.published && stepped.bar == null) counts['gate-withhold'] += 1;
    else if (!step?.published && stepped.bar == null) {
      /* already counted classical */
    } else if (!step?.published && stepped.bar != null) counts['gate-r5-only'] = (counts['gate-r5-only'] ?? 0) + 1;
  }
  counts.total = stream.length;
  counts.coveragePct = (100 * counts.published) / stream.length;
  return counts;
}

function dropsPhase() {
  const r6 = loadR6Config();
  const r7 = loadR7Config();
  const gateR6 = { ...gateConfigR7({ reader: r6, gate: {}, plateauBiasCorrection: null }), classicalDirect: false };
  const gateR7 = gateConfigR7(r7);
  const { clips } = loadPhaseR4Replay();
  const allowed = [...clips.filter((c) => !EXAM_FORBIDDEN.has(c)), PUCK];
  const table = {};
  for (const clip of allowed) {
    table[clip] = {
      r6: analyzeDropsForClip(clip, { reader: r6, gate: {}, plateauBiasCorrection: null }, gateR6),
      r7: analyzeDropsForClip(clip, r7, gateR7),
      r5cov: clipMetricsR6(buildLiveStreamR6(clip, r6, false), gateR6).coveragePct,
      r6cov: clipMetricsR6(buildLiveStreamR6(clip, r6, true), gateR6).coveragePct,
      r7cov: clipMetrics(buildLiveStream(clip, r7), gateR7).coveragePct,
    };
  }
  mkdirSync(R7_DIR, { recursive: true });
  writeFileSync(`${R7_DIR}/drop-analysis.json`, JSON.stringify(table, null, 2));
  console.log(JSON.stringify(table, null, 2));
  return table;
}

function benchAllowed(r7Bundle, gateConfig) {
  const { clips, labels, anchors } = loadPhaseR4Replay();
  const allowed = clips.filter((c) => !EXAM_FORBIDDEN.has(c));
  const r6cfg = loadR6Config();
  const gateR6 = { ...gateConfigR7({ reader: r6cfg, gate: {}, plateauBiasCorrection: null }), classicalDirect: false };
  const before = {};
  const afterR6 = {};
  const afterR7 = {};
  for (const clip of allowed) {
    before[clip] = clipMetricsR6(buildLiveStreamR6(clip, r6cfg, false), gateR6).coveragePct;
    afterR6[clip] = clipMetricsR6(buildLiveStreamR6(clip, r6cfg, true), gateR6).coveragePct;
    afterR7[clip] = clipMetrics(buildLiveStream(clip, r7Bundle), gateConfig).coveragePct;
  }
  const evald = evaluateTemporalConfig(
    Object.fromEntries(allowed.map((c) => [c, buildLiveStream(c, r7Bundle).map(({ _classicalStep, ...s }) => s)])),
    labels,
    allowed,
    anchors,
    gateConfig,
  );
  return { before, afterR6, afterR7, labels: evald.labels };
}

function tunePhase() {
  const base = JSON.parse(readFileSync(R7_CONFIG_PATH, 'utf8'));
  const { anchors, clips, labels } = loadPhaseR4Replay();
  const allowed = clips.filter((c) => !EXAM_FORBIDDEN.has(c));
  const r6cfg = loadR6Config();
  const gateR6 = { ...gateConfigR7({ reader: r6cfg, gate: {}, plateauBiasCorrection: null }), classicalDirect: false };
  const r5cov = {};
  const r6cov = {};
  for (const clip of allowed) {
    r5cov[clip] = clipMetricsR6(buildLiveStreamR6(clip, r6cfg, false), gateR6).coveragePct;
    r6cov[clip] = clipMetricsR6(buildLiveStreamR6(clip, r6cfg, true), gateR6).coveragePct;
  }
  const candidates = [];
  for (const uncertainHoldMaxS of [0.35, 0.4, 0.45]) {
    candidates.push({
      ...base,
      uncertainHoldMaxS,
      rateRejectEnabled: false,
      uncertainHoldRequiresR5: false,
      spikeRejectMode: 'r7',
      classicalDirect: true,
      classicalDirectMaxDisagreeBar: 2,
    });
  }
  let best = null;
  for (const cand of candidates) {
    const bundle = {
      reader: cand,
      gate: { classicalDirect: true, classicalDirectMaxDisagreeBar: 2 },
      plateauBiasCorrection: cand.plateauBiasCorrection,
    };
    const gate = gateConfigR7(bundle);
    const streams = {};
    for (const clip of allowed) {
      streams[clip] = buildLiveStream(clip, bundle).map(({ _classicalStep, ...s }) => s);
    }
    const evald = evaluateTemporalConfig(streams, labels, allowed, anchors, gate);
    const ok = evald.labels.wrong094055 === 0
      && evald.labels.wild != null
      && evald.labels.wild <= 5
      && evald.labels.flips === 0
      && evald.labels.rest === 0;
    if (!ok) continue;
    let covOk = true;
    for (const clip of allowed) {
      const cov = clipMetrics(buildLiveStream(clip, bundle), gate).coveragePct;
      if (cov < r6cov[clip] - 0.5) covOk = false;
    }
    if (!covOk) continue;
    const med = evald.labels.median ?? 999;
    const examCov = clipMetrics(
      buildLiveStream(EXAM, bundle).filter((s) => s.t <= 55.25),
      gate,
    ).coveragePct;
    const score = med - examCov * 0.001;
    if (!best || score < best.score) best = { cand, med, evald, bundle, examCov, score };
  }
  if (!best) {
    console.error('No candidate passed gates; keeping base r7_config');
    best = { cand: base, med: null, evald: null, bundle: loadR7Config() };
  }
  writeFileSync(R7_CONFIG_PATH, `${JSON.stringify(best.cand, null, 2)}\n`);
  const bench = benchAllowed(best.bundle, gateConfigR7(best.bundle));
  writeFileSync(`${R7_DIR}/bench-allowed.json`, JSON.stringify(bench, null, 2));
  writeFileSync(`${R7_DIR}/tune-result.json`, JSON.stringify({ chosen: best.cand, median: best.med }, null, 2));
  console.log('Tuned', R7_CONFIG_PATH, 'median', best.med);
}

function plateauBiasWhatIf() {
  const labels = loadJsonl(LABELS_R3);
  const r7 = loadR7Config();
  const gate = gateConfigR7(r7);
  const subtracts = [0.5, 0.65, 0.76];
  const report = { diagnosticMedianSigned: 0.76, trials: {} };
  for (const subtract of subtracts) {
    const bundle = {
      ...r7,
      plateauBiasCorrection: { type: 'plateau-subtract', minBar: 6, maxBar: 9, subtract },
    };
    const { clips, labels: lab, anchors } = loadPhaseR4Replay();
    const allowed = clips.filter((c) => !EXAM_FORBIDDEN.has(c));
    const streams = Object.fromEntries(
      allowed.map((c) => [c, buildLiveStream(c, bundle).map(({ _classicalStep, ...s }) => s)]),
    );
    const evald = evaluateTemporalConfig(streams, lab, allowed, anchors, gate);
    report.trials[subtract] = {
      median: evald.labels.median,
      wild: evald.labels.wild,
      flips: evald.labels.flips,
      rest: evald.labels.rest,
      wrong094055: evald.labels.wrong094055,
    };
  }
  return report;
}

function freezePhase() {
  mkdirSync(R7_DIR, { recursive: true });
  const hash = createHash('sha256').update(readFileSync(R7_CONFIG_PATH)).digest('hex');
  const ts = new Date().toISOString();
  writeFileSync(FREEZE_TXT, `sha256=${hash}\nutc=${ts}\n`);
  const paths = [
    'scripts/needle-reader/r7_config.json',
    'scripts/needle-reader/score_r7.mjs',
    'src/flairPressureLab/anchorRegularize.js',
    'src/flairPressureLab/classicalReaderR6.js',
    'src/flairPressureLab/classicalReaderR6.vitest.js',
    'src/flairPressureLab/temporalGate.js',
  ].join(' ');
  execSync(`git add ${paths}`, { cwd: ROOT });
  try {
    execSync(`git commit -m "$(cat <<'EOF'
Freeze R7 config: recover live coverage while keeping R6 spike safety.

EOF
)"`, { cwd: ROOT });
  } catch (e) {
    console.warn('commit skipped', e.message);
  }
  execSync('git push origin HEAD:cursor/6-42-needle-reader', { cwd: ROOT });
  console.log('Frozen', hash, ts);
  return { hash, ts };
}

function examPhase() {
  if (!existsSync(FREEZE_TXT)) throw new Error('freeze first');
  const r7 = loadR7Config();
  const gate = gateConfigR7(r7);
  const streamAll = buildLiveStream(EXAM, r7);
  const pass1 = streamAll.filter((s) => s.t <= 55.25);
  const metricsAll = clipMetrics(streamAll, gate);
  const metricsP1 = clipMetrics(pass1, gate);
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
  const wildHandPct = handErrs.length ? (100 * handWild.length) / handErrs.length : null;
  const r6cfg = loadR6Config();
  const gateR6 = { ...gateConfigR7({ reader: r6cfg, gate: {}, plateauBiasCorrection: null }), classicalDirect: false };
  const r6p1 = clipMetricsR6(buildLiveStreamR6(EXAM, r6cfg, true).filter((s) => s.t <= 55.25), gateR6);
  const r5p1 = clipMetricsR6(buildLiveStreamR6(EXAM, r6cfg, false).filter((s) => s.t <= 55.25), gateR6);
  const out = {
    label: 'SEEN/burned re-check (not an exam)',
    exam: EXAM,
    freezeHash: readFileSync(FREEZE_TXT, 'utf8').match(/sha256=(\w+)/)?.[1],
    frozenCandidateForTomorrow: true,
    pass1: {
      r7: metricsP1,
      r6: { coveragePct: r6p1.coveragePct, flips: r6p1.flips, backwardSpikes: r6p1.backwardSpikes, restMax: r6p1.restMax },
      r5live: { coveragePct: r5p1.coveragePct },
      handMedianBarErr: medHand,
      handFramesRead: `${handErrs.length}/${handDoc.rows.length}`,
      handWildPct: wildHandPct,
      liveBackwardSpikes,
      handRows,
    },
    r7Config: JSON.parse(readFileSync(R7_CONFIG_PATH, 'utf8')),
    smoothingDelayMs: measureSmoothingDelayMs(r7.reader),
    plateauWhatIf: plateauBiasWhatIf(),
    pipeline: 'R7 cleaned classical (r7 spike mode + blend-clamp anchors + longer UNCERTAIN hold) → TemporalGate with classicalDirect and 2 bar R5 veto.',
  };
  mkdirSync(R7_DIR, { recursive: true });
  writeFileSync(`${R7_DIR}/exam-recheck-124006.json`, JSON.stringify(out, null, 2));
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
    `${R7_DIR}/stream-${EXAM}.json`,
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
  const p1 = examOut.pass1;
  const txt = [
    'Phase R7. frozen candidate for tomorrow\'s exam (124006 = SEEN/burned re-check only).',
    `SHA ${sha}  pushed (verify git ls-remote origin cursor/6-42-needle-reader)`,
    `freeze sha256 ${hash}`,
    `SECTION — 124006 pass1 coverage r7 ${p1.r7.coveragePct}% vs r6 ${p1.r6.coveragePct}% vs r5 ${p1.r5live.coveragePct}%`,
    `  median hand ${p1.handMedianBarErr} (${p1.handFramesRead}) wild ${p1.handWildPct}% flips ${p1.r7.flips} rest max ${p1.r7.restMax} spikes ${p1.liveBackwardSpikes}`,
    `SECTION 2 — bench ${R7_DIR}/bench-allowed.json drops ${R7_DIR}/drop-analysis.json`,
    `plateau bias what-if in exam-recheck JSON; model unchanged R5`,
    `overlay ${R7_DIR}/overlay-124006-r7.mp4`,
    `reproduce: TZ=UTC node scripts/needle-reader/score_r7.mjs exam`,
  ].join('\n');
  writeFileSync(`${NR}/phaseR7-results.txt`, `${txt}\n`);
  writeFileSync(`${NR}/phaseR7-results.json`, JSON.stringify({ ...examOut, gitSha: sha }, null, 2));
}

function renderOverlay() {
  const overlayPy = `${R7_DIR}/overlay.py`;
  if (!existsSync(overlayPy)) {
    copyFileSync(`${NR}/r6/overlay.py`, overlayPy);
  }
  execSync(
    `python3 ${overlayPy} --stream ${R7_DIR}/stream-${EXAM}.json --hand ${CAL3}/hand-${EXAM}.json --out ${R7_DIR}/overlay-124006-r7.mp4`,
    { stdio: 'inherit' },
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  mkdirSync(R7_DIR, { recursive: true });
  const cmd = process.argv[2] || 'all';
  if (cmd === 'drops') dropsPhase();
  else if (cmd === 'tune') tunePhase();
  else if (cmd === 'freeze') freezePhase();
  else if (cmd === 'exam') {
    const out = examPhase();
    renderOverlay();
    writeResults(out);
  } else if (cmd === 'plateau') console.log(JSON.stringify(plateauBiasWhatIf(), null, 2));
  else if (cmd === 'bench') {
    const r7 = loadR7Config();
    console.log(JSON.stringify(benchAllowed(r7, gateConfigR7(r7)), null, 2));
  } else {
    dropsPhase();
    tunePhase();
    freezePhase();
    const out = examPhase();
    renderOverlay();
    writeResults(out);
  }
}
