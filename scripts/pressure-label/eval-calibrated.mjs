/**
 * Tap-calibrated tracker vs hand labels. Replay space 1280x720.
 * Frames stay under /workspace/pl-state. Nothing is uploaded.
 *
 * Each clip is calibrated on its rest frame (rest, used_1, or dry_1) from
 * Isaac's hub / 5 / 10 taps jittered by 15–25px. Later labelled frames are
 * tracked from that pose. Ground truth 0 is the rest needle (pin plus the
 * leave-one-clip-out pin→needle offset). The scale is that 0 to the labelled 10.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  barFromRestSpan,
  calibrateFromTaps,
  createCalibratedTracker,
  readCalibratedFrame,
} from '../../src/flairPressureLab/tapCalibrate.js';
import { wrap360 } from '../../src/flairPressureLab/gaugeConfig.js';

const REPLAY_W = 1280;
const REPLAY_H = 720;
const LABELS_PATH = '/workspace/pl-state/labels.json';
const MANIFEST_PATH = '/workspace/pl-state/label-frames/manifest.json';
const FRAMES_DIR = '/workspace/pl-state/label-frames';
const OUT_BASE = '/workspace/pl-state/eval-6.41';
const OVERLAY_DIR = '/workspace/pl-state/diag/641';
const REPAIR_OVERLAY_DIR = '/workspace/pl-state/diag/641r1';
const REST_PHASES = new Set(['rest', 'dry_1', 'used_1']);
const SEEDS = [1, 2, 3, 4, 5];

function decodeJpeg(file) {
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(`ffprobe ${file}`);
  const [w, h] = probe.stdout.trim().split(',').map((n) => Number(n));
  const raw = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-noautorotate',
    '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  if (raw.status !== 0 || raw.stdout.length !== w * h * 4) {
    throw new Error(`decode ${file} got ${raw.stdout?.length || 0} bytes`);
  }
  return {
    width: w,
    height: h,
    data: new Uint8ClampedArray(raw.stdout.buffer, raw.stdout.byteOffset, raw.stdout.byteLength),
  };
}

function scaleToReplay(image) {
  if (image.width === REPLAY_W && image.height === REPLAY_H) return { image, sx: 1, sy: 1 };
  const scaled = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${image.width}x${image.height}`, '-i', '-',
    '-vf', `scale=${REPLAY_W}:${REPLAY_H}`,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
  ], {
    input: Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength),
    maxBuffer: 16 * 1024 * 1024,
  });
  const expect = REPLAY_W * REPLAY_H * 4;
  if (scaled.status !== 0 || scaled.stdout.length !== expect) throw new Error('scale failed');
  return {
    image: {
      width: REPLAY_W,
      height: REPLAY_H,
      data: new Uint8ClampedArray(scaled.stdout.buffer, scaled.stdout.byteOffset, scaled.stdout.byteLength),
    },
    sx: REPLAY_W / image.width,
    sy: REPLAY_H / image.height,
  };
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jitterPoint(point, rng, lo = 15, hi = 25) {
  const dist = lo + rng() * (hi - lo);
  const angle = rng() * Math.PI * 2;
  return { x: point.x + dist * Math.cos(angle), y: point.y + dist * Math.sin(angle) };
}

function imageAngle(from, to) {
  return wrap360((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
}

function clockwise(fromDeg, toDeg) {
  return wrap360(toDeg - fromDeg);
}

function medianOf(values) {
  const sorted = values.filter((value) => value != null && !Number.isNaN(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function quantile(values, p) {
  const sorted = values.filter((value) => value != null && !Number.isNaN(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - index) + sorted[hi] * (index - lo);
}

function round(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function truthBar(needleDeg, zeroDeg, tenDeg) {
  const span = clockwise(zeroDeg, tenDeg);
  if (!(span > 40) || span > 280) return null;
  let delta = clockwise(zeroDeg, needleDeg);
  if (delta > 300) delta -= 360;
  if (delta < -18 || delta > span + 18) return null;
  return Math.max(-0.6, Math.min(10.6, (delta / span) * 10));
}

const labels = JSON.parse(readFileSync(LABELS_PATH, 'utf8')).frames;
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

const frames = [];
for (const entry of manifest) {
  const mark = labels[entry.id];
  if (!mark) continue;
  const scaled = scaleToReplay(decodeJpeg(`${FRAMES_DIR}/${entry.file}`));
  const sx = scaled.sx;
  const sy = scaled.sy;
  const hub = { x: mark.hub[0] * sx, y: mark.hub[1] * sy };
  const tip = { x: mark.tip[0] * sx, y: mark.tip[1] * sy };
  const zero = { x: mark.zero[0] * sx, y: mark.zero[1] * sy };
  const five = { x: mark.five[0] * sx, y: mark.five[1] * sy };
  const ten = { x: mark.ten[0] * sx, y: mark.ten[1] * sy };
  frames.push({
    id: entry.id,
    clip: entry.clip,
    t: entry.t,
    phase: entry.phase,
    image: scaled.image,
    hub,
    tip,
    five,
    ten,
    labelNeedle: imageAngle(hub, tip),
    labelZero: imageAngle(hub, zero),
    labelTen: imageAngle(hub, ten),
    labelFive: imageAngle(hub, five),
  });
  process.stderr.write(`loaded ${entry.id}\n`);
}

const clips = [...new Set(frames.map((frame) => frame.clip))];

function restOffset(holdClip) {
  const deltas = frames
    .filter((frame) => frame.clip !== holdClip && REST_PHASES.has(frame.phase))
    .map((frame) => clockwise(frame.labelZero, frame.labelNeedle));
  return medianOf(deltas) ?? 0;
}

function labelBarFor(frame, offsetDeg) {
  const zero = wrap360(frame.labelZero + offsetDeg);
  return truthBar(frame.labelNeedle, zero, frame.labelTen);
}

const rows = [];
const snapRows = [];
let badTrials = 0;
let badHits = 0;
const timing = [];

for (const clip of clips) {
  const clipFrames = frames.filter((frame) => frame.clip === clip).sort((a, b) => a.t - b.t);
  const rest = clipFrames.find((frame) => REST_PHASES.has(frame.phase));
  if (!rest) continue;
  const offset = restOffset(clip);
  const others = clipFrames.filter((frame) => frame.id !== rest.id);

  for (const seed of SEEDS) {
    const rng = mulberry32(seed * 10007 + clip.length * 17 + rest.id.charCodeAt(3));
    const taps = {
      centre: jitterPoint(rest.hub, rng),
      five: jitterPoint(rest.five, rng),
      ten: jitterPoint(rest.ten, rng),
    };
    const tCal = performance.now();
    const calibrated = calibrateFromTaps(rest.image, taps);
    const calMs = performance.now() - tCal;
    snapRows.push({
      clip,
      seed,
      ok: calibrated.ok === true,
      redo: calibrated.redo || null,
      reason: calibrated.reason || null,
      hubPx: calibrated.ok ? Math.hypot(calibrated.calibration.hub.x - rest.hub.x, calibrated.calibration.hub.y - rest.hub.y) : null,
      fivePx: calibrated.ok ? Math.hypot(calibrated.calibration.five.x - rest.five.x, calibrated.calibration.five.y - rest.five.y) : null,
      tenPx: calibrated.ok ? Math.hypot(calibrated.calibration.ten.x - rest.ten.x, calibrated.calibration.ten.y - rest.ten.y) : null,
      fiveWarn: calibrated.fiveWarn === true,
      calMs,
    });
    if (!calibrated.ok) {
      for (const frame of others) {
        rows.push({
          id: frame.id, clip, seed, phase: frame.phase, t: frame.t,
          labelBar: round(labelBarFor(frame, offset), 3),
          predBar: null, barErr: null, reason: calibrated.reason || 'no-calibration', ms: null,
        });
      }
      continue;
    }
    const tracker = createCalibratedTracker(calibrated.calibration);
    // Warm the needle detector before the timed reads.
    readCalibratedFrame(rest.image, createCalibratedTracker(calibrated.calibration));
    for (const frame of others) {
      const t0 = performance.now();
      const read = readCalibratedFrame(frame.image, tracker);
      const ms = performance.now() - t0;
      timing.push(ms);
      const label = labelBarFor(frame, offset);
      const pred = read.bar;
      rows.push({
        id: frame.id,
        clip,
        seed,
        phase: frame.phase,
        t: frame.t,
        labelBar: round(label, 3),
        predBar: round(pred, 3),
        barErr: pred == null || label == null ? null : round(pred - label, 3),
        reason: pred == null ? (read.lost ? 'lost' : 'no-needle') : null,
        hubPx: round(Math.hypot(read.hub.x - frame.hub.x, read.hub.y - frame.hub.y), 2),
        lost: read.lost === true,
        score: round(read.score, 3),
        ms: round(ms, 2),
        read,
        frame,
      });
    }
  }

  const names = ['centre', 'five', 'ten'];
  for (let trial = 0; trial < 4; trial += 1) {
    const rng = mulberry32(8000 + trial * 97 + clip.length);
    const which = names[trial % 3];
    const taps = {
      centre: jitterPoint(rest.hub, rng),
      five: jitterPoint(rest.five, rng),
      ten: jitterPoint(rest.ten, rng),
    };
    const kicked = jitterPoint(taps[which], rng, 78, 82);
    taps[which] = kicked;
    badTrials += 1;
    const result = calibrateFromTaps(rest.image, taps);
    if (result.redo === which) badHits += 1;
  }
}

function drawOverlay(frame, read, file) {
  const data = new Uint8ClampedArray(frame.image.data);
  const { width, height } = frame.image;
  const paint = (x, y, rgb) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 1 || yi < 1 || xi >= width - 1 || yi >= height - 1) return;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const o = ((yi + dy) * width + (xi + dx)) * 4;
        data[o] = rgb[0];
        data[o + 1] = rgb[1];
        data[o + 2] = rgb[2];
      }
    }
  };
  const ray = (deg, radius, rgb) => {
    const rad = (deg * Math.PI) / 180;
    for (let step = 0; step < radius; step += 1.5) {
      paint(read.hub.x + step * Math.cos(rad), read.hub.y + step * Math.sin(rad), rgb);
    }
  };
  ray(read.zeroDeg, read.radius * 0.9, [80, 220, 255]);
  ray(read.tenDeg, read.radius * 0.9, [255, 210, 60]);
  ray(read.fiveDeg, read.radius * 0.75, [255, 255, 255]);
  if (read.needleDeg != null) ray(read.needleDeg, read.radius * 0.8, [80, 230, 140]);
  for (let a = 0; a < 360; a += 8) {
    const rad = (a * Math.PI) / 180;
    paint(read.hub.x + 5 * Math.cos(rad), read.hub.y + 5 * Math.sin(rad), [255, 80, 80]);
  }
  const png = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', '-',
    '-frames:v', '1', file,
  ], { input: Buffer.from(data.buffer, data.byteOffset, data.byteLength) });
  if (png.status !== 0) throw new Error(`overlay ${file}`);
}

mkdirSync(OVERLAY_DIR, { recursive: true });
mkdirSync(REPAIR_OVERLAY_DIR, { recursive: true });
const overlayIds = ['f002', 'f004', 'f008', 'f010', 'f014', 'f015', 'f016', 'f018', 'f021', 'f027', 'f032', 'f034'];
const overlaid = [];
for (const id of overlayIds) {
  const row = rows.find((item) => item.id === id && item.seed === 1 && item.read);
  if (!row) continue;
  const file = `${OVERLAY_DIR}/${id}.png`;
  drawOverlay(row.frame, row.read, file);
  drawOverlay(row.frame, row.read, `${REPAIR_OVERLAY_DIR}/${id}.png`);
  overlaid.push(id);
}

const readable = rows.filter((row) => row.barErr != null);
const absBar = readable.map((row) => Math.abs(row.barErr));
const noReading = rows.filter((row) => row.predBar == null).length;
const within = (limit) => rows.filter((row) => row.barErr != null && Math.abs(row.barErr) <= limit).length;
const snapHub = snapRows.map((row) => row.hubPx).filter((value) => value != null);
const snapFive = snapRows.map((row) => row.fivePx).filter((value) => value != null);
const snapTen = snapRows.map((row) => row.tenPx).filter((value) => value != null);
const timingSorted = timing.slice().sort((a, b) => a - b);
const summary = {
  n: rows.length,
  readings: readable.length,
  noReading,
  noReadingPct: round((100 * noReading) / Math.max(1, rows.length), 1),
  within0_25: within(0.25),
  within0_25Pct: round((100 * within(0.25)) / Math.max(1, rows.length), 1),
  within0_5: within(0.5),
  within0_5Pct: round((100 * within(0.5)) / Math.max(1, rows.length), 1),
  medianAbsBar: round(quantile(absBar, 0.5), 3),
  p90AbsBar: round(quantile(absBar, 0.9), 3),
  meanAbsBar: absBar.length ? round(absBar.reduce((sum, value) => sum + value, 0) / absBar.length, 3) : null,
  medianSnapHubPx: round(quantile(snapHub, 0.5), 2),
  medianSnapFivePx: round(quantile(snapFive, 0.5), 2),
  medianSnapTenPx: round(quantile(snapTen, 0.5), 2),
  p90SnapHubPx: round(quantile(snapHub, 0.9), 2),
  calibrations: snapRows.length,
  calibrationOk: snapRows.filter((row) => row.ok).length,
  badTapTrials: badTrials,
  badTapHits: badHits,
  badTapRate: round(badHits / Math.max(1, badTrials), 3),
  trackMsMedian: round(quantile(timingSorted, 0.5), 2),
  trackMsP95: round(quantile(timingSorted, 0.95), 2),
  throttled4xMedian: round((quantile(timingSorted, 0.5) || 0) * 4, 1),
  throttled4xP95: round((quantile(timingSorted, 0.95) || 0) * 4, 1),
  overlays: overlaid,
};

const loco = [];
for (const clip of clips) {
  const held = rows.filter((row) => row.clip === clip);
  const errs = held.map((row) => (row.barErr == null ? null : Math.abs(row.barErr))).filter((value) => value != null);
  const miss = held.filter((row) => row.predBar == null).length;
  loco.push({
    clip,
    n: held.length,
    readings: errs.length,
    noReadingPct: round((100 * miss) / Math.max(1, held.length), 1),
    medianAbsBar: round(quantile(errs, 0.5), 3),
    p90AbsBar: round(quantile(errs, 0.9), 3),
  });
}

function fmt(value, width, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—'.padStart(width);
  return Number(value).toFixed(digits).padStart(width);
}

const lines = [
  'Tap-calibrated tracker vs hand labels. Replay space 1280x720.',
  'Calibration taps are Isaac\'s hub, 5, and 10 on the rest frame, jittered 15-25px, five seeds.',
  'Ground truth 0 is the rest needle: labelled pin plus the leave-one-clip-out pin→needle offset.',
  'Scale is that 0 to the labelled 10 on the same frame. Hub→tip is direction only.',
  'Bar error median/p90 are over frames that published a number. within-* and no-reading cover every tracked frame.',
  '4x latency is the offline tracked-read time multiplied by 4 (CPU-throttle equivalent).',
  '',
  ['id'.padEnd(5), 'clip'.padEnd(16), 'seed'.padStart(4), 'phase'.padEnd(12), 't'.padStart(8), 'label'.padStart(8), 'pred'.padStart(8), 'err'.padStart(8), 'via'].join(' '),
];
for (const row of rows) {
  if (row.seed !== 1) continue;
  lines.push([
    row.id.padEnd(5),
    String(row.clip).padEnd(16),
    String(row.seed).padStart(4),
    String(row.phase).padEnd(12),
    fmt(row.t, 8, 2),
    fmt(row.labelBar, 8, 2),
    fmt(row.predBar, 8, 2),
    fmt(row.barErr, 8, 2),
    row.predBar == null ? (row.reason || 'none') : 'track',
  ].join(' '));
}
lines.push('');
lines.push(`n=${summary.n} readings=${summary.readings} noReading=${summary.noReading} (${summary.noReadingPct}%)`);
lines.push(`medianAbsBar=${summary.medianAbsBar} p90AbsBar=${summary.p90AbsBar} meanAbsBar=${summary.meanAbsBar}`);
lines.push(`within0.25=${summary.within0_25} (${summary.within0_25Pct}% of frames) within0.5=${summary.within0_5} (${summary.within0_5Pct}% of frames)`);
lines.push(`snap px median hub=${summary.medianSnapHubPx} five=${summary.medianSnapFivePx} ten=${summary.medianSnapTenPx} p90 hub=${summary.p90SnapHubPx}`);
lines.push(`calibrations ok ${summary.calibrationOk}/${summary.calibrations}`);
lines.push(`bad-tap detection ${summary.badTapHits}/${summary.badTapTrials} (${summary.badTapRate})`);
lines.push(`tracked read unthrottled medianMs=${summary.trackMsMedian} p95Ms=${summary.trackMsP95}`);
lines.push(`4x medianMs=${summary.throttled4xMedian} p95Ms=${summary.throttled4xP95} (target median < 33, p95 < 50)`);
lines.push(`overlays ${overlaid.join(', ') || 'none'}`);
lines.push('');
lines.push('Per clip, all seeds pooled.');
lines.push('clip             n read miss%  median  p90');
for (const clip of loco) {
  lines.push([
    clip.clip.padEnd(16),
    String(clip.n).padStart(3),
    String(clip.readings).padStart(4),
    fmt(clip.noReadingPct, 6, 0),
    fmt(clip.medianAbsBar, 7, 3),
    fmt(clip.p90AbsBar, 6, 3),
  ].join(' '));
}

const text = `${lines.join('\n')}\n`;
const jsonRows = rows.map(({ read, frame, ...row }) => row);
writeFileSync(`${OUT_BASE}.txt`, text);
writeFileSync(`${OUT_BASE}.json`, JSON.stringify({ summary, loco, frames: jsonRows, snaps: snapRows }, null, 2));
process.stdout.write(text);
