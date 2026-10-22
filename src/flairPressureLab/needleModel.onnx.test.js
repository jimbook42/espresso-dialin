/**
 * Node check: the exported needle model on a few synthetic registered crops.
 *   node src/flairPressureLab/needleModel.onnx.test.js
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { barToDialAngle } from './dialFaceTemplate.js';
import { wrapDelta } from './gaugeConfig.js';
import { renderNeedleCrop } from './needleCropRender.js';
import {
  NEEDLE_CONFIDENCE_MIN,
  NEEDLE_INPUT_SIZE,
  NEEDLE_MODEL_INPUT,
  NEEDLE_MODEL_OUTPUT,
  configureNeedleRuntime,
  decodeNeedleOutput,
  registeredAngleToBar,
  tensorFromRgba,
} from './needleModel.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modelPath = path.join(root, 'public/flair-pressure-lab/needle.onnx');
const BAR_TOLERANCE = 0.3;

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

const cases = [
  { seed: 900001, bar: 0 },
  { seed: 900002, bar: 1.5 },
  { seed: 900003, bar: 3.2 },
  { seed: 900004, bar: 5 },
  { seed: 900005, bar: 6.8 },
  { seed: 900006, bar: 8.4 },
  { seed: 900007, bar: 10 },
  { seed: 900008, bar: 4.2, residualDeg: 6 },
];

async function main() {
  assert.equal(fs.existsSync(modelPath), true, `missing ${modelPath}`);
  const bytes = fs.statSync(modelPath).size;
  assert.ok(bytes < 1_000_000, `model is ${bytes} bytes`);
  const ort = await import('onnxruntime-web/wasm');
  const wasmDir = path.dirname(require.resolve('onnxruntime-web'));
  configureNeedleRuntime(ort, `${pathToFileURL(wasmDir).href}/`);
  const modelBytes = new Uint8Array(fs.readFileSync(modelPath));
  const session = await ort.InferenceSession.create(modelBytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const timings = [];
  for (const item of cases) {
    const crop = renderNeedleCrop({
      seed: item.seed,
      bar: item.bar,
      clean: true,
      residualDeg: item.residualDeg ?? 0,
      aspect: 1,
    });
    const data = tensorFromRgba(crop.rgba, NEEDLE_INPUT_SIZE);
    const t0 = performance.now();
    const tensor = new ort.Tensor('float32', data, [1, 3, NEEDLE_INPUT_SIZE, NEEDLE_INPUT_SIZE]);
    const t1 = performance.now();
    const output = await session.run({ [NEEDLE_MODEL_INPUT]: tensor });
    const t2 = performance.now();
    timings.push({ prep: t1 - t0, infer: t2 - t1, total: t2 - t0 });
    const decoded = decodeNeedleOutput(output[NEEDLE_MODEL_OUTPUT].data);
    const expected = registeredAngleToBar(crop.angleDeg);
    const delta = Math.abs(wrapDelta(crop.angleDeg, decoded.angleDeg));
    const barError = Math.abs((decoded.bar ?? NaN) - expected);
    assert.equal(decoded.ok, true, `seed ${item.seed} confidence ${decoded.confidence}`);
    assert.ok(decoded.confidence >= NEEDLE_CONFIDENCE_MIN);
    assert.ok(
      barError < BAR_TOLERANCE,
      `seed ${item.seed} bar ${item.bar} read ${decoded.bar} expected ${expected} `
      + `(${delta.toFixed(2)}°, label ${crop.angleDeg.toFixed(2)} canon ${barToDialAngle(item.bar).toFixed(2)})`,
    );
  }
  const hidden = renderNeedleCrop({ seed: 900099, negative: true });
  const hiddenTensor = new ort.Tensor(
    'float32',
    tensorFromRgba(hidden.rgba),
    [1, 3, NEEDLE_INPUT_SIZE, NEEDLE_INPUT_SIZE],
  );
  const hiddenOut = await session.run({ [NEEDLE_MODEL_INPUT]: hiddenTensor });
  const hiddenDecoded = decodeNeedleOutput(hiddenOut[NEEDLE_MODEL_OUTPUT].data);
  assert.ok(
    hiddenDecoded.confidence < NEEDLE_CONFIDENCE_MIN,
    `negative confidence ${hiddenDecoded.confidence}`,
  );
  const totals = timings.map((row) => row.total);
  const median = percentile(totals, 50);
  console.log(JSON.stringify({
    bytes,
    medianMs: Number(median.toFixed(2)),
    maxMs: Number(Math.max(...totals).toFixed(2)),
    timings: timings.map((row) => ({
      prep: Number(row.prep.toFixed(2)),
      infer: Number(row.infer.toFixed(2)),
      total: Number(row.total.toFixed(2)),
    })),
  }));
  assert.ok(median < 33, `unthrottled median ${median.toFixed(1)} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
