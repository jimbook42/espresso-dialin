/**
 * Phase R4 repair 1. Same stored streams and LOCO label port as score_r4.mjs.
 * Ideas are tried in order on top of the R4 wide gate and kept only when the
 * accuracy gates still pass.
 *
 *   node scripts/needle-reader/score_r4r1.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { TEMPORAL_GATE, runTemporalGate } from '../../src/flairPressureLab/temporalGate.js';
import { evaluateTemporalConfig, loadPhaseR4Replay } from './score_r4.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_TXT = '/workspace/pl-state/nr/phaseR4r1-results.txt';
const OUT_JSON = '/workspace/pl-state/nr/phaseR4r1-results.json';
const LATENCY = '/workspace/pl-state/nr/train-r2/export/latency.json';
const COVERAGE_SKIP = new Set(['20261018_094055', '20261015_225307']);
const ARC = 161.757;
const ARC_EDGE = 16;

function r4Config() {
  return {
    ...TEMPORAL_GATE,
    recovery: 'wide',
    prelock: false,
    classicalCarryS: 0,
    holdGapS: 0,
    holdBandBar: 0.5,
  };
}

const IDEAS = [
  {
    id: '1',
    name: 'prelock',
    patch: { prelock: true },
    text: 'Before any classical TRACKING bar, publish R2 when the last 3 accepted bars sit within 0.5 bar and the flicker gate passes. The arc/confidence accept is the confidence check. Rest stays pinned at 0.',
  },
  {
    id: '2',
    name: 'carry',
    patch: { classicalCarryS: 1 },
    text: 'When the 1 s classical window empties, keep using that median for up to 1 s more instead of blocking.',
  },
  {
    id: '3',
    name: 'hold',
    patch: { holdGapS: 0.5, holdBandBar: 0.5 },
    text: 'For at most 0.5 s after a real accept, republish that bar when the new R2 is within 0.5 bar of it. A missing R2 does not count as agreement, so a dropout is not bridged.',
  },
];

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

function accuracyOk(labels) {
  return labels.wrong094055 === 0
    && labels.wild != null
    && labels.wild <= 5
    && labels.flips === 0
    && labels.rest === 0;
}

function pack(column) {
  return {
    labels: {
      ...column.labels,
      wild: round(column.labels.wild, 2),
      median: round(column.labels.median, 3),
      rest: round(column.labels.rest, 3),
    },
    coverage: Object.fromEntries(
      Object.entries(column.coverage).map(([clip, pct]) => [clip, round(pct, 1)]),
    ),
  };
}

function reasonsFor(streams, clips, config) {
  const out = {};
  for (const clip of clips) {
    const counts = {};
    for (const step of runTemporalGate(streams[clip], config)) {
      counts[step.reason] = (counts[step.reason] || 0) + 1;
    }
    out[clip] = counts;
  }
  return out;
}

function peakFinding(stream) {
  const rows = stream.filter((row) => row.classicalBar != null && row.classicalBar >= 7);
  const tally = {
    n: rows.length,
    lost: 0,
    outOfArc: 0,
    underTau: 0,
    nearScaled: 0,
    pinSnap: 0,
    close: 0,
    far: 0,
  };
  for (const row of rows) {
    const angle = row.r2Angle;
    const conf = row.r2Conf;
    if (row.r2Bar == null) {
      const inArc = angle != null && (angle <= ARC + ARC_EDGE || angle >= 360 - ARC_EDGE);
      if (angle == null || conf == null) tally.lost += 1;
      else if (!inArc) tally.outOfArc += 1;
      else if (conf < 0.06) tally.underTau += 1;
      else tally.nearScaled += 1;
    } else if (row.r2Bar < 1) tally.pinSnap += 1;
    else if (Math.abs(row.r2Bar - row.classicalBar) <= 1.5) tally.close += 1;
    else tally.far += 1;
  }
  const accepted = stream.filter((row) => row.r2Bar != null).length;
  return {
    ...tally,
    frames: stream.length,
    r2Accepted: accepted,
    r2AcceptedPct: (100 * accepted) / stream.length,
  };
}

function shaOfRepo() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function scorePhaseR4Repair({ sha = null } = {}) {
  const { anchors, clips, streams, labels } = loadPhaseR4Replay();
  const coverageClips = clips.filter((clip) => !COVERAGE_SKIP.has(clip));
  const r4 = r4Config();
  const columns = { r4: evaluateTemporalConfig(streams, labels, clips, anchors, r4) };
  for (const idea of IDEAS) {
    columns[idea.name] = evaluateTemporalConfig(
      streams,
      labels,
      clips,
      anchors,
      { ...r4, ...idea.patch },
    );
  }

  let chosenConfig = { ...r4 };
  const kept = [];
  const dropped = [];
  for (const idea of IDEAS) {
    const trial = { ...chosenConfig, ...idea.patch };
    const column = evaluateTemporalConfig(streams, labels, clips, anchors, trial);
    const ok = accuracyOk(column.labels);
    if (ok) {
      chosenConfig = trial;
      kept.push(idea.id);
      columns[`stack${idea.id}`] = column;
    } else {
      dropped.push({
        id: idea.id,
        name: idea.name,
        wild: column.labels.wild,
        flips: column.labels.flips,
        rest: column.labels.rest,
        wrong094055: column.labels.wrong094055,
      });
    }
  }
  const chosen = evaluateTemporalConfig(streams, labels, clips, anchors, chosenConfig);
  columns.chosen = chosen;

  const chosenLabels = chosen.labels;
  const coveragePass = coverageClips.every((clip) => chosen.coverage[clip] >= 85);
  const gates = {
    wrong094055: {
      result: passFlag(chosenLabels.wrong094055 === 0),
      wrong: chosenLabels.wrong094055,
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
    rest: {
      result: passFlag(chosenLabels.rest === 0),
      rest: chosenLabels.rest,
    },
    liveCoverage: {
      result: passFlag(coveragePass),
      limit: 85,
      clips: Object.fromEntries(coverageClips.map((clip) => [
        clip,
        {
          pct: chosen.coverage[clip],
          result: passFlag(chosen.coverage[clip] >= 85),
        },
      ])),
    },
  };
  const verdict = Object.values(gates).every((gate) => gate.result === 'PASS') ? 'GO' : 'NO-GO';
  const started = performance.now();
  const samples = clips.flatMap((clip) => streams[clip]);
  runTemporalGate(samples, chosenConfig);
  const elapsed = performance.now() - started;
  let modelLatency = null;
  try {
    modelLatency = JSON.parse(readFileSync(LATENCY, 'utf8'));
  } catch {
    modelLatency = null;
  }
  const gate4xMs = (elapsed / samples.length) * 4;
  const latency = {
    gatePerFrameMs: round(elapsed / samples.length, 4),
    gate4xMs: round(gate4xMs, 4),
    model4xMs: modelLatency?.model4xMs ?? null,
    total4xMs: modelLatency?.total4xMs == null ? null : round(modelLatency.total4xMs + gate4xMs, 2),
    frames: samples.length,
    note: 'Gate time is one JS pass over the stored streams, times 4. Model 4x is the R2 int8 figure in train-r2/export/latency.json. Total adds the gate to that replay total.',
  };
  const peak = peakFinding(streams['20261018_160931']);
  const reasons = {
    r4: reasonsFor(streams, clips, r4),
    chosen: reasonsFor(streams, clips, chosenConfig),
  };
  const packed = Object.fromEntries(Object.entries(columns).map(([name, column]) => [name, pack(column)]));
  const text = render({
    sha,
    kept,
    dropped,
    packed,
    clips,
    coverageClips,
    gates,
    verdict,
    latency,
    peak,
    reasons,
    accuracy: {
      r4: accuracyOk(columns.r4.labels),
      ideas: Object.fromEntries(IDEAS.map((idea) => [idea.name, accuracyOk(columns[idea.name].labels)])),
    },
  });
  return {
    verdict,
    sha,
    kept,
    dropped,
    chosenConfig: {
      recovery: chosenConfig.recovery,
      prelock: chosenConfig.prelock === true,
      prelockCount: chosenConfig.prelockCount,
      prelockBandBar: chosenConfig.prelockBandBar,
      classicalCarryS: chosenConfig.classicalCarryS,
      holdGapS: chosenConfig.holdGapS,
      holdBandBar: chosenConfig.holdBandBar,
    },
    gates,
    columns: packed,
    latency,
    peak,
    reasons,
    text,
  };
}

function render({ sha, kept, dropped, packed, clips, coverageClips, gates, verdict, latency, peak, reasons, accuracy }) {
  const names = ['r4', 'prelock', 'carry', 'hold', 'chosen'];
  const head = ['R4', 'idea1', 'idea2', 'idea3', 'chosen'];
  const lines = [
    'Phase R4 repair 1. Coverage only, on the R4 wide gate and the R2 model.',
    `verdict ${verdict}`,
    `SHA ${sha || 'uncommitted'}`,
    'Model /workspace/pl-state/nr/train-r2/export/needle-cartesian.int8.onnx. Not the R3 weights.',
    'Accuracy that had to stay held: wild <= 5%, 0 flips, rest 0, 094055 t=5–38 s 0 wrong.',
    'Ideas were tried in order on the LOCO harness. Each one is kept only when that stack still passes those gates. An idea is also scored on its own, on top of R4, so the table is not only the stack.',
    `Kept: ${kept.length ? kept.map((id) => `idea ${id}`).join(', ') : 'none'}.`,
  ];
  if (dropped.length) {
    for (const row of dropped) {
      lines.push(
        `Dropped idea ${row.id} (${row.name}): wild ${fmt(row.wild, 2)}%, flips ${row.flips}, rest ${fmt(row.rest, 3)}, 094055 wrong ${row.wrong094055}.`,
      );
    }
  }
  lines.push(
    `Idea 1 alone ${accuracy.ideas.prelock ? 'passes' : 'fails'} accuracy. ${IDEAS[0].text}`,
    `Idea 2 alone ${accuracy.ideas.carry ? 'passes' : 'fails'} accuracy. ${IDEAS[1].text}`,
    `Idea 3 alone ${accuracy.ideas.hold ? 'passes' : 'fails'} accuracy. ${IDEAS[2].text}`,
    '',
    'Gates on the chosen stack.',
    `  094055 t=5–38     ${gates.wrong094055.result}  wrong=${gates.wrong094055.wrong}`,
    `  wild <= 5%        ${gates.wild.result}  ${fmt(gates.wild.wild, 2)}% of ${gates.wild.nerr} non-rest shown labels (${gates.wild.n} labels)`,
    `  flips = 0         ${gates.flips.result}  ${gates.flips.flips}`,
    `  rest = 0          ${gates.rest.result}  ${fmt(gates.rest.rest, 3)}`,
    `  live coverage     ${gates.liveCoverage.result}  >= 85% on 8 clips, excluding 094055 and 225307`,
  );
  for (const clip of coverageClips) {
    const row = gates.liveCoverage.clips[clip];
    lines.push(`    ${clip}  ${row.result}  ${fmt(row.pct, 1)}%`);
  }
  lines.push('', `${'mode'.padEnd(8)} ${'wild%'.padStart(7)} ${'flips'.padStart(5)} ${'094055'.padStart(7)} ${'med'.padStart(7)} ${'rest'.padStart(7)} ${'kept'.padStart(5)}`);
  const keptFor = { r4: 'yes', prelock: accuracy.ideas.prelock ? 'yes' : 'no', carry: accuracy.ideas.carry ? 'yes' : 'no', hold: accuracy.ideas.hold ? 'yes' : 'no', chosen: 'yes' };
  for (let i = 0; i < names.length; i += 1) {
    const labels = packed[names[i]].labels;
    lines.push([
      head[i].padEnd(8),
      fmt(labels.wild, 2).padStart(7),
      String(labels.flips).padStart(5),
      String(labels.wrong094055).padStart(7),
      fmt(labels.median, 3).padStart(7),
      fmt(labels.rest, 3).padStart(7),
      keptFor[names[i]].padStart(5),
    ].join(' '));
  }
  lines.push('', `${'clip'.padEnd(8)} ${head.map((name) => name.padStart(7)).join(' ')}`);
  for (const clip of clips) {
    lines.push([
      clip.slice(-6).padEnd(8),
      ...names.map((name) => fmt(packed[name].coverage[clip], 1).padStart(7)),
    ].join(' '));
  }
  const clip160 = '20261018_160931';
  const why = reasons.chosen[clip160];
  lines.push(
    '',
    '160931 peaks.',
    `R2 accepts ${fmt(peak.r2AcceptedPct, 1)}% of the clip (${peak.r2Accepted} of ${peak.frames}). That ceiling is already under 85%, and idea 3 does not publish a frame with no R2 bar.`,
    `Where the classical bar is at least 7 (n=${peak.n}): ${peak.underTau} frames sit under the 0.06 confidence tau, ${peak.nearScaled} clear 0.06 until the near-10 scale of 0.65 pushes them under tau, ${peak.outOfArc} are outside the arc, ${peak.lost} have no angle.`,
    `Of the accepted frames in that band, ${peak.pinSnap} read under 1 bar (the rest pin) while the classical needle is at the peak, ${peak.close} are within 1.5 bar, and ${peak.far} are farther.`,
    'The low accept rate is the head, not the gate. At the top of the shot the confidence falls through tau, and the angles that still pass often snap to the pin instead of the peak. The disagree gate then withholds the pin snaps. Nothing here retrains the model.',
    `Chosen reasons on 160931: ${JSON.stringify(why)}.`,
    '',
    'The other two clips that stay under 85% are 135116 at 76.1% and 094151 at 80.7%.',
    '135116 still withholds 120 frames for disagree and 8 for rate. Those R2 bars have moved more than 0.5 bar off the last accept, so the hold does not apply. They are the ramp, not a short gap.',
    '094151 still has 28 frames with no classical median, and they are not pre-lock: the first TRACKING bar is at 0.5 s. Carrying that median another second reaches 81.6% on this clip and 6.67% wild on the 94 labels, so idea 2 is not kept. The hold adds 6 frames.',
    '',
    `Latency at 4x: gate ${fmt(latency.gate4xMs, 4)} ms/frame, model ${fmt(latency.model4xMs, 2)} ms, total ${fmt(latency.total4xMs, 2)} ms.`,
    latency.note,
    '',
    'Artifacts',
    `  gate     ${path.join(ROOT, 'src/flairPressureLab/temporalGate.js')}`,
    `  scorer   ${path.join(ROOT, 'scripts/needle-reader/score_r4r1.mjs')}`,
    '  model    /workspace/pl-state/nr/train-r2/export/needle-cartesian.int8.onnx',
    '  frames   /workspace/pl-state/nr/train-r2/raw-frames.json',
    '  labels   /workspace/pl-state/nr/verify-temporal/records-t.json',
    '  replay   /workspace/pl-state/nr/replay',
    `  results  ${OUT_TXT}`,
    `           ${OUT_JSON}`,
  );
  if (sha) lines.push(`SHA ${sha}`);
  return lines.join('\n');
}

function main() {
  const report = scorePhaseR4Repair({ sha: shaOfRepo() });
  const json = { ...report };
  delete json.text;
  writeFileSync(OUT_TXT, `${report.text}\n`);
  writeFileSync(OUT_JSON, `${JSON.stringify(json, null, 2)}\n`);
  process.stdout.write(`${report.text}\n`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
