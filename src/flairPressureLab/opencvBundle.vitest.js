import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('OpenCV lazy-load bundle layout', () => {
  it('ships self-hosted opencv.js outside the Vite JS chunks', () => {
    const asset = path.join(root, 'public/flair-pressure-lab/opencv.js');
    expect(existsSync(asset)).toBe(true);
    const raw = statSync(asset).size;
    expect(raw).toBeGreaterThan(5_000_000);
    const gzip = gzipSync(readFileSync(asset)).length;
    expect(gzip).toBeGreaterThan(2_000_000);
  });

  it('keeps HoughCircles and opencv script URL out of main entry chunks', () => {
    const assetsDir = path.join(root, 'dist/assets');
    if (!existsSync(assetsDir)) return;
    const needles = ['HoughCircles', 'flair-pressure-lab/opencv.js'];
    for (const file of readdirSync(assetsDir)) {
      if (!file.endsWith('.js')) continue;
      if (!/^index-|^App-/.test(file)) continue;
      const text = readFileSync(path.join(assetsDir, file), 'utf8');
      for (const needle of needles) {
        expect(text.includes(needle), `${file} must not embed ${needle}`).toBe(false);
      }
    }
  });

  it('loads OpenCV only from the pressure lab chunk when dist is present', () => {
    const assetsDir = path.join(root, 'dist/assets');
    if (!existsSync(assetsDir)) return;
    const labChunks = readdirSync(assetsDir).filter((f) => f.startsWith('FlairPressureLab-') && f.endsWith('.js'));
    expect(labChunks.length).toBeGreaterThan(0);
    const labText = readFileSync(path.join(assetsDir, labChunks[0]), 'utf8');
    expect(labText).toContain('flair-pressure-lab/opencv.js');
    expect(labText).toContain('HoughCircles');
  });
});
