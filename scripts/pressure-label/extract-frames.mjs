/**
 * Extract ~34 JPEG frames for manual gauge labelling. Output only under pl-state/label-frames.
 * f001–f030 unchanged semantics; f031+ are real-clip taper frames.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';

const OUT_DIR = '/workspace/pl-state/label-frames';
const TRUTH_PATH = '/workspace/flair-train/truth_sanity_only.json';
const REAL_DIR = '/workspace/flair-train/real';
const USED_DIR = '/workspace/flair-train/used';
const DRY_CLIPS = [
  '/workspace/flair-train/dry/20261015_225219.mp4',
  '/workspace/flair-train/dry/20261015_225307.mp4',
];

function probeDuration(file) {
  const r = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      file,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed: ${file}`);
  return Number.parseFloat(r.stdout.trim());
}

function extractJpeg(videoPath, timeS, outPath) {
  const t = Math.max(0, timeS);
  const r = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-noautorotate',
      '-ss',
      String(t),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      '-y',
      outPath,
    ],
    { stdio: 'pipe' },
  );
  if (r.status !== 0 || !existsSync(outPath)) {
    throw new Error(
      `ffmpeg frame failed ${videoPath} @ ${t}s: ${r.stderr?.toString() || r.status}`,
    );
  }
}

function mid(a, b) {
  return (a + b) / 2;
}

function realFrameTimes(truth) {
  const { start, pi_end, peak, taper, end } = truth;
  const restT = start > 1.5 ? start * 0.45 : Math.max(0.3, start * 0.5);
  return [
    { phase: 'rest', t: restT },
    { phase: 'preinfusion', t: mid(start, pi_end) },
    { phase: 'ramp', t: mid(pi_end, peak) },
    { phase: 'peak', t: peak },
    { phase: 'taper', t: mid(taper, end) },
  ];
}

function evenlySpaced(duration, count) {
  if (count <= 1) return [duration * 0.5];
  const margin = Math.min(1, duration * 0.08);
  const lo = margin;
  const hi = Math.max(lo, duration - margin);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(lo + ((hi - lo) * i) / (count - 1));
  }
  return out;
}

function stemFromMp4(name) {
  return path.basename(name, '.mp4');
}

function main() {
  const truth = JSON.parse(readFileSync(TRUTH_PATH, 'utf8'));
  if (existsSync(OUT_DIR)) {
    for (const ent of readdirSync(OUT_DIR)) {
      if (ent === 'manifest.json') continue;
      rmSync(path.join(OUT_DIR, ent), { force: true });
    }
  } else {
    mkdirSync(OUT_DIR, { recursive: true });
  }

  const manifest = [];
  let seq = 0;

  const realFiles = readdirSync(REAL_DIR)
    .filter((f) => f.endsWith('.mp4'))
    .sort();
  for (const file of realFiles) {
    const stem = stemFromMp4(file);
    const key = `real_${stem}`;
    const phases = truth[key];
    if (!phases) throw new Error(`missing truth for ${key}`);
    const videoPath = path.join(REAL_DIR, file);
    const spread = realFrameTimes(phases).filter((p) => p.phase !== 'taper');
    for (const { phase, t } of spread) {
      seq += 1;
      const id = `f${String(seq).padStart(3, '0')}`;
      const outFile = `${id}.jpg`;
      extractJpeg(videoPath, t, path.join(OUT_DIR, outFile));
      manifest.push({ id, file: outFile, clip: stem, t, phase });
    }
  }

  const usedFiles = readdirSync(USED_DIR)
    .filter((f) => f.endsWith('.mp4'))
    .sort();
  for (const file of usedFiles) {
    const stem = stemFromMp4(file);
    const videoPath = path.join(USED_DIR, file);
    const dur = probeDuration(videoPath);
    const times = evenlySpaced(dur, 3);
    for (let i = 0; i < times.length; i++) {
      seq += 1;
      const id = `f${String(seq).padStart(3, '0')}`;
      const outFile = `${id}.jpg`;
      const phase = `used_${i + 1}`;
      extractJpeg(videoPath, times[i], path.join(OUT_DIR, outFile));
      manifest.push({ id, file: outFile, clip: stem, t: times[i], phase });
    }
  }

  for (const videoPath of DRY_CLIPS) {
    const stem = stemFromMp4(videoPath);
    const dur = probeDuration(videoPath);
    const times = evenlySpaced(dur, 1);
    for (let i = 0; i < times.length; i++) {
      seq += 1;
      const id = `f${String(seq).padStart(3, '0')}`;
      const outFile = `${id}.jpg`;
      const phase = `dry_${i + 1}`;
      extractJpeg(videoPath, times[i], path.join(OUT_DIR, outFile));
      manifest.push({ id, file: outFile, clip: stem, t: times[i], phase });
    }
  }

  for (const file of realFiles) {
    const stem = stemFromMp4(file);
    const key = `real_${stem}`;
    const phases = truth[key];
    if (!phases) throw new Error(`missing truth for ${key}`);
    const videoPath = path.join(REAL_DIR, file);
    const t = mid(phases.taper, phases.end);
    seq += 1;
    const id = `f${String(seq).padStart(3, '0')}`;
    const outFile = `${id}.jpg`;
    extractJpeg(videoPath, t, path.join(OUT_DIR, outFile));
    manifest.push({ id, file: outFile, clip: stem, t, phase: 'taper' });
  }

  writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`Wrote ${manifest.length} frames to ${OUT_DIR}`);
}

main();
