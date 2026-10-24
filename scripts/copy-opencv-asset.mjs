#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, '../node_modules/@techstark/opencv-js/dist/opencv.js');
const destDir = path.join(root, '../public/flair-pressure-lab');
const dest = path.join(destDir, 'opencv.js');

if (!fs.existsSync(src)) {
  console.error('copy-opencv-asset: missing', src);
  process.exit(1);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
const bytes = fs.statSync(dest).size;
console.log(`Copied OpenCV.js → public/flair-pressure-lab/opencv.js (${bytes} bytes)`);
