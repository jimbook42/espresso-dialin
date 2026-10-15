import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.join(__dirname, 'replayCrop.json');

export function loadReplayCropSpec(specPath = SPEC_PATH) {
  return JSON.parse(readFileSync(specPath, 'utf8'));
}

export function framedMp4Path(mp4Path) {
  return mp4Path.replace(/\.mp4$/i, '.framed.mp4');
}

export function ffmpegCropFilter(spec) {
  const { crop, output } = spec;
  return `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${output.w}:${output.h}`;
}
