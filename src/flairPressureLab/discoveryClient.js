/**
 * Full-frame dial search off the main thread.
 * The bitmap is transferred and closed. Nothing is stored or sent.
 * The worker is created on the first search and stays same-origin.
 */

let worker = null;
let inflight = false;
let latest = null;
let broken = false;

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./discoveryWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
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
