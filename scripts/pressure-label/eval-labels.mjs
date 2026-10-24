/**
 * Offline score of the runtime finder against hand labels.
 * Frames stay on disk under /workspace/pl-state. Nothing is uploaded.
 *
 * Label JPEGs are the -noautorotate extracts. Dry clips are 3840×2160;
 * the replay reader scales those to 1280×720, and the taps are scaled
 * by the same factors before any comparison. Real clips are already
 * 1280×720 in stored pixels (rotation side-data is not applied; the
 * taps were made on these pixels).
 *
 * One still frame, no tracker memory. Same modules as a cold read:
 * discover, rectify, needle, then colour registration with the rim
 * template only as fallback. A bar is published when that registration
 * accepts and the angle sits on the printed scale.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { setOpenCvForTests } from '../../src/flairPressureLab/opencvRuntime.js';
import { rectifyGaugeFace } from '../../src/flairPressureLab/faceRectify.js';
import {
  discoverGaugeInFrame,
  measureRimProfile,
  registerDialRotationFromProfile,
  scoreDialFaceInterior,
} from '../../src/flairPressureLab/gaugeTrack.js';
import { detectNeedleAngle, refineNeedleAngle } from '../../src/flairPressureLab/needleFromFrame.js';
import { prepareEdges } from '../../src/flairPressureLab/framePrep.js';
import { measureDialColorBands, registerDialFromColorBands } from '../../src/flairPressureLab/colorRegistration.js';
import {
  DIAL_FACE_VERIFY_MIN,
  FLAIR_58_SCALE,
  NEEDLE_LIKENESS_GATE,
  OUTER_RADIUS_RATIO,
  TIP_INNER_RATIO,
  angleToBar,
  wrap360,
  wrapDelta,
} from '../../src/flairPressureLab/gaugeConfig.js';
import {
  CANONICAL_ZERO_BAR_ANGLE_DEG,
  FLAIR_STATELESS_SESSION,
} from '../../src/flairPressureLab/canonicalDial.js';

const require = createRequire(new URL('../../package.json', import.meta.url));
let cv = require('@techstark/opencv-js');
if (typeof cv?.then === 'function') cv = await cv;
if (!cv.Mat) await new Promise((resolve) => { cv.onRuntimeInitialized = resolve; });
setOpenCvForTests(cv);

const REPLAY_W = 1280;
const REPLAY_H = 720;
const LABELS_PATH = '/workspace/pl-state/labels.json';
const MANIFEST_PATH = '/workspace/pl-state/label-frames/manifest.json';
const FRAMES_DIR = '/workspace/pl-state/label-frames';

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
}

const outBase = argValue('--out', '/workspace/pl-state/eval-baseline');

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
  if (image.width === REPLAY_W && image.height === REPLAY_H) {
    return { image, sx: 1, sy: 1 };
  }
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
  if (scaled.status !== 0 || scaled.stdout.length !== expect) {
    throw new Error(`scale failed (${scaled.stdout?.length || 0} bytes)`);
  }
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

function scalePoint(pt, sx, sy) {
  return [pt[0] * sx, pt[1] * sy];
}

function imageAngle(from, to) {
  return wrap360((Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI);
}

function clockwise(fromDeg, toDeg) {
  return wrap360(toDeg - fromDeg);
}

/**
 * Piecewise-linear bar. `zeroOffsetDeg` moves the 0° mark clockwise off the
 * pin-centre tap onto the needle centreline. The needle rests on top of the
 * pin, so the shaft does not point at the pin centre. Five and ten stay the
 * printed marks.
 */
export function barFromAngles(needleDeg, zeroDeg, fiveDeg, tenDeg) {
  const span05 = clockwise(zeroDeg, fiveDeg);
  const span510 = clockwise(fiveDeg, tenDeg);
  if (!(span05 > 1) || !(span510 > 1)) return null;
  const from0 = clockwise(zeroDeg, needleDeg);
  const span = span05 + span510;
  if (from0 <= span05) return (from0 / span05) * 5;
  if (from0 <= span) return 5 + ((from0 - span05) / span510) * 5;
  const past = from0 - span;
  if (past <= 14) return Math.min(10.6, 10 + (past / span510) * 5);
  const before = clockwise(needleDeg, zeroDeg);
  if (before <= 14) return Math.max(-0.6, -(before / span05) * 5);
  return null;
}

export function labelledBar(hub, tip, zero, five, ten, zeroOffsetDeg = 0) {
  return barFromAngles(
    imageAngle(hub, tip),
    wrap360(imageAngle(hub, zero) + (zeroOffsetDeg || 0)),
    imageAngle(hub, five),
    imageAngle(hub, ten),
  );
}

/** Frames where the needle is sitting on the pin, not a mid-shot sample. */
const REST_PHASES = new Set(['rest', 'dry_1', 'used_1']);

function medianOf(values) {
  const sorted = values.filter((value) => value != null && !Number.isNaN(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * Detector angle → stored-frame angle.
 * A warped face measures 0° at the right of the circle. The ellipse
 * matrix is the same one faceRectify uses to build that circle, so the
 * comparison sits in the pixels Isaac tapped.
 */
function detectorAngleToSource(ellipse, warped, angleDeg) {
  if (!warped || !ellipse || angleDeg == null) return angleDeg;
  const a = ellipse.width / 2;
  const b = ellipse.height / 2;
  const radius = Math.max(ellipse.width, ellipse.height) / 2;
  if (!(radius > 1)) return angleDeg;
  const phi = ((ellipse.angleDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const m00 = (a * cos) / radius;
  const m01 = (-b * sin) / radius;
  const m10 = (a * sin) / radius;
  const m11 = (b * cos) / radius;
  const rad = (angleDeg * Math.PI) / 180;
  const rx = Math.cos(rad);
  const ry = Math.sin(rad);
  const sx = m00 * rx + m01 * ry;
  const sy = m10 * rx + m11 * ry;
  return wrap360((Math.atan2(sy, sx) * 180) / Math.PI);
}

function round(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function quantile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
}

/**
 * Cold still-frame read. Colour lock first, rim template only if colour
 * declines. Matches the single-frame branch of the live reader.
 */
export function readFinderFrame(image) {
  const found = discoverGaugeInFrame(image);
  if (!found?.ok) return { ok: false, reason: 'no-gauge', bar: null };
  const face = rectifyGaugeFace(cv, image, found);
  if (!face?.ok) {
    return {
      ok: false,
      reason: 'rectify',
      bar: null,
      hub: { x: found.cx, y: found.cy },
      radius: found.radius,
    };
  }
  const inner = face.radius * TIP_INNER_RATIO;
  const outer = face.radius * OUTER_RADIUS_RATIO;
  const needle = detectNeedleAngle(face.image, face.cx, face.cy, inner, outer);
  const px = Number.isFinite(needle.pivotX) ? needle.pivotX : face.cx;
  const py = Number.isFinite(needle.pivotY) ? needle.pivotY : face.cy;
  needle.angleDeg = refineNeedleAngle(face.image, px, py, inner, outer, needle.angleDeg);
  const bands = measureDialColorBands(face.image, px, py, face.radius, needle.angleDeg);
  let reg = registerDialFromColorBands(bands);
  let regSource = reg.ok ? 'color' : null;
  if (!reg.ok) {
    const edges = prepareEdges(face.image, {
      contrastRadius: Math.max(2, Math.round(face.radius * 0.05)),
    }).edges;
    const profile = measureRimProfile(
      edges, face.image.width, face.image.height, face.cx, face.cy, face.radius,
      { bins: 360, innerRatio: 0.76, outerRatio: 0.88 },
    );
    const fromTemplate = registerDialRotationFromProfile(profile, needle.angleDeg);
    if (fromTemplate.ok) {
      reg = fromTemplate;
      regSource = 'template';
    }
  }
  const rotationDeg = reg.ok ? reg.rotationDeg : null;
  const relative = rotationDeg == null ? null : wrap360(needle.angleDeg - rotationDeg);
  const bar = reg.ok ? angleToBar(relative, FLAIR_STATELESS_SESSION) : null;
  const faceScore = scoreDialFaceInterior(
    face.image.data, face.image.width, face.image.height, face.cx, face.cy, face.radius,
  );
  const hub = face.ellipse
    ? { x: face.ellipse.cx, y: face.ellipse.cy }
    : { x: found.cx, y: found.cy };
  const zeroDet = rotationDeg == null ? null : wrap360(rotationDeg + CANONICAL_ZERO_BAR_ANGLE_DEG);
  return {
    ok: bar != null,
    reason: bar != null ? null : (reg.ok ? 'off-scale' : (regSource ? 'rejected' : 'unregistered')),
    bar,
    hub,
    radius: face.radius,
    foundRadius: found.radius,
    needleDeg: needle.angleDeg,
    zeroDeg: zeroDet,
    rotationDeg,
    relativeDeg: relative,
    warped: face.warped === true,
    ellipse: face.ellipse || null,
    likeness: needle.likeness,
    quality: needle.quality,
    needleEnd: needle.needleEnd,
    hubScore: needle.hub,
    regSource,
    regOk: reg.ok === true,
    confidence: reg.confidence ?? 0,
    periodMargin: reg.periodMargin ?? 0,
    faceScore,
    gateLikeness: (needle.likeness ?? 0) >= NEEDLE_LIKENESS_GATE,
    gateFace: faceScore >= DIAL_FACE_VERIFY_MIN,
    sweepDeg: FLAIR_58_SCALE.sweepDeg,
  };
}

function fmt(value, width, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—'.padStart(width);
  return value.toFixed(digits).padStart(width);
}

const labels = JSON.parse(readFileSync(LABELS_PATH, 'utf8')).frames;
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const rows = [];

for (const entry of manifest) {
  const mark = labels[entry.id];
  if (!mark) {
    rows.push({ id: entry.id, clip: entry.clip, t: entry.t, phase: entry.phase, reason: 'no-label' });
    continue;
  }
  const native = decodeJpeg(`${FRAMES_DIR}/${entry.file}`);
  const replay = scaleToReplay(native);
  const hub = scalePoint(mark.hub, replay.sx, replay.sy);
  const tip = scalePoint(mark.tip, replay.sx, replay.sy);
  const zero = scalePoint(mark.zero, replay.sx, replay.sy);
  const five = scalePoint(mark.five, replay.sx, replay.sy);
  const ten = scalePoint(mark.ten, replay.sx, replay.sy);
  const labelNeedle = imageAngle(hub, tip);
  const labelZero = imageAngle(hub, zero);
  const labelFive = imageAngle(hub, five);
  const labelTen = imageAngle(hub, ten);
  const pinBar = labelledBar(hub, tip, zero, five, ten);
  const t0 = performance.now();
  const read = readFinderFrame(replay.image);
  const ms = performance.now() - t0;
  const hubPx = read.hub ? Math.hypot(read.hub.x - hub[0], read.hub.y - hub[1]) : null;
  const predNeedle = detectorAngleToSource(read.ellipse, read.warped, read.needleDeg);
  const predZero = detectorAngleToSource(read.ellipse, read.warped, read.zeroDeg);
  const needleErr = predNeedle == null ? null : Math.abs(wrapDelta(labelNeedle, predNeedle));
  const zeroErr = predZero == null ? null : Math.abs(wrapDelta(labelZero, predZero));
  const barErr = read.bar == null || pinBar == null ? null : read.bar - pinBar;
  rows.push({
    id: entry.id,
    clip: entry.clip,
    t: entry.t,
    phase: entry.phase,
    unclear: mark.unclear === true,
    native: `${native.width}x${native.height}`,
    sx: round(replay.sx, 4),
    sy: round(replay.sy, 4),
    pinBar: round(pinBar, 3),
    labelBar: round(pinBar, 3),
    labelFive: round(labelFive, 2),
    labelTen: round(labelTen, 2),
    runtimeBar: round(read.bar, 3),
    predBar: round(read.bar, 3),
    barErr: round(barErr, 3),
    hubPx: round(hubPx, 2),
    needleErr: round(needleErr, 2),
    zeroErr: round(zeroErr, 2),
    labelNeedle: round(labelNeedle, 2),
    predNeedle: round(predNeedle, 2),
    labelZero: round(labelZero, 2),
    predZero: round(predZero, 2),
    warped: read.warped === true,
    regSource: read.regSource || null,
    reason: read.bar == null ? (read.reason || 'no-reading') : null,
    likeness: round(read.likeness, 3),
    faceScore: round(read.faceScore, 3),
    gateLikeness: read.gateLikeness === true,
    gateFace: read.gateFace === true,
    ms: round(ms, 1),
    hub: read.hub ? { x: round(read.hub.x, 1), y: round(read.hub.y, 1) } : null,
    labelHub: { x: round(hub[0], 1), y: round(hub[1], 1) },
  });
  const shown = rows[rows.length - 1];
  process.stderr.write(
    `${shown.id} bar ${shown.predBar ?? '—'} label ${shown.labelBar ?? '—'} hub ${shown.hubPx ?? '—'}px ${shown.ms}ms\n`,
  );
}

function foldParams(holdClip) {
  const train = rows.filter((row) => row.clip !== holdClip && row.labelZero != null);
  const deltas = train
    .filter((row) => REST_PHASES.has(row.phase))
    .map((row) => clockwise(row.labelZero, row.labelNeedle));
  const delta = medianOf(deltas);
  // The 0 mark is the rest needle, so the sweep is that direction to the 10
  // tick. Pin-to-10 still includes the pin radius and reads low.
  const spans = train.map((row) => clockwise(wrap360(row.labelZero + (delta || 0)), row.labelTen));
  return { delta, sweep: medianOf(spans) };
}

const locoByClip = [];
for (const row of rows) {
  if (row.labelZero == null) continue;
  const { delta, sweep } = foldParams(row.clip);
  row.restOffsetDeg = round(delta, 2);
  row.locoSweepDeg = round(sweep, 2);
  const zero = wrap360(row.labelZero + delta);
  row.labelBar = round(barFromAngles(row.labelNeedle, zero, row.labelFive, row.labelTen), 3);
  row.zeroErr = row.predZero == null ? null : round(Math.abs(wrapDelta(zero, row.predZero)), 2);
  let pred = null;
  if (row.predNeedle != null && row.predZero != null && sweep > 0) {
    pred = angleToBar(clockwise(row.predZero, row.predNeedle), {
      ...FLAIR_STATELESS_SESSION,
      zeroAngleDeg: 0,
      sweepDeg: sweep,
    });
  }
  row.predBar = round(pred, 3);
  row.barErr = pred == null || row.labelBar == null ? null : round(pred - row.labelBar, 3);
  if (pred == null) row.reason = row.reason || 'off-scale';
  else row.reason = null;
}

const clips = [...new Set(rows.map((row) => row.clip))];
for (const clip of clips) {
  const held = rows.filter((row) => row.clip === clip);
  const errs = held.map((row) => (row.barErr == null ? null : Math.abs(row.barErr))).filter((v) => v != null);
  const miss = held.filter((row) => row.predBar == null).length;
  const sample = held.find((row) => row.restOffsetDeg != null);
  locoByClip.push({
    clip,
    n: held.length,
    readings: errs.length,
    noReading: miss,
    noReadingPct: round((100 * miss) / held.length, 1),
    medianAbsBar: round(quantile(errs, 0.5), 3),
    p90AbsBar: round(quantile(errs, 0.9), 3),
    restOffsetDeg: sample?.restOffsetDeg ?? null,
    sweepDeg: sample?.locoSweepDeg ?? null,
    medianMs: round(quantile(held.map((row) => row.ms).filter((v) => v != null), 0.5), 1),
  });
}

const readable = rows.filter((row) => row.barErr != null);
const absBar = readable.map((row) => Math.abs(row.barErr));
const n = rows.length;
const noReading = rows.filter((row) => row.predBar == null).length;
const within = rows.filter((row) => row.barErr != null && Math.abs(row.barErr) <= 0.5).length;
const summary = {
  n,
  readings: readable.length,
  noReading,
  noReadingPct: round((100 * noReading) / n, 1),
  within0_5: within,
  within0_5Pct: round((100 * within) / n, 1),
  within0_5OfReadingsPct: readable.length ? round((100 * within) / readable.length, 1) : null,
  medianAbsBar: round(quantile(absBar, 0.5), 3),
  p90AbsBar: round(quantile(absBar, 0.9), 3),
  meanAbsBar: absBar.length ? round(absBar.reduce((s, v) => s + v, 0) / absBar.length, 3) : null,
  medianHubPx: round(quantile(rows.map((r) => r.hubPx).filter((v) => v != null), 0.5), 2),
  p90HubPx: round(quantile(rows.map((r) => r.hubPx).filter((v) => v != null), 0.9), 2),
  medianNeedleErr: round(quantile(rows.map((r) => r.needleErr).filter((v) => v != null), 0.5), 2),
  p90NeedleErr: round(quantile(rows.map((r) => r.needleErr).filter((v) => v != null), 0.9), 2),
  medianZeroErr: round(quantile(rows.map((r) => r.zeroErr).filter((v) => v != null), 0.5), 2),
  p90ZeroErr: round(quantile(rows.map((r) => r.zeroErr).filter((v) => v != null), 0.9), 2),
  medianMs: round(quantile(rows.map((r) => r.ms).filter((v) => v != null), 0.5), 1),
  p95Ms: round(quantile(rows.map((r) => r.ms).filter((v) => v != null), 0.95), 1),
  locoMedianOfClipMedians: round(quantile(locoByClip.map((c) => c.medianAbsBar).filter((v) => v != null), 0.5), 3),
};

const header = [
  'id'.padEnd(5),
  'clip'.padEnd(16),
  'phase'.padEnd(12),
  't'.padStart(8),
  'hubPx'.padStart(8),
  'needle'.padStart(8),
  'zero'.padStart(8),
  'label'.padStart(8),
  'pred'.padStart(8),
  'err'.padStart(8),
  'via',
].join(' ');

const lines = [
  'Pressure finder vs hand labels. Replay space 1280x720.',
  'Ground truth 0 is the rest needle, not the pin-centre tap. The needle lies on the pin,',
  'so the shaft is clockwise of the pin centre. That offset is the median clockwise',
  'pin→needle angle on rest, dry, and used_1 frames of the other clips (leave-one-clip-out).',
  'Five and ten stay the printed taps. Predicted bar divides the finder angle by the',
  'same fold\'s median rest-needle-to-10 span. That is the printed arc from the 0 the needle rests on.',
  'hubPx: detected centre vs labelled hub. needle: degrees vs hub→tip. zero: degrees vs the rest-calibrated 0.',
  'Bar error median/p90 are over frames that published a number. within-0.5 and no-reading are over every labelled frame.',
  '',
  header,
];
for (const row of rows) {
  lines.push([
    row.id.padEnd(5),
    String(row.clip || '').padEnd(16),
    String(row.phase || '').padEnd(12),
    fmt(row.t, 8, 2),
    fmt(row.hubPx, 8, 1),
    fmt(row.needleErr, 8, 1),
    fmt(row.zeroErr, 8, 1),
    fmt(row.labelBar, 8, 2),
    fmt(row.predBar, 8, 2),
    fmt(row.barErr, 8, 2),
    row.predBar == null ? (row.reason || 'none') : (row.regSource || ''),
  ].join(' '));
}
lines.push('');
lines.push(`n=${summary.n} readings=${summary.readings} noReading=${summary.noReading} (${summary.noReadingPct}%)`);
lines.push(`medianAbsBar=${summary.medianAbsBar} p90AbsBar=${summary.p90AbsBar} meanAbsBar=${summary.meanAbsBar}`);
lines.push(`within0.5=${summary.within0_5} (${summary.within0_5Pct}% of frames, ${summary.within0_5OfReadingsPct}% of readings)`);
lines.push(`medianHubPx=${summary.medianHubPx} p90HubPx=${summary.p90HubPx}`);
lines.push(`medianNeedleErr=${summary.medianNeedleErr} p90NeedleErr=${summary.p90NeedleErr}`);
lines.push(`medianZeroErr=${summary.medianZeroErr} p90ZeroErr=${summary.p90ZeroErr}`);
lines.push(`unthrottled cold-read medianMs=${summary.medianMs} p95Ms=${summary.p95Ms} (discovery+rectify+needle+register, not the tracked frame)`);
lines.push('');
lines.push('Leave-one-clip-out. Offset and sweep are fit on the other clips only.');
lines.push('clip             n read miss%  median  p90   offset sweep  ms');
for (const clip of locoByClip) {
  lines.push([
    clip.clip.padEnd(16),
    String(clip.n).padStart(2),
    String(clip.readings).padStart(4),
    fmt(clip.noReadingPct, 6, 0),
    fmt(clip.medianAbsBar, 7, 3),
    fmt(clip.p90AbsBar, 6, 3),
    fmt(clip.restOffsetDeg, 7, 1),
    fmt(clip.sweepDeg, 6, 1),
    fmt(clip.medianMs, 6, 1),
  ].join(' '));
}
lines.push(`median of held-out clip medians=${summary.locoMedianOfClipMedians}`);

const text = `${lines.join('\n')}\n`;
writeFileSync(`${outBase}.txt`, text);
writeFileSync(`${outBase}.json`, JSON.stringify({ summary, loco: locoByClip, frames: rows }, null, 2));
process.stdout.write(text);
