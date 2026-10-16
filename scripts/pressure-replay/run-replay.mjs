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
import { flockWrap } from './boxFlock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREVIEW_PORT = Number(process.env.PRESSURE_REPLAY_PORT || 4176);
const OUT_ROOT = process.env.FLAIR_REPLAY_OUT || '/workspace/flair-replay/out';
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
  const [wrappedCmd, wrappedArgs] = flockWrap(cmd, args);
  return new Promise((resolve, reject) => {
    const child = spawn(wrappedCmd, wrappedArgs, {
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

function y4mPathFor(mp4Path) {
  return mp4Path.replace(/\.mp4$/i, '.y4m');
}

async function ensureY4m(mp4Path) {
  const y4m = y4mPathFor(mp4Path);
  if (fs.existsSync(y4m)) return y4m;
  await waitForMemory();
  await runUnderFlock('ffmpeg', [
    '-y', '-i', mp4Path, '-pix_fmt', 'yuv420p', '-an', y4m,
  ]);
  return y4m;
}

async function runPlaywrightClip({ y4mPath, durationS }) {
  await waitForMemory();
  const browserScript = path.join(__dirname, 'run-clip-browser.mjs');
  const out = await new Promise((resolve, reject) => {
    const chunks = [];
    const [browserCmd, browserArgs] = flockWrap(process.execPath, [
      browserScript,
      y4mPath,
      String(durationS),
      String(PREVIEW_PORT),
    ]);
    const child = spawn(browserCmd, browserArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', (buf) => chunks.push(buf));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`browser replay exited ${code}`));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
  const parsed = JSON.parse(out);
  if (Array.isArray(parsed)) {
    return { frames: parsed, privacy: null, timing: null };
  }
  return {
    frames: parsed.frames ?? [],
    privacy: parsed.privacy ?? null,
    timing: parsed.timing ?? null,
  };
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
    referenceCapturedFrames: refYes,
    referenceCapturedFramePct: frames.length ? (refYes / frames.length) * 100 : 0,
    maxRimConfidence: maxRim,
    maxNeedleLikeness: maxLike,
    referenceCaptureFailure: failure,
  };
}

function fmtCentreRange(range) {
  if (!range) return '—';
  return `x ${range.minX.toFixed(0)}–${range.maxX.toFixed(0)}, y ${range.minY.toFixed(0)}–${range.maxY.toFixed(0)}`;
}

function fmtBarRange(range) {
  if (!range) return '—';
  return `${range.min.toFixed(2)}–${range.max.toFixed(2)}`;
}

function writeReportTable(summaries) {
  const header = [
    '| Clip | Gauge found % | Centre range (detected) | Ref frames | First valid (s) | No-read % | Bar range | Low-conf % | Conf-wrong % |',
    '| --- | ---: | --- | ---: | ---: | ---: | --- | ---: | ---: |',
  ];
  const rows = summaries.map(({ id, summary }) => {
    return `| ${id} | ${summary.gaugeTrackedPct.toFixed(1)} | ${fmtCentreRange(summary.centreRange)} | ${summary.referenceCapturedFrames ?? 0} | ${summary.timeToFirstValidReadingS?.toFixed(2) ?? '—'} | ${summary.noReadingRatePct.toFixed(1)} | ${fmtBarRange(summary.barRange)} | ${summary.lowConfidencePct.toFixed(1)} | ${summary.confidentButWrongPct.toFixed(1)} |`;
  });
  return `${header.concat(rows).join('\n')}\n`;
}

async function processClip(clip, replayDir) {
  const mp4 = resolveClipPath(clip, replayDir);
  if (!fs.existsSync(mp4)) throw new Error(`missing clip ${mp4}`);
  const durationS = probeDurationS(mp4);
  const y4m = await ensureY4m(mp4);
  const { frames, privacy, timing } = await runPlaywrightClip({ y4mPath: y4m, durationS });
  const summary = {
    ...summarizeClipFrames(frames, clip),
    ...diagnoseReferenceCapture(frames),
    privacy,
    processMsThrottled4xMedian: timing?.throttled4xMedian ?? null,
    processMsThrottled4xP95: timing?.throttled4xP95 ?? null,
  };
  const outDir = path.join(OUT_ROOT, clip.id);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'frames.csv'), framesToCsv(frames));
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const annotated = await writeAnnotatedFrames({
    frames,
    expectedBar: clip.expectedBar,
    videoPath: mp4,
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

  const results = [];
  for (const clip of clips) {
    process.stderr.write(`\n=== Replay ${clip.id} ===\n`);
    results.push(await processClip(clip, process.env.FLAIR_REPLAY_DIR));
  }

  const mergedResults = manifest.clips.map((clip) => {
    const fresh = results.find((r) => r.id === clip.id);
    if (fresh) return fresh;
    const summaryPath = path.join(OUT_ROOT, clip.id, 'summary.json');
    if (!fs.existsSync(summaryPath)) return null;
    return { id: clip.id, summary: JSON.parse(fs.readFileSync(summaryPath, 'utf8')) };
  }).filter(Boolean);

  const reportPath = path.join(OUT_ROOT, 'REPORT.md');
  const refNotes = fs.readFileSync(path.join(__dirname, 'REFERENCE_CAPTURE.md'), 'utf8');
  const intro = `# Pressure lab video replay — ${new Date().toISOString()}\n\n`;
  const body = [
    '## Harness isolation',
    '',
    'Expected bar values exist only in `scripts/pressure-replay/manifest.json` and are applied in Node after capture via `summarizeClipFrames`. No crop, centre prior, or per-clip framing — original 720p clips only.',
    '',
    '## Scoring',
    '',
    '`gaugeFound` is true when rim confidence ≥ 0.3 **and** the dial reference template has been captured (`referenceCaptured`). No guide-ring seed; poses come from whole-frame discovery + rim tracking.',
    '',
    '## Reference capture requirement (live app)',
    '',
    refNotes.split('\n').slice(2).join('\n'),
    '',
    writeReportTable(mergedResults),
    '',
    '## Timing (median / p95 ms per frame)',
    '',
    '| Clip | Normal med | Normal p95 | 4× CPU med | 4× CPU p95 |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...mergedResults.map(({ id, summary }) => `| ${id} | ${summary.processMsMedian?.toFixed(1) ?? '—'} | ${summary.processMsP95?.toFixed(1) ?? '—'} | ${summary.processMsThrottled4xMedian?.toFixed(1) ?? '—'} | ${summary.processMsThrottled4xP95?.toFixed(1) ?? '—'} |`),
    '',
    '## Privacy (per clip)',
    '',
    '| Clip | Passed | External reqs | Storage writes |',
    '| --- | ---: | ---: | ---: |',
    ...mergedResults.map(({ id, summary }) => {
      const p = summary.privacy;
      if (!p) return `| ${id} | — | — | — |`;
      return `| ${id} | ${p.passed ? 'yes' : 'no'} | ${p.externalRequestCount ?? 0} | ${p.storageWrites ?? 0} |`;
    }),
  ].join('\n');
  fs.writeFileSync(reportPath, `${intro}${body}`);
  process.stdout.write(`Wrote ${reportPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
