#!/usr/bin/env node
/**
 * Corner preview clip/zoom proof: wrapper stays 80×112 at max zoom.
 * Run: node scripts/lab-corner-preview-crop-shot.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  CORNER_PREVIEW_BOX,
  cornerPreviewVideoStyle,
  dialCropFromPose,
} from '../src/flairPressureLab/labPressureCornerPreview.js';

const OUT_DIR = '/workspace/pl-state/lab-tap';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VIDEO_W = 1280;
const VIDEO_H = 720;
const crop = dialCropFromPose(900, 400, 35, VIDEO_W, VIDEO_H);
const style = cornerPreviewVideoStyle({
  videoW: VIDEO_W,
  videoH: VIDEO_H,
  boxW: CORNER_PREVIEW_BOX.w,
  boxH: CORNER_PREVIEW_BOX.h,
  crop,
  mirrored: false,
});

const html = `<!DOCTYPE html>
<html><head>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; width: 390px; height: 844px; background: #1a1816; }
  .wrap {
    box-sizing: border-box;
    position: fixed; bottom: 96px; right: 12px;
    width: ${CORNER_PREVIEW_BOX.w}px; height: ${CORNER_PREVIEW_BOX.h}px;
    overflow: hidden; border-radius: 8px; border: 1px solid #2e2b26;
  }
  video {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: ${style.objectFit};
    object-position: ${style.objectPosition};
    transform-origin: ${style.transformOrigin};
    transform: ${style.transform};
  }
</style>
</head><body>
  <div class="wrap" data-testid="lab-pressure-corner-preview">
    <video id="v" autoplay muted playsinline></video>
  </div>
  <script>
    const c = document.createElement('canvas');
    c.width = ${VIDEO_W}; c.height = ${VIDEO_H};
    const ctx = c.getContext('2d');
    const g = 48;
    for (let y = 0; y < c.height; y += g) {
      for (let x = 0; x < c.width; x += g) {
        ctx.fillStyle = (x + y) % (g * 2) === 0 ? '#c45c26' : '#2a6f4e';
        ctx.fillRect(x, y, g, g);
      }
    }
    ctx.fillStyle = '#f5e6c8';
    ctx.beginPath();
    ctx.arc(900, 400, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 6;
    ctx.stroke();
    document.getElementById('v').srcObject = c.captureStream(1);
  </script>
</body></html>`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  const box = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="lab-pressure-corner-preview"]');
    return { w: el.offsetWidth, h: el.offsetHeight };
  });

  const outPath = path.join(OUT_DIR, 'v4-corner-preview-zoom-390x844.png');
  await page.screenshot({ path: outPath, fullPage: false });
  await browser.close();

  process.stdout.write(
    `wrapper ${box.w.toFixed(1)}×${box.h.toFixed(1)}px zoom=${style.transform}\n`,
  );
  process.stdout.write(`wrote ${outPath}\n`);
  if (Math.abs(box.w - 80) > 0.5 || Math.abs(box.h - 112) > 0.5) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
