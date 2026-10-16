/**
 * Full-frame dial search off the main thread.
 * The bitmap is transferred and closed. Nothing is stored or sent.
 * The worker is created on the first search and stays same-origin.
 */

let worker = null;
let inflight = false;
let latest = null;
let broken = false;
let warmPromise = null;
let inflightPromise = Promise.resolve();
let settleResolve = null;
const warmWaiters = [];

function finishInflight() {
  inflight = false;
  const resolve = settleResolve;
  settleResolve = null;
  if (resolve) resolve();
}

/** Resolves when the worker is not holding a frame. Replay awaits this between samples. */
export function whenDiscoverySettled() {
  return inflightPromise;
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./discoveryWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    if (event.data?.warmup) {
      const waiters = warmWaiters.splice(0);
      waiters.forEach((resolve) => resolve(true));
      return;
    }
    if (event.data?.failed) {
      broken = true;
      latest = null;
      console.error('discovery worker', event.data.message || 'failed');
      finishInflight();
      return;
    }
    latest = event.data?.found ?? null;
    finishInflight();
  };
  worker.onerror = () => {
    latest = null;
    finishInflight();
  };
  return worker;
}

/**
 * Load OpenCV in the worker before the camera starts.
 * Resolves false when there is no worker (tests, or a broken thread).
 */
export function whenDiscoveryWarmed() {
  if (broken || typeof Worker === 'undefined') return Promise.resolve(false);
  if (!warmPromise) {
    warmPromise = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 20000);
      warmWaiters.push((ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
      try {
        ensureWorker().postMessage({ warmup: true });
      } catch {
        broken = true;
        clearTimeout(timer);
        resolve(false);
      }
    });
  }
  return warmPromise;
}

/** Load OpenCV before the first frame so the first search is not the warm-up. */
export function warmDiscoveryWorker() {
  void whenDiscoveryWarmed();
}

export function takeDiscoveryResult() {
  const found = latest;
  latest = null;
  return found;
}

/** Pixels already read on the main thread. The buffer is transferred. */
export function requestImageDiscovery(image) {
  if (broken || typeof Worker === 'undefined') return false;
  if (!image?.data || !image.width || !image.height) return false;
  if (inflight) return true;
  inflight = true;
  inflightPromise = new Promise((resolve) => {
    settleResolve = resolve;
  });
  const pixels = image.data;
  const buffer = pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength);
  try {
    ensureWorker().postMessage({
      pixels: buffer,
      width: image.width,
      height: image.height,
    }, [buffer]);
  } catch {
    latest = null;
    finishInflight();
    return false;
  }
  return true;
}

/** @returns {boolean} true when the main thread should not also search this frame */
export function requestVideoDiscovery(video) {
  if (broken || typeof Worker === 'undefined' || typeof createImageBitmap !== 'function') return false;
  if (!video?.videoWidth || !video?.videoHeight) return false;
  if (inflight) return true;
  const width = video.videoWidth;
  const height = video.videoHeight;
  inflight = true;
  inflightPromise = new Promise((resolve) => {
    settleResolve = resolve;
  });
  createImageBitmap(video).then((bitmap) => {
    ensureWorker().postMessage({ bitmap, width, height }, [bitmap]);
  }).catch(() => {
    latest = null;
    finishInflight();
  });
  return true;
}
