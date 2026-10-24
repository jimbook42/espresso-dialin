#!/usr/bin/env node
/**
 * Phase R5b. Transcode new HEVC clips and build replay JSON + PNG stills.
 * No Isaac taps: the lab uses legacy automatic gauge tracking (tapPhase legacy).
 *
 *   TZ=UTC node scripts/needle-reader/build_r5_replay.mjs
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storedRotationDeg } from '../pressure-replay/replayClipConfig.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPLAY_DIR = '/workspace/pl-state/nr/replay';
const SLOT = '/workspace/bin/box-test-slot';
const FORCE = process.argv.includes('--force');

const CLIPS = [
  {
    id: '20261024_124006',
    kind: 'real',
    src: '/workspace/pl-state/nr/newshots/real/20261024_124006.mp4',
  },
  {
    id: '20261024_124140',
    kind: 'used',
    src: '/workspace/pl-state/nr/newshots/used/20261024_124140.mp4',
  },
];

function probeRotation(file) {
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:stream_side_data=rotation',
    '-of', 'json', file,
  ], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(`ffprobe ${file}`);
  const stream = JSON.parse(probe.stdout).streams?.[0];
  const rotation = stream?.side_data_list?.find((e) => e.rotation != null)?.rotation ?? 0;
  return { width: stream.width, height: stream.height, rotationDeg: Number(rotation) || 0 };
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

function slot(args, env = {}, timeout = '25m') {
  process.stderr.write(`slot ${args.join(' ')}\n`);
  const result = spawnSync(SLOT, args, {
    cwd: ROOT,
    env: { ...process.env, TZ: 'UTC', BOX_TEST_TIMEOUT: timeout, ...env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')} failed: ${(result.stderr || result.stdout || '').slice(-4000)}`);
  }
  return result;
}

function ensureMp4(clip) {
  const dest = path.join(REPLAY_DIR, `${clip.id}.mp4`);
  const geom = probeRotation(clip.src);
  const expected = storedRotationDeg(clip.id, geom.rotationDeg);
  if (expected !== geom.rotationDeg) {
    throw new Error(`${clip.id} probed rotation ${geom.rotationDeg} != config ${expected}`);
  }
  const fresh = existsSync(dest) && statSync(dest).mtimeMs >= statSync(clip.src).mtimeMs;
  if (!fresh || FORCE) {
    process.stderr.write(`transcode ${clip.id} HEVC -> H.264 1280x720 (stored rotation ${expected}°)\n`);
    ffmpeg([
      '-hide_banner', '-loglevel', 'error', '-y', '-noautorotate',
      '-i', clip.src,
      '-vf', 'scale=1280:720:flags=bicubic',
      '-r', '30', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-an',
      dest,
    ]);
  }
  return dest;
}

function replayClip(clip, mp4, port) {
  const saved = path.join(REPLAY_DIR, `${clip.id}.json`);
  if (!FORCE && existsSync(saved)) {
    const prior = JSON.parse(readFileSync(saved, 'utf8'));
    if (prior?.frames?.length) {
      process.stderr.write(`replay ${clip.id} cached (${prior.frames.length} frames)\n`);
      return prior;
    }
  }
  const y4m = path.join(REPLAY_DIR, `${clip.id}.y4m`);
  const duration = durationSec(mp4);
  ffmpeg(['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-pix_fmt', 'yuv420p', y4m]);
  const result = slot([
    'node', 'scripts/pressure-replay/run-clip-browser.mjs',
    y4m, String(duration), String(port), mp4,
  ], {}, '25m');
  const payload = JSON.parse(result.stdout);
  payload.clipId = clip.id;
  payload.storedRotationDeg = storedRotationDeg(clip.id, probeRotation(clip.src).rotationDeg);
  writeFileSync(saved, JSON.stringify(payload));
  rmSync(y4m, { force: true });
  return payload;
}

function main() {
  slot(['bash', 'scripts/needle-reader/build-replay.sh'], {}, '15m');
  const summary = [];
  let port = 4180;
  for (const clip of CLIPS) {
    const mp4 = ensureMp4(clip);
    const payload = replayClip(clip, mp4, port);
    port += 1;
    summary.push({
      id: clip.id,
      frames: payload.frames?.length ?? 0,
      tapCalibration: payload.tapCalibration ?? null,
      storedRotationDeg: payload.storedRotationDeg,
    });
  }
  process.stdout.write(`${JSON.stringify({ clips: summary }, null, 2)}\n`);
}

main();
