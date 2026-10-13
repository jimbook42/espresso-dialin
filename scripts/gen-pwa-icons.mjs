import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const publicDir = join(process.cwd(), 'public');
const bg = '#1a1714';

async function renderSvgToPng(svgPath, size, outPath, { fit = 'cover' } = {}) {
  const svg = readFileSync(svgPath);
  await sharp(svg, { density: 300 })
    .resize(size, size, { fit, background: bg })
    .png()
    .toFile(outPath);
}

async function maskableFromMaster() {
  const markSize = Math.round(512 * 0.59);
  const padding = Math.round((512 - markSize) / 2);
  const svg = readFileSync(join(publicDir, 'logo-master.svg'));
  const mark = await sharp(svg, { density: 300 }).resize(markSize, markSize).png().toBuffer();
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: bg },
  })
    .composite([{ input: mark, left: padding, top: padding }])
    .png()
    .toFile(join(publicDir, 'maskable-512.png'));
}

async function main() {
  await renderSvgToPng(join(publicDir, 'logo-master.svg'), 512, join(publicDir, 'icon-512.png'));
  await renderSvgToPng(join(publicDir, 'logo-master.svg'), 192, join(publicDir, 'icon-192.png'));
  await renderSvgToPng(join(publicDir, 'logo-master.svg'), 180, join(publicDir, 'apple-touch-icon.png'));
  await maskableFromMaster();
  await renderSvgToPng(join(publicDir, 'logo-small.svg'), 48, join(publicDir, 'icon-48.png'));
  await renderSvgToPng(join(publicDir, 'logo-small.svg'), 32, join(publicDir, 'favicon-32.png'));
  await renderSvgToPng(join(publicDir, 'logo-small.svg'), 16, join(publicDir, 'favicon-16.png'));
  console.log('PWA icons generated in public/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
