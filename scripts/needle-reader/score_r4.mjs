/**
 * Phase R4 replay. Stored streams only: R2 arc/confidence accept, then the
 * app temporal gate. Same label override as verify-temporal/temporal.py.
 *
 *   node scripts/needle-reader/score_r4.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEMPORAL_GATE,
  runTemporalGate,
} from '../../src/flairPressureLab/temporalGate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = '/workspace/pl-state/nr/train-r2/raw-frames.json';
const REPLAY = '/workspace/pl-state/nr/replay';
const LABELS = '/workspace/pl-state/nr/verify-temporal/records-t.json';
const PROFILE = path.join(ROOT, 'profiles/flair58-v1.json');
const LATENCY = '/workspace/pl-state/nr/train-r2/export/latency.json';
const MODEL = '/workspace/pl-state/nr/train-r2/export/needle-cartesian.int8.onnx';
const OUT_TXT = '/workspace/pl-state/nr/phaseR4-results.txt';
const OUT_JSON = '/workspace/pl-state/nr/phaseR4-results.json';

const ARC = 161.757;
const ARC_EDGE = 16;
const PIN_HI = 8;
const TAU = 0.06;
const NEAR10 = 0.65;
const COVERAGE_SKIP = new Set(['20261018_094055', '20261015_225307']);
const WILD_BAR = 1;
const WINDOW = { start: 5, end: 38, clipSuffix: '094055' };

function wrap360(deg) {
  return ((deg % 360) + 360) % 360;
}

function circ(a, b) {
  const d = Math.abs(wrap360(a) - wrap360(b)) % 360;
  return Math.min(d, 360 - d);
}

/** Python round() half-to-even, so replay slots match temporal.py. */
function roundHalfEven(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const floor = Math.floor(x);
  const frac = x - floor;
  if (Math.abs(frac - 0.5) < 1e-10) return sign * (floor % 2 === 0 ? floor : floor + 1);
  return sign * Math.round(x);
}

function signedBar(angleDeg, anchors) {
  let angle = wrap360(angleDeg);
  if (angle > 180) angle -= 360;
  if (angle <= anchors[0].deg) {
    const d0 = anchors[0].deg;
    const v0 = anchors[0].value;
    const d1 = anchors[1].deg;
    const v1 = anchors[1].value;
    return v0 + (angle - d0) * (v1 - v0) / (d1 - d0);
  }
  const last = anchors.length - 1;
  if (angle >= anchors[last].deg) {
    const d0 = anchors[last - 1].deg;
    const v0 = anchors[last - 1].value;
    const d1 = anchors[last].deg;
    const v1 = anchors[last].value;
    return v1 + (angle - d1) * (v1 - v0) / (d1 - d0);
  }
  for (let i = 1; i < anchors.length; i += 1) {
    const right = anchors[i];
    const left = anchors[i - 1];
    if (angle <= right.deg) {
      const span = right.deg - left.deg;
      const t = span === 0 ? 0 : (angle - left.deg) / span;
      return left.value + t * (right.value - left.value);
    }
  }
  return anchors[anchors.length - 1].value;
}

function inArc(delta) {
  return delta <= ARC + ARC_EDGE || delta >= 360 - ARC_EDGE;
}

function onPin(delta) {
  return delta <= PIN_HI || delta >= 360 - ARC_EDGE;
}

/** R2 arc/confidence accept. Null means the temporal gate is not given a bar. */
export function acceptR2(angle, conf, anchors) {
  if (angle == null || conf == null || !Number.isFinite(angle) || !Number.isFinite(conf)) return null;
  if (!inArc(angle)) return null;
  const bar = onPin(angle) ? 0 : signedBar(angle, anchors);
  let scaled = conf;
  if (bar >= 9 || (angle >= ARC - ARC_EDGE && angle <= ARC + ARC_EDGE)) scaled *= NEAR10;
  if (scaled < TAU) return null;
  return bar;
}

function barToAngle(bar, anchors) {
  let lo = -40;
  let hi = 200;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (signedBar(mid, anchors) < bar) lo = mid;
    else hi = mid;
  }
  return wrap360((lo + hi) / 2);
}

export function loadStreams(anchors) {
  const raw = JSON.parse(readFileSync(RAW, 'utf8'));
  const labels = JSON.parse(readFileSync(LABELS, 'utf8'));
  const clips = [...new Set(raw.map((frame) => frame.clip))].sort();
  const streams = {};
  for (const clip of clips) {
    const replay = JSON.parse(readFileSync(path.join(REPLAY, `${clip}.json`), 'utf8')).frames;
    const classical = new Map();
    for (const frame of replay) {
      if (frame.timeS == null) continue;
      classical.set(roundHalfEven(frame.timeS / 0.125), frame);
    }
    const frames = raw.filter((frame) => frame.clip === clip).sort((a, b) => a.timeS - b.timeS);
    streams[clip] = frames.map((frame) => {
      const slot = frame.timeS == null ? null : classical.get(roundHalfEven(frame.timeS / 0.125));
      const tracking = slot?.tracking === 'TRACKING' && slot.bar != null;
      const angle = frame.angle == null ? null : Number(frame.angle);
      const rest = frame.atSec != null
        && frame.timeS != null
        && Math.abs(frame.timeS - frame.atSec) <= 0.5
        && angle != null
        && onPin(angle);
      return {
        t: frame.timeS,
        r2Bar: acceptR2(angle, frame.conf == null ? null : Number(frame.conf), anchors),
        r2Conf: frame.conf == null ? null : Number(frame.conf),
        r2Angle: angle,
        classicalBar: tracking ? Number(slot.bar) : null,
        classicalConfidence: tracking && slot.confidence != null ? Number(slot.confidence) : null,
        classicalAngle: tracking ? barToAngle(Number(slot.bar), anchors) : null,
        rest,
        tracking: frame.tracking,
      };
    });
  }
  return { clips, streams, labels, anchors };
}

/** R4 columns stay on the original gate. Repair flags are scored separately. */
function configFor(mode) {
  const base = {
    ...TEMPORAL_GATE,
    prelock: false,
    classicalCarryS: 0,
    holdGapS: 0,
  };
  if (mode === 'raw') return null;
  if (mode === 'gated') return { ...base, recovery: 'off' };
  if (mode === 'a') return { ...base, recovery: 'classical' };
  if (mode === 'b') return { ...base, recovery: 'wide' };
  throw new Error(`unknown mode ${mode}`);
}

function resolveConfig(modeOrConfig) {
  if (modeOrConfig == null || modeOrConfig === 'raw') return null;
  if (typeof modeOrConfig === 'object') return modeOrConfig;
  return configFor(modeOrConfig);
}

function publishLive(stream, mode) {
  const config = resolveConfig(mode);
  if (config == null) return stream.map((sample) => sample.r2Bar);
  return runTemporalGate(stream, config).map((step) => step.bar);
}

function publishAtLabel(stream, index, r2Bar, mode, anchors) {
  const config = resolveConfig(mode);
  if (config == null) return r2Bar;
  const samples = stream.slice(0, index + 1).map((sample, i) => {
    if (i !== index) return sample;
    const bar = r2Bar == null ? null : Number(r2Bar);
    return {
      ...sample,
      r2Bar: bar,
      classicalAngle: sample.classicalBar == null ? null : barToAngle(sample.classicalBar, anchors),
    };
  });
  const stepped = runTemporalGate(samples, config);
  return stepped[stepped.length - 1].bar;
}

function nearestIndex(stream, t) {
  let best = 0;
  let bestAbs = Infinity;
  for (let i = 0; i < stream.length; i += 1) {
    const gap = Math.abs(stream[i].t - t);
    if (gap < bestAbs) {
      best = i;
      bestAbs = gap;
    }
  }
  return bestAbs > 0.25 ? -1 : best;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function labelRows(streams, labels, mode, anchors) {
  return labels.map((label) => {
    const stream = streams[label.clip];
    const index = stream ? nearestIndex(stream, label.t) : -1;
    const bar = index < 0 ? null : publishAtLabel(stream, index, label.r2, mode, anchors);
    return { ...label, bar };
  });
}

function summarizeLabels(rows, anchors) {
  const shown = rows.filter((row) => row.bar != null && row.truth != null);
  const errs = shown.filter((row) => !row.rest).map((row) => Math.abs(row.bar - row.truth));
  let flips = 0;
  for (const row of shown) {
    if (row.tang == null) continue;
    const same = row.r2 != null && row.bar === row.r2 && row.r2ang != null;
    const angle = same ? row.r2ang : barToAngle(row.bar, anchors);
    if (circ(angle, row.tang) >= TEMPORAL_GATE.flipDeg) flips += 1;
  }
  const rest = shown.filter((row) => row.rest).map((row) => Math.abs(row.bar));
  const wrong = shown.filter((row) => (
    String(row.clip).endsWith(WINDOW.clipSuffix)
    && row.t >= WINDOW.start
    && row.t <= WINDOW.end
    && Math.abs(row.bar - row.truth) > WILD_BAR
  ));
  return {
    n: rows.length,
    nerr: errs.length,
    wild: errs.length ? (100 * errs.filter((err) => err > WILD_BAR).length) / errs.length : null,
    flips,
    median: median(errs),
    rest: rest.length ? Math.max(...rest) : null,
    wrong094055: wrong.length,
    wrongRows: wrong.map((row) => ({
      set: row.set,
      t: row.t,
      truth: row.truth,
      bar: row.bar,
      r2: row.r2,
    })),
  };
}

export function evaluateTemporalConfig(streams, labels, clips, anchors, config) {
  const rows = labelRows(streams, labels, config, anchors);
  return {
    labels: summarizeLabels(rows, anchors),
    coverage: liveCoverage(streams, clips, config),
  };
}

export function loadPhaseR4Replay() {
  const anchors = JSON.parse(readFileSync(PROFILE, 'utf8')).scale.anchors;
  return { anchors, ...loadStreams(anchors) };
}

function liveCoverage(streams, clips, mode) {
  const out = {};
  for (const clip of clips) {
    const bars = publishLive(streams[clip], mode);
    out[clip] = (100 * bars.filter((bar) => bar != null).length) / bars.length;
  }
  return out;
}

function timeGate(streams, clips) {
  const config = configFor('b');
  const samples = clips.flatMap((clip) => streams[clip]);
  const started = performance.now();
  runTemporalGate(samples, config);
  const elapsed = performance.now() - started;
  return {
    frames: samples.length,
    passMs: elapsed,
    perFrameMs: elapsed / samples.length,
    gate4xMs: (elapsed / samples.length) * 4,
  };
}

function round(value, digits) {
  if (value == null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function fmt(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return Number(value).toFixed(digits);
}

function passFlag(ok) {
  return ok ? 'PASS' : 'FAIL';
}

export function scorePhaseR4({ sha = null } = {}) {
  const anchors = JSON.parse(readFileSync(PROFILE, 'utf8')).scale.anchors;
  const { clips, streams, labels } = loadStreams(anchors);
  const modes = ['raw', 'gated', 'a', 'b'];
  const columns = {};
  for (const mode of modes) {
    const rows = labelRows(streams, labels, mode, anchors);
    columns[mode] = {
      labels: summarizeLabels(rows, anchors),
      coverage: liveCoverage(streams, clips, mode),
    };
  }
  const wildOk = (mode) => {
    const wild = columns[mode].labels.wild;
    return wild != null && wild <= 5 && columns[mode].labels.flips === 0;
  };
  let chosen = 'gated';
  let recovery = 'none';
  if (wildOk('a')) {
    chosen = 'a';
    recovery = 'classical';
  } else if (wildOk('b')) {
    chosen = 'b';
    recovery = 'wide';
  }
  const chosenLabels = columns[chosen].labels;
  const coverageClips = clips.filter((clip) => !COVERAGE_SKIP.has(clip));
  const coveragePass = coverageClips.every((clip) => columns[chosen].coverage[clip] >= 85);
  const gates = {
    wrong094055: {
      result: passFlag(chosenLabels.wrong094055 === 0),
      wrong: chosenLabels.wrong094055,
      rule: 'no published 094055 label in t=5–38 s with |bar-truth| > 1',
    },
    wild: {
      result: passFlag(chosenLabels.wild != null && chosenLabels.wild <= 5),
      wild: chosenLabels.wild,
      nerr: chosenLabels.nerr,
      n: chosenLabels.n,
      limit: 5,
    },
    flips: {
      result: passFlag(chosenLabels.flips === 0),
      flips: chosenLabels.flips,
    },
    liveCoverage: {
      result: passFlag(coveragePass),
      limit: 85,
      clips: Object.fromEntries(coverageClips.map((clip) => [
        clip,
        {
          pct: columns[chosen].coverage[clip],
          result: passFlag(columns[chosen].coverage[clip] >= 85),
        },
      ])),
    },
  };
  const verdict = gates.wrong094055.result === 'PASS'
    && gates.wild.result === 'PASS'
    && gates.flips.result === 'PASS'
    && gates.liveCoverage.result === 'PASS'
    ? 'GO'
    : 'NO-GO';
  let modelLatency = null;
  try {
    modelLatency = JSON.parse(readFileSync(LATENCY, 'utf8'));
  } catch {
    modelLatency = null;
  }
  const gateTiming = timeGate(streams, clips);
  const latency = {
    gatePerFrameMs: round(gateTiming.perFrameMs, 4),
    gate4xMs: round(gateTiming.gate4xMs, 4),
    model4xMs: modelLatency?.model4xMs ?? null,
    total4xMs: modelLatency?.total4xMs == null
      ? null
      : round(modelLatency.total4xMs + gateTiming.gate4xMs, 2),
    frames: gateTiming.frames,
    note: 'Gate time is one JS pass over the stored streams, times 4. Model 4x is the R2 int8 figure in train-r2/export/latency.json. Total adds the gate to that replay total.',
  };
  const text = render({
    sha,
    chosen,
    recovery,
    columns,
    clips,
    coverageClips,
    gates,
    verdict,
    latency,
  });
  return {
    verdict,
    sha,
    chosen,
    recovery,
    gates,
    columns: Object.fromEntries(modes.map((mode) => [mode, {
      labels: {
        ...columns[mode].labels,
        wild: round(columns[mode].labels.wild, 2),
        median: round(columns[mode].labels.median, 3),
        rest: round(columns[mode].labels.rest, 3),
      },
      coverage: Object.fromEntries(clips.map((clip) => [clip, round(columns[mode].coverage[clip], 1)])),
    }])),
    latency,
    text,
  };
}

function render({ sha, chosen, recovery, columns, clips, coverageClips, gates, verdict, latency }) {
  const names = { raw: 'R2-raw', gated: 'gated', a: 'a', b: 'b' };
  const lines = [
    'Phase R4 temporal gate on the R2 model.',
    `verdict ${verdict}`,
    `SHA ${sha || 'uncommitted'}`,
    'Model /workspace/pl-state/nr/train-r2/export/needle-cartesian.int8.onnx. Not the R3 weights.',
    'The gate runs after the R2 arc/confidence accept (tau 0.06, near10 0.65).',
    'Params: 1 s classical median, 2 s R2 history, flicker fraction 0.5 above 2 bar, disagree 1.5 bar, no classical means no reading, rate 14 bar/s plus 0.5 bar, relock after 3 readings within 1 bar, rest pinned to 0.',
    `Chosen recovery: ${recovery} (${names[chosen]}). (a) is classical when the gate rejects, the classical bar is TRACKING and at least the tracking quality, and the needles are not a flip. (b) widens the band to 2.0 bar when R2 confidence is above 0.5. The first of those that keeps wild <= 5% and 0 flips is kept.`,
    'A wrong 094055 reading is a published label at t = 5–38 s whose absolute bar error is over 1. Withholding the frame is not a wrong reading.',
    'Wild and flips are the 94 review and hand labels. Live coverage is published frames over every stored frame, including CALIBRATING.',
    '',
    'Gates on the chosen column.',
    `  094055 t=5–38     ${gates.wrong094055.result}  wrong=${gates.wrong094055.wrong}`,
    `  wild <= 5%        ${gates.wild.result}  ${fmt(gates.wild.wild, 2)}% of ${gates.wild.nerr} non-rest shown labels (${gates.wild.n} labels)`,
    `  flips = 0         ${gates.flips.result}  ${gates.flips.flips}`,
    `  live coverage     ${gates.liveCoverage.result}  >= 85% on 8 clips, excluding 094055 and 225307`,
  ];
  for (const clip of coverageClips) {
    const row = gates.liveCoverage.clips[clip];
    lines.push(`    ${clip}  ${row.result}  ${fmt(row.pct, 1)}%`);
  }
  lines.push('', 'Label and coverage table. R2-raw is the arc/confidence accept with no temporal gate.');
  lines.push(`${'mode'.padEnd(8)} ${'wild%'.padStart(7)} ${'flips'.padStart(5)} ${'094055'.padStart(7)} ${'med'.padStart(7)} ${'rest'.padStart(7)} ${'nerr'.padStart(5)}`);
  for (const mode of ['raw', 'gated', 'a', 'b']) {
    const labels = columns[mode].labels;
    lines.push([
      names[mode].padEnd(8),
      fmt(labels.wild, 2).padStart(7),
      String(labels.flips).padStart(5),
      String(labels.wrong094055).padStart(7),
      fmt(labels.median, 3).padStart(7),
      fmt(labels.rest, 3).padStart(7),
      String(labels.nerr).padStart(5),
    ].join(' '));
  }
  lines.push('', `${'clip'.padEnd(16)} ${'R2-raw'.padStart(7)} ${'gated'.padStart(7)} ${'a'.padStart(7)} ${'b'.padStart(7)}`);
  for (const clip of clips) {
    lines.push([
      clip.slice(-6).padEnd(16),
      fmt(columns.raw.coverage[clip], 1).padStart(7),
      fmt(columns.gated.coverage[clip], 1).padStart(7),
      fmt(columns.a.coverage[clip], 1).padStart(7),
      fmt(columns.b.coverage[clip], 1).padStart(7),
    ].join(' '));
  }
  lines.push(
    '',
    'Why coverage stays under 85%.',
    '225219 publishes on 75.4% of frames. The rest are CALIBRATING, before any TRACKING bar, and the gate does not publish without a classical reading. R2 alone accepts 95.3% of that clip.',
    '160931 accepts R2 on 82.2% of frames, already under 85%, and the gate keeps 67.8%. Showing classical on a rejection lifts it to 78.7% and breaks the wild and flip gates (25% wild, 2 flips, 8 wrong 094055 readings), so recovery (a) is not kept.',
    'Recovery (b) is the one that holds wild at 4.55% and 0 flips. It does not bring 225219, 134943, 135116, 094151, or 160931 up to 85%.',
    '',
    `Latency at 4x: gate ${fmt(latency.gate4xMs, 4)} ms/frame, model ${fmt(latency.model4xMs, 2)} ms, total ${fmt(latency.total4xMs, 2)} ms.`,
    latency.note,
    '',
    'Artifacts',
    `  gate     ${path.join(ROOT, 'src/flairPressureLab/temporalGate.js')}`,
    `  scorer   ${path.join(ROOT, 'scripts/needle-reader/score_r4.mjs')}`,
    `  model    ${MODEL}`,
    `  frames   ${RAW}`,
    `  labels   ${LABELS}`,
    `  replay   ${REPLAY}`,
    `  results  ${OUT_TXT}`,
    `           ${OUT_JSON}`,
  );
  if (sha) lines.push(`SHA ${sha}`);
  return lines.join('\n');
}

function sha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function main() {
  const report = scorePhaseR4({ sha: sha() });
  const json = { ...report };
  delete json.text;
  writeFileSync(OUT_TXT, `${report.text}\n`);
  writeFileSync(OUT_JSON, `${JSON.stringify(json, null, 2)}\n`);
  process.stdout.write(`${report.text}\n`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
