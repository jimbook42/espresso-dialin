import { FLAIR_STATELESS_SESSION } from './canonicalDial.js';
import {
  NEEDLE_LIKENESS_GATE,
  angleToBar,
  wrap360,
} from './gaugeConfig.js';

/**
 * Needle CNN on a rectified, rotation-registered face.
 * Weights stay on device (onnxruntime-web, WASM, one thread).
 * A frame crop is turned into a tensor for that run and then dropped.
 * Nothing here uploads, stores, or caches pixels.
 *
 * Geometry matches the printed dial (dialFaceTemplate / gaugeConfig) and the
 * crop the trainer paints in needleCropRender.js. The square reaches
 * NEEDLE_CROP_HALF_SCALE face-radii from the hub, inside the rectified
 * bitmap (faceRectify keeps about 1.08 radii to the edge).
 */

export const NEEDLE_INPUT_SIZE = 64;
export const NEEDLE_CROP_HALF_SCALE = 1.05;
/** Below this the needle is not a reading. The hold/gap path takes over. */
export const NEEDLE_CONFIDENCE_MIN = 0.6;
export const NEEDLE_MODEL_INPUT = 'face';
export const NEEDLE_MODEL_OUTPUT = 'needle';

const MODEL_FILE = 'needle.onnx';
const WASM_DIR = 'ort/';

let session = null;
let status = 'idle';
let loadPromise = null;

function assetBase() {
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  return `${base}flair-pressure-lab/`;
}

export function configureNeedleRuntime(ort, wasmPaths) {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  if (wasmPaths) ort.env.wasm.wasmPaths = wasmPaths;
}

/** Bar on the printed Flair scale for an angle in the registered crop. */
export function registeredAngleToBar(angleDeg) {
  return angleToBar(angleDeg, FLAIR_STATELESS_SESSION);
}

function bilinearRgb(data, width, height, x, y) {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return [0, 0, 0];
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const row0 = y0 * width;
  const row1 = y1 * width;
  const i00 = (row0 + x0) * 4;
  const i10 = (row0 + x1) * 4;
  const i01 = (row1 + x0) * 4;
  const i11 = (row1 + x1) * 4;
  const rgb = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    const v0 = data[i00 + c] * (1 - tx) + data[i10 + c] * tx;
    const v1 = data[i01 + c] * (1 - tx) + data[i11 + c] * tx;
    rgb[c] = v0 * (1 - ty) + v1 * ty;
  }
  return rgb;
}

/**
 * Registered face → NCHW float32 in [0, 1], shape 1×3×64×64 packed without the batch axis.
 * `rotationDeg` is the dial rotation still in the rectified image. Sampling undoes it.
 */
export function prepareRegisteredFace(image, cx, cy, radius, rotationDeg, size = NEEDLE_INPUT_SIZE) {
  const width = image?.width;
  const height = image?.height;
  const data = image?.data;
  const out = new Float32Array(3 * size * size);
  if (!data || !(width > 1) || !(height > 1) || !(radius > 1)) return out;
  const half = radius * NEEDLE_CROP_HALF_SCALE;
  const theta = ((rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const plane = size * size;
  for (let j = 0; j < size; j += 1) {
    const ly = ((j + 0.5) / size - 0.5) * 2 * half;
    for (let i = 0; i < size; i += 1) {
      const lx = ((i + 0.5) / size - 0.5) * 2 * half;
      const x = cx + cos * lx - sin * ly;
      const y = cy + sin * lx + cos * ly;
      const rgb = bilinearRgb(data, width, height, x, y);
      const o = j * size + i;
      out[o] = rgb[0] / 255;
      out[plane + o] = rgb[1] / 255;
      out[2 * plane + o] = rgb[2] / 255;
    }
  }
  return out;
}

/** Same layout as prepareRegisteredFace, for a crop that is already the model square. */
export function tensorFromRgba(rgba, size = NEEDLE_INPUT_SIZE) {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    const p = i * 4;
    out[i] = rgba[p] / 255;
    out[plane + i] = rgba[p + 1] / 255;
    out[2 * plane + i] = rgba[p + 2] / 255;
  }
  return out;
}

export function decodeNeedleOutput(values) {
  const sin = values?.[0] ?? 0;
  const cos = values?.[1] ?? 0;
  const logit = values?.[2] ?? -8;
  const confidence = 1 / (1 + Math.exp(-logit));
  const angleDeg = wrap360((Math.atan2(sin, cos) * 180) / Math.PI);
  const bar = registeredAngleToBar(angleDeg);
  const ok = confidence >= NEEDLE_CONFIDENCE_MIN && bar != null;
  return { angleDeg, confidence, bar, ok };
}

/**
 * A confident model replaces the classical angle.
 * A loaded model that is not confident clears the angle so the lab holds, then gaps.
 * Call this only after the weights loaded. A failed load leaves the classical reading alone.
 */
export function applyNeedleModelReading(reading, prediction) {
  if (!reading || !prediction) return reading;
  const model = {
    used: false,
    confidence: prediction.confidence ?? 0,
    prepMs: prediction.prepMs ?? null,
    inferMs: prediction.inferMs ?? null,
    ms: prediction.ms ?? null,
    bar: null,
  };
  reading.model = model;
  if (!prediction.ok) {
    reading.quality = 0;
    reading.likeness = 0;
    reading.hub = 0;
    reading.relativeAngleDeg = null;
    return reading;
  }
  const rotation = reading.gauge?.rotationDeg ?? 0;
  reading.relativeAngleDeg = prediction.angleDeg;
  reading.angleDeg = wrap360(prediction.angleDeg + rotation);
  reading.quality = prediction.confidence;
  reading.likeness = Math.max(prediction.confidence, NEEDLE_LIKENESS_GATE);
  reading.hub = 1;
  reading.peak = prediction.confidence;
  model.used = true;
  model.bar = prediction.bar;
  return reading;
}

export function isNeedleModelReady() {
  return status === 'ready' && session != null;
}

export function needleModelStatus() {
  return status;
}

/**
 * Lazy load. Only the pressure lab should call this.
 * A failure stays failed and the classical reader keeps running.
 */
export function loadNeedleModel() {
  if (status === 'ready') return Promise.resolve(session);
  if (status === 'failed') return Promise.resolve(null);
  if (!loadPromise) {
    status = 'loading';
    loadPromise = (async () => {
      const ort = await import('onnxruntime-web/wasm');
      const base = assetBase();
      configureNeedleRuntime(ort, `${base}${WASM_DIR}`);
      session = await ort.InferenceSession.create(`${base}${MODEL_FILE}`, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      status = 'ready';
      return session;
    })().catch(() => {
      session = null;
      status = 'failed';
      return null;
    });
  }
  return loadPromise;
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/**
 * Run the loaded model on a rectified face. Returns null when the weights are absent
 * so the caller keeps the classical needle.
 */
export async function predictRegisteredNeedle(face) {
  if (!isNeedleModelReady() || !face?.image) return null;
  const t0 = nowMs();
  const data = prepareRegisteredFace(
    face.image,
    face.cx,
    face.cy,
    face.radius,
    face.rotationDeg,
  );
  const t1 = nowMs();
  const ort = await import('onnxruntime-web/wasm');
  const tensor = new ort.Tensor('float32', data, [1, 3, NEEDLE_INPUT_SIZE, NEEDLE_INPUT_SIZE]);
  const output = await session.run({ [NEEDLE_MODEL_INPUT]: tensor });
  const t2 = nowMs();
  const decoded = decodeNeedleOutput(output[NEEDLE_MODEL_OUTPUT]?.data);
  return {
    ...decoded,
    prepMs: t1 - t0,
    inferMs: t2 - t1,
    ms: t2 - t0,
  };
}
