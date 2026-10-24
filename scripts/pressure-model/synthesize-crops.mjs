/**
 * Paint train/val crops from the measured dial template.
 * Output stays under scripts/pressure-model/data and is gitignored.
 *
 *   node scripts/pressure-model/synthesize-crops.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../pressure-replay/syntheticLayout.js';
import { renderNeedleCrop } from '../../src/flairPressureLab/needleCropRender.js';
import { NEEDLE_INPUT_SIZE } from '../../src/flairPressureLab/needleModel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
const TRAIN_N = 8000;
const VAL_N = 1200;
const TRAIN_SEED0 = 1000;
const VAL_SEED0 = 50000;

function plan(seed) {
  // Separate stream from the crop renderer. Sharing `seed` made the first
  // draw both "not a negative" and the needle bar, so rest never appeared.
  const roll = mulberry32(Math.imul(seed, 0x9E3779B1) >>> 0)();
  if (roll < 0.12) return { seed, negative: true };
  if (roll < 0.46) return { seed, clean: true };
  return { seed };
}

function writeSplit(name, seed0, count) {
  const bytes = Buffer.alloc(count * NEEDLE_INPUT_SIZE * NEEDLE_INPUT_SIZE * 3);
  const angleDeg = new Array(count);
  const confidence = new Array(count);
  const easy = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const crop = renderNeedleCrop(plan(seed0 + i));
    const base = i * NEEDLE_INPUT_SIZE * NEEDLE_INPUT_SIZE;
    for (let p = 0; p < NEEDLE_INPUT_SIZE * NEEDLE_INPUT_SIZE; p += 1) {
      const s = p * 4;
      const d = (base + p) * 3;
      bytes[d] = crop.rgba[s];
      bytes[d + 1] = crop.rgba[s + 1];
      bytes[d + 2] = crop.rgba[s + 2];
    }
    angleDeg[i] = crop.angleDeg;
    confidence[i] = crop.confidence;
    easy[i] = crop.easy ? 1 : 0;
    if ((i + 1) % 1000 === 0) process.stderr.write(`${name} ${i + 1}/${count}\n`);
  }
  fs.writeFileSync(path.join(DATA, `${name}-images.bin`), bytes);
  fs.writeFileSync(path.join(DATA, `${name}-labels.json`), JSON.stringify({
    size: NEEDLE_INPUT_SIZE,
    count,
    angleDeg,
    confidence,
    easy,
  }));
}

fs.mkdirSync(DATA, { recursive: true });
const t0 = Date.now();
writeSplit('train', TRAIN_SEED0, TRAIN_N);
writeSplit('val', VAL_SEED0, VAL_N);
process.stderr.write(`wrote ${DATA} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
