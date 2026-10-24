import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { flockWrap } from './boxFlock.mjs';

function pickAnnotationFrames(frames, expectedBar) {
  const withGauge = frames.filter((f) => f.gaugeFound);
  const withBar = withGauge.filter((f) => f.bar != null && !Number.isNaN(f.bar));
  const best = withBar.reduce(
    (acc, f) => {
      const err = Math.abs(f.bar - expectedBar);
      if (!acc || err < acc.err) return { frame: f, err };
      return acc;
    },
    null,
  );
  const worst = withBar.reduce(
    (acc, f) => {
      const err = Math.abs(f.bar - expectedBar);
      if (!acc || err > acc.err) return { frame: f, err };
      return acc;
    },
    null,
  );
  const lost = frames.find((f) => !f.gaugeFound);
  const lowConf = withGauge.reduce(
    (acc, f) => {
      const q = f.confidence ?? 1;
      if (!acc || q < acc.q) return { frame: f, q };
      return acc;
    },
    null,
  );
  return {
    best: best?.frame ?? withBar[0] ?? frames[0],
    worst: worst?.frame ?? withBar[withBar.length - 1] ?? frames[0],
    lost: lost ?? frames[0],
    lowConfidence: lowConf?.frame ?? withGauge[0] ?? frames[0],
  };
}

function overlaySvg(frame, label) {
  const cx = frame.centreX ?? 0;
  const cy = frame.centreY ?? 0;
  const r = frame.radius ?? 40;
  const angle = frame.needleAngleDeg ?? 0;
  const rad = (angle * Math.PI) / 180;
  const nx = cx + r * 0.75 * Math.cos(rad);
  const ny = cy + r * 0.75 * Math.sin(rad);
  const barText = frame.bar != null ? `${Number(frame.bar).toFixed(2)} bar` : '—';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
  <text x="12" y="28" fill="#fff" font-size="22" font-family="sans-serif" stroke="#000" stroke-width="2">${label} · ${barText}</text>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#c88a4b" stroke-width="3"/>
  <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="#4ade80" stroke-width="3"/>
</svg>`);
}

function extractFramePng(videoPath, timeS, outPath) {
  const at = Number.isFinite(timeS) ? Math.max(0, timeS) : 0;
  const [ffmpegCmd, ffmpegArgs] = flockWrap('ffmpeg', [
    '-y', '-ss', String(at), '-i', videoPath, '-frames:v', '1', '-q:v', '2', outPath,
  ]);
  execFileSync(ffmpegCmd, ffmpegArgs, { stdio: 'pipe' });
  if (!fs.existsSync(outPath)) {
    throw new Error(`ffmpeg did not create ${outPath}`);
  }
}

export async function writeAnnotatedFrames({
  frames,
  expectedBar,
  videoPath,
  outDir,
}) {
  fs.mkdirSync(outDir, { recursive: true });
  const picks = pickAnnotationFrames(frames, expectedBar);
  const entries = [
    ['best', picks.best],
    ['worst-error', picks.worst],
    ['lost-gauge', picks.lost],
    ['low-confidence', picks.lowConfidence],
  ];
  const paths = {};
  for (const [name, frame] of entries) {
    if (!frame) continue;
    const rawPng = path.join(outDir, `${name}-raw.png`);
    const outPng = path.join(outDir, `${name}.png`);
    try {
      extractFramePng(videoPath, frame.timeS, rawPng);
    } catch (err) {
      process.stderr.write(`annotate ${name}: ${err.message}\n`);
      continue;
    }
    const meta = await sharp(rawPng).metadata();
    const svg = overlaySvg(
      {
        ...frame,
        centreX: frame.centreX ?? meta.width / 2,
        centreY: frame.centreY ?? meta.height / 2,
        radius: frame.radius ?? Math.min(meta.width, meta.height) * 0.2,
      },
      name,
    );
    await sharp(rawPng)
      .composite([{ input: svg, top: 0, left: 0 }])
      .png()
      .toFile(outPng);
    fs.unlinkSync(rawPng);
    paths[name] = outPng;
  }
  return paths;
}
