#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loadPressureReplayManifest, resolveClipPath, selectClips } from './manifest.js';
import { summarizeClipFrames } from './summary.js';
import { framesToCsv } from './framesCsv.js';
import { writeAnnotatedFrames } from './annotate.mjs';
import { ROOT } from '../lib/previewServer.mjs';
import { ffmpegCropFilter, framedMp4Path, loadReplayCropSpec } from './replayCrop.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREVIEW_PORT = Number(process.env.PRESSURE_REPLAY_PORT || 4176);
const OUT_ROOT = process.env.FLAIR_REPLAY_OUT || '/workspace/flair-replay/out';
const LOCK = '/tmp/box-test.lock';
const MIN_MEM_KB = 3 * 1024 * 1024;

function memAvailableKb() {
  const line = fs.readFileSync('/proc/meminfo', 'utf8').split('\n').find((l) => l.startsWith('MemAvailable:'));
  return line ? Number(line.split(/\s+/)[1]) : 0;
}

async function waitForMemory() {
  for (;;) {
    const avail = memAvailableKb();
    if (avail >= MIN_MEM_KB) return;
    process.stderr.write(`MemAvailable ${Math.round(avail / 1024)} MB < 3072 MB — waiting 15s\n`);
    await delay(15_000);
  }
}

function runUnderFlock(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('flock', ['-w', '900', LOCK, cmd, ...args], {
      stdio: 'inherit',
      cwd: opts.cwd || ROOT,
      env: opts.env || process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

function probeDurationS(videoPath) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath],
    { encoding: 'utf8' },
  ).trim();
  return Number(out) || 15;
}

function y4mPathFor(framedMp4Path) {
  return framedMp4Path.replace(/\.framed\.mp4$/i, '.framed.y4m');
}

async function ensureFramedMp4(mp4Path, cropSpec) {
  const framed = framedMp4Path(mp4Path);
  if (fs.existsSync(framed)) return framed;
  await waitForMemory();
  const vf = ffmpegCropFilter(cropSpec);
  await runUnderFlock('ffmpeg', [
    '-y', '-i', mp4Path, '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', framed,
  ]);
  return framed;
}

async function ensureY4m(framedMp4) {
  const y4m = y4mPathFor(framedMp4);
  if (fs.existsSync(y4m)) return y4m;
  await waitForMemory();
  await runUnderFlock('ffmpeg', [
    '-y', '-i', framedMp4, '-pix_fmt', 'yuv420p', '-an', y4m,
  ]);
  return y4m;
}

async function runPlaywrightClip({ y4mPath, durationS }) {
  await waitForMemory();
  const browserScript = path.join(__dirname, 'run-clip-browser.mjs');
  const out = await new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn(
      'flock',
      ['-w', '900', LOCK, process.execPath, browserScript, y4mPath, String(durationS), String(PREVIEW_PORT)],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    child.stdout.on('data', (buf) => chunks.push(buf));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`browser replay exited ${code}`));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
  return JSON.parse(out);
}

function diagnoseReferenceCapture(frames) {
  const rims = [];
  const likes = [];
  let refYes = 0;
  for (const frame of frames) {
    const flags = frame.flags || '';
    if (flags.includes('ref:yes')) refYes += 1;
    const rim = flags.match(/rim:([\d.]+)/);
    const like = flags.match(/like:([\d.]+)/);
    if (rim) rims.push(Number(rim[1]));
    if (like && like[1] !== 'na') likes.push(Number(like[1]));
  }
  const maxRim = rims.length ? Math.max(...rims) : null;
  const maxLike = likes.length ? Math.max(...likes) : null;
  let failure = null;
  if (!refYes) {
    if (maxLike != null && maxLike < 0.4) {
      failure = `needleLikeness peaked at ${maxLike.toFixed(3)} (< NEEDLE_LIKENESS_GATE 0.4)`;
    } else if (maxRim != null && maxRim < 0.3) {
      failure = `rimConfidence peaked at ${maxRim.toFixed(3)} (< CONFIDENCE_MIN 0.3)`;
    } else {
      failure = 'reference gate never met on the same frame (rim ≥ 0.3 and likeness ≥ 0.4)';
    }
  } else if (frames.every((f) => !f.bar && f.tracking === 'CALIBRATING')) {
    failure = 'reference captured but REST_STABLE_SAMPLES (6) rest calibration did not complete';
  }
  return {
    referenceCapturedFramePct: frames.length ? (refYes / frames.length) * 100 : 0,
    maxRimConfidence: maxRim,
    maxNeedleLikeness: maxLike,
    referenceCaptureFailure: failure,
  };
}

function writeReportTable(summaries) {
  const header = [
    '| Clip | Tracked % | Within ±tol % | Confident-wrong % | First valid (s) | No-read % | Bar σ | Max jump | Pass |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  const rows = summaries.map(({ id, summary }) => {
    const pass = summary.pass.overall ? 'yes' : 'no';
    return `| ${id} | ${summary.gaugeTrackedPct.toFixed(1)} | ${summary.withinTolerancePct.toFixed(1)} | ${summary.confidentButWrongPct.toFixed(1)} | ${summary.timeToFirstValidReadingS?.toFixed(2) ?? '—'} | ${summary.noReadingRatePct.toFixed(1)} | ${summary.barStabilityStdDev?.toFixed(3) ?? '—'} | ${summary.barStabilityMaxJump?.toFixed(3) ?? '—'} | ${pass} |`;
  });
  return `${header.concat(rows).join('\n')}\n`;
}

async function processClip(clip, replayDir, cropSpec) {
  const mp4 = resolveClipPath(clip, replayDir);
  if (!fs.existsSync(mp4)) throw new Error(`missing clip ${mp4}`);
  const framed = await ensureFramedMp4(mp4, cropSpec);
  const durationS = probeDurationS(framed);
  const y4m = await ensureY4m(framed);
  const frames = await runPlaywrightClip({ y4mPath: y4m, durationS });
  const summary = {
    ...summarizeClipFrames(frames, clip),
    ...diagnoseReferenceCapture(frames),
  };
  const outDir = path.join(OUT_ROOT, clip.id);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'frames.csv'), framesToCsv(frames));
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const annotated = await writeAnnotatedFrames({
    frames,
    expectedBar: clip.expectedBar,
    videoPath: framed,
    outDir,
  });
  return { id: clip.id, summary, annotated, outDir };
}

async function main() {
  const manifest = loadPressureReplayManifest();
  const filter = process.env.PRESSURE_REPLAY_CLIP || process.argv[2] || '';
  const clips = selectClips(manifest, filter || undefined);
  fs.mkdirSync(OUT_ROOT, { recursive: true });

  if (process.env.PRESSURE_REPLAY_SKIP_BUILD !== '1') {
    await waitForMemory();
    await runUnderFlock('npm', ['run', 'build'], {
      env: {
        ...process.env,
        VITE_ENABLE_PRESSURE_LAB: 'true',
        VITE_PRESSURE_REPLAY: 'true',
      },
    });
  }

  const cropSpecPath = path.join(__dirname, 'replayCrop.json');
  if (!fs.existsSync(cropSpecPath)) {
    await waitForMemory();
    await runUnderFlock(process.execPath, [path.join(__dirname, 'computeReplayCrop.mjs')]);
  }
  const cropSpec = loadReplayCropSpec(cropSpecPath);

  const results = [];
  for (const clip of clips) {
    process.stderr.write(`\n=== Replay ${clip.id} ===\n`);
    results.push(await processClip(clip, process.env.FLAIR_REPLAY_DIR, cropSpec));
  }

  const reportPath = path.join(OUT_ROOT, 'REPORT.md');
  const refNotes = fs.readFileSync(path.join(__dirname, 'REFERENCE_CAPTURE.md'), 'utf8');
  const intro = `# Pressure lab video replay — ${new Date().toISOString()}\n\n`;
  const isolation = [
    '## Harness isolation',
    '',
    'Expected bar values exist only in `scripts/pressure-replay/manifest.json` and are applied in Node after capture via `summarizeClipFrames`. The Vite replay build sets `VITE_PRESSURE_REPLAY` for export hooks only; manifest data is never sent to the browser or CV modules.',
    '',
    '## Replay framing',
    '',
    `Single ffmpeg crop for all clips (from reference frame geometry): crop ${cropSpec.crop.w}×${cropSpec.crop.h} at (${cropSpec.crop.x},${cropSpec.crop.y}) → ${cropSpec.output.w}×${cropSpec.output.h}. Source gauge estimate: (${cropSpec.sourceGauge.cx}, ${cropSpec.sourceGauge.cy}) r=${cropSpec.sourceGauge.radius}px.`,
    '',
    '## Reference capture requirement (live app)',
    '',
    refNotes.split('\n').slice(2).join('\n'),
    '',
  ].join('\n');
  fs.writeFileSync(reportPath, `${intro}${isolation}\n${writeReportTable(results)}`);
  process.stdout.write(`Wrote ${reportPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
