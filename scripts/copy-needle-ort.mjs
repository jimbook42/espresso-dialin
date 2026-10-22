#!/usr/bin/env node
/**
 * Self-host the single-thread WASM runtime next to the lab.
 * The browser must not fetch these from a CDN. Frames never go with them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, '../node_modules/onnxruntime-web/dist');
const destDir = path.join(root, '../public/flair-pressure-lab/ort');
const files = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
];

if (!fs.existsSync(srcDir)) {
  console.error('copy-needle-ort: missing', srcDir);
  process.exit(1);
}
fs.mkdirSync(destDir, { recursive: true });
for (const name of files) {
  const src = path.join(srcDir, name);
  if (!fs.existsSync(src)) {
    console.error('copy-needle-ort: missing', src);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(destDir, name));
  const bytes = fs.statSync(src).size;
  console.log(`Copied ${name} → public/flair-pressure-lab/ort/ (${bytes} bytes)`);
}
