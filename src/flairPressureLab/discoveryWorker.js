import { discoverGaugeInFrame } from './gaugeTrack.js';
import { setOpenCvForTests } from './opencvRuntime.js';

let cvReady = null;

function loadCv() {
  if (cvReady) return cvReady;
  cvReady = (async () => {
    const url = new URL('/flair-pressure-lab/opencv.js', self.location.origin).href;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`opencv ${response.status}`);
    const text = await response.text();
    // Classic build. Eval assigns globalThis.cv. The wasm blob is inside the file.
    (0, eval)(text);
    const cv = await globalThis.cv;
    if (!cv?.Mat) throw new Error('opencv has no Mat');
    setOpenCvForTests(cv);
    return cv;
  })();
  return cvReady;
}

self.onmessage = async (event) => {
  const { bitmap, pixels, width, height } = event.data || {};
  try {
    await loadCv();
    if (event.data?.warmup) {
      self.postMessage({ warmup: true });
      return;
    }
    let image = null;
    if (pixels && width && height) {
      const data = pixels instanceof Uint8ClampedArray ? pixels : new Uint8ClampedArray(pixels);
      image = { data, width, height };
    } else if (bitmap && width && height) {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      if (typeof bitmap.close === 'function') bitmap.close();
      image = context.getImageData(0, 0, width, height);
    }
    if (!image) {
      self.postMessage({ found: null });
      return;
    }
    const found = discoverGaugeInFrame(image);
    self.postMessage({ found });
  } catch (err) {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    self.postMessage({ found: null, failed: true, message: String(err?.message || err) });
  }
};
