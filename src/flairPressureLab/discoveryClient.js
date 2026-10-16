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
const warmWaiters = [];

/** Replay must not apply a discovery bitmap to a later frame. */
export function replayDiscoveryIsSync() {
  return import.meta.env?.VITE_PRESSURE_REPLAY === 'true';
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
    inflight = false;
    if (event.data?.failed) {
      broken = true;
      latest = null;
      console.error('discovery worker', event.data.message || 'failed');
      return;
    }
    latest = event.data?.found ?? null;
  };
  worker.onerror = () => {
    inflight = false;
    latest = null;
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

/** @returns {boolean} true when the main thread should not also search this frame */
export function requestVideoDiscovery(video) {
  if (broken || typeof Worker === 'undefined' || typeof createImageBitmap !== 'function') return false;
  if (!video?.videoWidth || !video?.videoHeight) return false;
  if (inflight) return true;
  const width = video.videoWidth;
  const height = video.videoHeight;
  inflight = true;
  createImageBitmap(video).then((bitmap) => {
    ensureWorker().postMessage({ bitmap, width, height }, [bitmap]);
  }).catch(() => {
    inflight = false;
  });
  return true;
}
