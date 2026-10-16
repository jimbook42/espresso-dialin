#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loadPressureReplayManifest, resolveClipPath, selectClips } from './manifest.js';
import { compareReplayRuns, summarizeClipFrames } from './summary.js';
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

async function runPlaywrightClip({ y4mPath, mp4Path, durationS }) {
  await waitForMemory();
  const browserScript = path.join(__dirname, 'run-clip-browser.mjs');
  const out = await new Promise((resolve, reject) => {
    const chunks = [];
    const [browserCmd, browserArgs] = flockWrap(process.execPath, [
      browserScript,
      y4mPath,
      String(durationS),
      String(PREVIEW_PORT),
      mp4Path,
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
    '| Clip | Found % | Centre range | Within ±0.5 % | First (s) | No-read % | Bar range | Conflict med/max ° | Low-conf % | Blur % | Glare % | Conf-wrong % |',
    '| --- | ---: | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  const rows = summaries.map(({ id, summary }) => {
    const conflict = summary.conflictDegMedian == null
      ? '—'
      : `${summary.conflictDegMedian.toFixed(1)} / ${summary.conflictDegMax.toFixed(1)}`;
    return `| ${id} | ${summary.gaugeTrackedPct.toFixed(1)} | ${fmtCentreRange(summary.centreRange)} | ${summary.withinTolerancePct.toFixed(1)} | ${summary.timeToFirstValidReadingS?.toFixed(2) ?? '—'} | ${summary.noReadingRatePct.toFixed(1)} | ${fmtBarRange(summary.barRange)} | ${conflict} | ${summary.lowConfidencePct.toFixed(1)} | ${(summary.blurPct ?? 0).toFixed(1)} | ${(summary.glarePct ?? 0).toFixed(1)} | ${summary.confidentButWrongPct.toFixed(1)} |`;
  });
  return `${header.concat(rows).join('\n')}\n`;
}

async function processClip(clip, replayDir) {
  const mp4 = resolveClipPath(clip, replayDir);
  if (!fs.existsSync(mp4)) throw new Error(`missing clip ${mp4}`);
  const durationS = probeDurationS(mp4);
  const y4m = await ensureY4m(mp4);
  const { frames, privacy, timing } = await runPlaywrightClip({ y4mPath: y4m, mp4Path: mp4, durationS });
  const summary = {
    ...summarizeClipFrames(frames, clip),
    ...diagnoseReferenceCapture(frames),
    privacy,
    processMsThrottled4xMedian: timing?.throttled4xMedian ?? null,
    processMsThrottled4xP95: timing?.throttled4xP95 ?? null,
    e2eMedian: timing?.e2eMedian ?? null,
    e2eP95: timing?.e2eP95 ?? null,
    e2e4xMedian: timing?.e2e4xMedian ?? null,
    e2e4xP95: timing?.e2e4xP95 ?? null,
    mainMedian: timing?.mainMedian ?? null,
    mainP95: timing?.mainP95 ?? null,
    main4xMedian: timing?.main4xMedian ?? null,
    main4xP95: timing?.main4xP95 ?? null,
    framesProcessedPct: timing?.framesProcessedPct ?? null,
    framesProcessed4xPct: timing?.framesProcessed4xPct ?? null,
    longTasks: timing?.longTasks ?? null,
    longTasks4x: timing?.longTasks4x ?? null,
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
  return { id: clip.id, summary, annotated, outDir, frames };
}

function replayTwice(argv) {
  return argv.includes('--twice') || process.env.PRESSURE_REPLAY_REPEAT === '2';
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

  const twice = replayTwice(process.argv);
  const results = [];
  const determinism = [];
  for (const clip of clips) {
    process.stderr.write(`\n=== Replay ${clip.id} ===\n`);
    const first = await processClip(clip, process.env.FLAIR_REPLAY_DIR);
    if (!twice) {
      results.push(first);
      continue;
    }
    fs.copyFileSync(
      path.join(first.outDir, 'frames.csv'),
      path.join(first.outDir, 'frames-pass1.csv'),
    );
    process.stderr.write(`\n=== Replay ${clip.id} (pass 2) ===\n`);
    const second = await processClip(clip, process.env.FLAIR_REPLAY_DIR);
    const diff = compareReplayRuns(first.frames, second.frames);
    determinism.push({ id: clip.id, diff, first: first.summary, second: second.summary });
    process.stderr.write(
      `determinism ${clip.id}: ${diff.identical ? 'match' : 'DIFF'} `
      + `frames ${diff.left}/${diff.right} barMismatch ${diff.barMismatch} `
      + `max|bar| ${diff.maxBarDelta.toFixed(3)} centreMismatch ${diff.centreMismatch}\n`,
    );
    results.push(second);
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
    'End-to-end is frame grab through the result being applied, including time waiting on the worker. Main-thread is that span minus the worker wait. Frames processed is slots that produced a row; none are dropped to improve the times.',
    '',
    '| Clip | Found % | ±0.5 % | Conf-wrong % | Frames % | E2E med | E2E p95 | E2E 4× med | E2E 4× p95 | Main med | Main p95 | Main 4× med | Main 4× p95 | Long tasks | Long tasks 4× |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...mergedResults.map(({ id, summary }) => {
      const num = (value) => (value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(1));
      return `| ${id} | ${summary.gaugeTrackedPct.toFixed(1)} | ${summary.withinTolerancePct.toFixed(1)} | ${summary.confidentButWrongPct.toFixed(1)} | ${num(summary.framesProcessedPct)} | ${num(summary.e2eMedian)} | ${num(summary.e2eP95)} | ${num(summary.e2e4xMedian)} | ${num(summary.e2e4xP95)} | ${num(summary.mainMedian)} | ${num(summary.mainP95)} | ${num(summary.main4xMedian)} | ${num(summary.main4xP95)} | ${summary.longTasks ?? '—'} | ${summary.longTasks4x ?? '—'} |`;
    }),
    '',
    '## Glare setup hint (frames)',
    '',
    'Shown only before a shot. During-shot count stays zero.',
    '',
    '| Clip | Pre-shot | During shot |',
    '| --- | ---: | ---: |',
    ...mergedResults.map(({ id, summary }) => `| ${id} | ${summary.glareHintPreShot ?? 0} | ${summary.glareHintDuringShot ?? 0} |`),
    '',
    '## Determinism (two consecutive replays)',
    '',
    twice
      ? [
        '| Clip | Match | Frames | Bar mismatches | Max |bar| | Centre mismatches |',
        '| --- | ---: | ---: | ---: | ---: | ---: |',
        ...determinism.map(({ id, diff }) => `| ${id} | ${diff.identical ? 'yes' : 'no'} | ${diff.left}/${diff.right} | ${diff.barMismatch} | ${diff.maxBarDelta.toFixed(3)} | ${diff.centreMismatch} |`),
      ].join('\n')
      : 'Not requested. Run with `PRESSURE_REPLAY_REPEAT=2` or `--twice`.',
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
