#!/usr/bin/env node
/**
 * Phase 0 exam. One command:
 *   TZ=UTC node scripts/needle-reader/exam.mjs
 *
 * Reuses eval-labels.mjs, eval-calibrated.mjs, and run-clip-browser.mjs.
 * Heavy steps go through /workspace/bin/box-test-slot with TZ=UTC.
 * Writes /workspace/pl-state/nr/baseline.txt and baseline.json.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coveragePct,
  flipRatePct,
  jitterRms,
  labelErrorStats,
  rejectionCounts,
  restOffsetBar,
  round,
  trackingCounts,
} from './metrics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TRAIN = '/workspace/flair-train';
const MANIFEST = path.join(ROOT, 'scripts/pressure-label/fixtures/manifest-2026-10-22.json');
const REPLAY_DIR = '/workspace/pl-state/nr/replay';
const BASELINE_TXT = '/workspace/pl-state/nr/baseline.txt';
const BASELINE_JSON = '/workspace/pl-state/nr/baseline.json';
const TAPS_DIR = '/workspace/pl-state/taps';
const SLOT = '/workspace/bin/box-test-slot';
const COMMAND = 'TZ=UTC node scripts/needle-reader/exam.mjs';
const FORCE = process.argv.includes('--force');

function memAvailableMb() {
  const text = readFileSync('/proc/meminfo', 'utf8');
  const match = text.match(/MemAvailable:\s+(\d+)\s+kB/);
  return match ? Number(match[1]) / 1024 : 0;
}

function requireMemory() {
  const mb = memAvailableMb();
  if (mb < 3072) {
    throw new Error(`need >= 3 GB MemAvailable, have ${mb.toFixed(0)} MB`);
  }
  return mb;
}

function slot(args, env = {}, timeout = '25m') {
  requireMemory();
  process.stderr.write(`slot ${args.join(' ')}\n`);
  const result = spawnSync(SLOT, args, {
    cwd: ROOT,
    env: { ...process.env, TZ: 'UTC', BOX_TEST_TIMEOUT: timeout, ...env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const err = `${result.stderr || ''}\n${result.stdout || ''}`.slice(-5000);
    throw new Error(`${args.join(' ')} failed (${result.status}): ${err}`);
  }
  return result;
}

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${(result.stderr || '').slice(-2000)}`);
  }
}

function durationSec(file) {
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(`ffprobe ${file}`);
  const duration = Number(String(probe.stdout).trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`bad duration ${file}`);
  return duration;
}

function clipList() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const ids = [];
  for (const entry of manifest) {
    if (!ids.includes(entry.clip)) ids.push(entry.clip);
  }
  return ids.map((id) => {
    let src = null;
    let kind = null;
    for (const candidate of ['real', 'used', 'dry']) {
      const file = path.join(TRAIN, candidate, `${id}.mp4`);
      if (existsSync(file)) {
        src = file;
        kind = candidate;
        break;
      }
    }
    if (!src) throw new Error(`missing train clip ${id}`);
    const tap = path.join(TAPS_DIR, `${kind}_${id}.json`);
    return { id, kind, src, taps: existsSync(tap) ? tap : null };
  });
}

function ensureReplayMp4(clip) {
  const dest = path.join(REPLAY_DIR, `${clip.id}.mp4`);
  const fresh = existsSync(dest) && statSync(dest).mtimeMs >= statSync(clip.src).mtimeMs;
  if (!fresh) {
    process.stderr.write(`transcode ${clip.id} -> 1280x720 30fps crf 18\n`);
    ffmpeg([
      '-hide_banner', '-loglevel', 'error', '-y', '-noautorotate',
      '-i', clip.src,
      '-vf', 'scale=1280:720:flags=bicubic',
      '-r', '30',
      '-c:v', 'libx264',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-an',
      dest,
    ]);
  }
  return dest;
}

function replayClip(clip, mp4, port) {
  const saved = path.join(REPLAY_DIR, `${clip.id}.json`);
  if (!FORCE && existsSync(saved)) {
    const prior = JSON.parse(readFileSync(saved, 'utf8'));
    if (prior?.frames?.length && prior.tapCalibration) {
      process.stderr.write(`replay ${clip.id} cached\n`);
      return prior;
    }
  }
  const y4m = path.join(REPLAY_DIR, `${clip.id}.y4m`);
  const duration = durationSec(mp4);
  process.stderr.write(`y4m ${clip.id} ${duration.toFixed(2)}s\n`);
  ffmpeg(['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-pix_fmt', 'yuv420p', y4m]);
  try {
    const env = {};
    if (clip.taps) env.PRESSURE_TAP_CAL = clip.taps;
    const result = slot([
      'node', 'scripts/pressure-replay/run-clip-browser.mjs',
      y4m, String(duration), String(port), mp4,
    ], env, '25m');
    const payload = JSON.parse(result.stdout);
    writeFileSync(saved, JSON.stringify(payload));
    return payload;
  } finally {
    rmSync(y4m, { force: true });
  }
}

function fmt(value, width, digits = 2) {
  if (value == null || Number.isNaN(value)) return 'N/A'.padStart(width);
  return Number(value).toFixed(digits).padStart(width);
}

function sumCounts(list) {
  const totals = {};
  for (const counts of list) {
    for (const [key, value] of Object.entries(counts || {})) {
      totals[key] = (totals[key] || 0) + value;
    }
  }
  return totals;
}

function medianOf(values) {
  const nums = values.filter((value) => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!nums.length) return null;
  return nums[Math.floor((nums.length - 1) / 2)];
}

function calibratingThenTracking(frames) {
  let sawCalibrating = false;
  for (const frame of frames) {
    if (frame.tracking === 'CALIBRATING') sawCalibrating = true;
    if (sawCalibrating && frame.tracking === 'TRACKING') return true;
  }
  return false;
}

function clipReport(clip, payload, calibratedRows, labelRows) {
  const frames = payload.frames || [];
  const label = labelErrorStats(calibratedRows);
  const timing = payload.timing || {};
  return {
    id: clip.id,
    kind: clip.kind,
    taps: clip.taps,
    frames: frames.length,
    coveragePct: round(coveragePct(frames), 2),
    medianAbsBar: round(label.median, 3),
    p90AbsBar: round(label.p90, 3),
    wildPct: round(label.wildPct, 2),
    labelN: label.n,
    flipPct: round(flipRatePct(labelRows.map((row) => row.needleErr)), 2),
    flipN: labelRows.filter((row) => row.needleErr != null).length,
    restOffsetBar: round(restOffsetBar(frames), 3),
    jitterRms: round(jitterRms(frames), 4),
    latencyModel4xMs: round(timing.stageModel4xMedian, 2),
    latencyTotal4xMs: round(timing.e2e4xMedian, 2),
    rejections: rejectionCounts(frames),
    tracking: trackingCounts(frames),
    tapCalibration: payload.tapCalibration || null,
  };
}

function render(reports, overall) {
  const lines = [
    'Phase 0 baseline. Current build, no threshold tuning.',
    `command: ${COMMAND}`,
    'Coverage, rest offset, jitter, latency, and rejections are the browser replay.',
    'Median, P90, and wild rate are leave-one-clip-out bar error from eval-calibrated.mjs.',
    'Flip rate is leave-one-clip-out needle error within 25° of 180°, from eval-labels.mjs.',
    'Latency is the 4x CPU-throttle replay: model = stageModel median, total = e2e median.',
    'N/A means that clip has no hand-label comparison, or the replay published no value.',
    'Used-puck coverage is the used/ clips pooled.',
    '',
    ['clip'.padEnd(16), 'kind'.padEnd(5), 'cov%'.padStart(7), 'med'.padStart(7), 'p90'.padStart(7), 'wild%'.padStart(7), 'flip%'.padStart(7), 'rest'.padStart(7), 'jitter'.padStart(8), 'model4x'.padStart(8), 'total4x'.padStart(8)].join(' '),
  ];
  for (const row of reports) {
    lines.push([
      row.id.padEnd(16),
      row.kind.padEnd(5),
      fmt(row.coveragePct, 7, 1),
      fmt(row.medianAbsBar, 7, 3),
      fmt(row.p90AbsBar, 7, 3),
      fmt(row.wildPct, 7, 1),
      fmt(row.flipPct, 7, 1),
      fmt(row.restOffsetBar, 7, 3),
      fmt(row.jitterRms, 8, 4),
      fmt(row.latencyModel4xMs, 8, 1),
      fmt(row.latencyTotal4xMs, 8, 1),
    ].join(' '));
  }
  lines.push('');
  lines.push(`overall coverage=${fmt(overall.coveragePct, 0, 1)}%  used-puck coverage=${fmt(overall.usedCoveragePct, 0, 1)}%`);
  lines.push(`overall median=${fmt(overall.medianAbsBar, 0, 3)}  p90=${fmt(overall.p90AbsBar, 0, 3)}  wild=${fmt(overall.wildPct, 0, 1)}%  flip=${fmt(overall.flipPct, 0, 1)}%`);
  lines.push(`overall rest max|.|=${fmt(overall.restAbsMax, 0, 3)}  jitter median=${fmt(overall.jitterMedian, 0, 4)}`);
  lines.push(`overall latency 4x model=${fmt(overall.latencyModel4xMs, 0, 1)} ms  total=${fmt(overall.latencyTotal4xMs, 0, 1)} ms (median of clip medians)`);
  lines.push('');
  lines.push('Rejections by reason');
  for (const row of reports) {
    const parts = Object.entries(row.rejections);
    lines.push(`${row.id}: ${parts.length ? parts.map(([key, value]) => `${key}=${value}`).join(' ') : 'none'}`);
  }
  lines.push(`overall: ${Object.entries(overall.rejections).map(([key, value]) => `${key}=${value}`).join(' ') || 'none'}`);
  lines.push('');
  lines.push('Tap calibration (replay result)');
  for (const row of reports) {
    const tap = row.tapCalibration;
    if (!tap) {
      lines.push(`${row.id}: N/A`);
      continue;
    }
    const anchors = tap.anchors
      ? `centre=${JSON.stringify(tap.anchors.centre)} five=${JSON.stringify(tap.anchors.five)} ten=${JSON.stringify(tap.anchors.ten)} zero=${tap.anchors.zeroAngleDeg} span=${tap.anchors.spanDeg}`
      : 'anchors=none';
    lines.push(`${row.id}: applied=${tap.applied === true} atSec=${tap.atSec ?? 'N/A'} reason=${tap.reason ?? 'none'} ${anchors}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const mb = requireMemory();
  process.stderr.write(`MemAvailable ${mb.toFixed(0)} MB\n`);
  mkdirSync(REPLAY_DIR, { recursive: true });
  const clips = clipList();
  if (clips.length !== 10) throw new Error(`expected 10 clips, found ${clips.length}`);

  // A plain slot, not --build. --build takes both box slots, and another
  // job may already be holding slot 1. The build still runs inside the slot.
  slot(['npm', 'run', 'build'], {
    VITE_ENABLE_PRESSURE_LAB: 'true',
    VITE_PRESSURE_REPLAY: 'true',
  }, '20m');
  slot(['node', 'scripts/pressure-label/eval-labels.mjs'], {}, '20m');
  slot(['node', 'scripts/pressure-label/eval-calibrated.mjs'], {}, '30m');

  const calibrated = JSON.parse(readFileSync('/workspace/pl-state/eval-6.41.json', 'utf8'));
  const labels = JSON.parse(readFileSync('/workspace/pl-state/eval-baseline.json', 'utf8'));

  const reports = [];
  const payloads = [];
  clips.forEach((clip, index) => {
    const mp4 = ensureReplayMp4(clip);
    const payload = replayClip(clip, mp4, 4500 + index);
    payloads.push({ clip, payload });
    const calibratedRows = (calibrated.frames || []).filter((row) => row.clip === clip.id);
    const labelRows = (labels.frames || []).filter((row) => row.clip === clip.id);
    reports.push(clipReport(clip, payload, calibratedRows, labelRows));
    const row = reports.at(-1);
    process.stderr.write(`done ${clip.id} coverage=${row.coveragePct} tap=${row.tapCalibration?.applied} atSec=${row.tapCalibration?.atSec}\n`);
    if (clip.id === '20261017_084814') {
      const order = calibratingThenTracking(payload.frames || []);
      if (row.tapCalibration?.applied !== true || !order) {
        throw new Error(`084814 gate failed applied=${row.tapCalibration?.applied} atSec=${row.tapCalibration?.atSec} reason=${row.tapCalibration?.reason} calibratingThenTracking=${order}`);
      }
    }
  });

  const allFrames = payloads.flatMap((item) => item.payload.frames || []);
  const usedFrames = payloads.filter((item) => item.clip.kind === 'used').flatMap((item) => item.payload.frames || []);
  const allCalibrated = calibrated.frames || [];
  const allLabels = labels.frames || [];
  const label = labelErrorStats(allCalibrated);
  const rests = reports.map((row) => row.restOffsetBar).filter((value) => value != null && Number.isFinite(value));
  const overall = {
    coveragePct: round(coveragePct(allFrames), 2),
    usedCoveragePct: round(coveragePct(usedFrames), 2),
    medianAbsBar: round(label.median, 3),
    p90AbsBar: round(label.p90, 3),
    wildPct: round(label.wildPct, 2),
    flipPct: round(flipRatePct(allLabels.map((row) => row.needleErr)), 2),
    restAbsMax: rests.length ? round(Math.max(...rests.map((value) => Math.abs(value))), 3) : null,
    jitterMedian: round(medianOf(reports.map((row) => row.jitterRms)), 4),
    latencyModel4xMs: round(medianOf(reports.map((row) => row.latencyModel4xMs)), 2),
    latencyTotal4xMs: round(medianOf(reports.map((row) => row.latencyTotal4xMs)), 2),
    rejections: sumCounts(reports.map((row) => row.rejections)),
  };
  const text = render(reports, overall);
  const proof = reports.find((row) => row.id === '20261017_084814');
  const body = {
    command: COMMAND,
    clips: reports,
    overall,
    gate: {
      clips: reports.length,
      baseline: true,
      tapApplied084814: proof?.tapCalibration?.applied === true,
      tapAtSec084814: proof?.tapCalibration?.atSec ?? null,
      anchors084814: proof?.tapCalibration?.anchors ?? null,
    },
  };
  writeFileSync(BASELINE_TXT, text);
  writeFileSync(BASELINE_JSON, `${JSON.stringify(body, null, 2)}\n`);
  process.stdout.write(text);
  if (!body.gate.tapApplied084814) {
    throw new Error('084814 tap calibration did not apply');
  }
}

main();
