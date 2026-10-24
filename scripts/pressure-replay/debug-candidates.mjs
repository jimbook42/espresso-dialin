#!/usr/bin/env node
/**
 * Run lab OpenCV discovery on still frames; dump Hough candidates + overlay PNGs.
 * Usage: node debug-candidates.mjs [/tmp/631dbg] [previewPort]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { startPreviewServer, waitForServer } from '../lib/previewServer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frameDir = process.argv[2] || '/tmp/631dbg';
const port = Number(process.argv[3] || 4177);
const outDir = path.join(frameDir, 'candidates');

function listFrames(dir) {
  return fs.readdirSync(dir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

async function loadImageData(page, filePath) {
  const b64 = fs.readFileSync(filePath).toString('base64');
  const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  return page.evaluate(async ({ dataUrl }) => {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return {
      data: Array.from(imageData.data),
      width: imageData.width,
      height: imageData.height,
    };
  }, { dataUrl: `data:${mime};base64,${b64}` });
}

function svgOverlay(width, height, probe, truth = { x: 240, y: 355, r: 45 }) {
  const lines = probe.candidates.map((c, i) => {
    const stroke = c.ok ? '#4ade80' : '#f87171';
    const sw = c === probe.chosen ? 3 : 1.5;
    return `<circle cx="${c.cx}" cy="${c.cy}" r="${c.radius}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>
<text x="${c.cx + 4}" y="${c.cy - 4}" fill="${stroke}" font-size="11" font-family="monospace">${i}:r${c.radius.toFixed(0)} f${c.face.toFixed(2)}</text>`;
  });
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<circle cx="${truth.x}" cy="${truth.y}" r="${truth.r}" fill="none" stroke="#c88a4b" stroke-width="2" stroke-dasharray="4 3"/>
${lines.join('\n')}
</svg>`);
}

async function main() {
  if (!fs.existsSync(frameDir)) {
    console.error('missing frame dir', frameDir);
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const frames = listFrames(frameDir);
  if (!frames.length) {
    console.error('no frames in', frameDir);
    process.exit(2);
  }

  const preview = startPreviewServer(port);
  await waitForServer(preview.url);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${preview.url}#/flair-pressure-lab`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__pressureLabOpenCvReady === true, null, { timeout: 180_000 });

  const report = [];
  for (const file of frames) {
    const imageData = await loadImageData(page, file);
    const probe = await page.evaluate((payload) => {
      const { data, width, height } = payload;
      const u8 = new Uint8ClampedArray(data);
      return window.__pressureLabProbeDiscovery({ data: u8, width, height });
    }, imageData);

    const base = path.basename(file, path.extname(file));
    const jsonPath = path.join(outDir, `${base}.json`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(probe, null, 2)}\n`);

    const meta = await sharp(file).metadata();
    const overlay = svgOverlay(meta.width, meta.height, probe);
    const outPng = path.join(outDir, `${base}-overlay.png`);
    await sharp(file)
      .composite([{ input: overlay, top: 0, left: 0 }])
      .png()
      .toFile(outPng);

    const nearTruth = probe.candidates.filter(
      (c) => Math.hypot(c.cx - 240, c.cy - 355) < 50 && c.radius >= 35 && c.radius <= 65,
    );
    report.push({
      frame: base,
      houghCount: probe.houghCount,
      candidateCount: probe.candidates.length,
      chosen: probe.chosen
        ? {
          cx: probe.chosen.cx,
          cy: probe.chosen.cy,
          radius: probe.chosen.radius,
          face: probe.chosen.face,
          canonical: probe.chosen.canonical,
          ok: probe.chosen.ok,
        }
        : null,
      nearTrueDial: nearTruth.map((c) => ({
        cx: c.cx,
        cy: c.cy,
        radius: c.radius,
        face: c.face,
        canonical: c.canonical,
        rank: c.rank,
        ok: c.ok,
      })),
    });
    process.stderr.write(`probed ${base}: hough=${probe.houghCount} candidates=${probe.candidates.length}\n`);
  }

  fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  await preview.kill();
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
