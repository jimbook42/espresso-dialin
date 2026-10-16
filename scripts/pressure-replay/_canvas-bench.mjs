import fs from 'node:fs';
import { chromium } from 'playwright';

const png = fs.readFileSync('/tmp/pressure-frames-png-20261015_225219/0030.png').toString('base64');
const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();
const client = await page.context().newCDPSession(page);
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const result = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const dst = document.createElement('canvas');
  dst.width = 188;
  dst.height = 188;
  const ctx = dst.getContext('2d', { willReadFrequently: true });
  const time = (fn, n = 30) => {
    const samples = [];
    for (let i = 0; i < n; i += 1) {
      const t0 = performance.now();
      fn();
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    return { med: samples[Math.floor(n / 2)], p95: samples[Math.floor(n * 0.95)] };
  };
  const draw = () => ctx.drawImage(img, 140, 280, 213, 213, 0, 0, 188, 188);
  const read = () => ctx.getImageData(0, 0, 188, 188);
  draw();
  const readOnly = time(read);
  const drawAndRead = time(() => { draw(); read(); });
  const off = new OffscreenCanvas(188, 188);
  const octx = off.getContext('2d', { willReadFrequently: true });
  const offscreen = time(() => {
    octx.drawImage(img, 140, 280, 213, 213, 0, 0, 188, 188);
    octx.getImageData(0, 0, 188, 188);
  });
  ctx.imageSmoothingEnabled = false;
  const nearest = time(() => { draw(); read(); });
  return { readOnly, drawAndRead, offscreen, nearest, w: img.naturalWidth, h: img.naturalHeight };
}, png);
console.log(JSON.stringify(result, null, 2));
await browser.close();
