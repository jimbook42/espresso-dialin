/**
 * Full-frame dial search off the main thread.
 * One search is in flight. A newer frame replaces the one waiting, so the
 * worker always continues from the latest pixels. Nothing is stored or sent.
 */

let worker = null;
let inflight = false;
let broken = false;
let warmPromise = null;
let inflightPromise = Promise.resolve();
let settleResolve = null;
let pending = null;
let completed = null;
let videoSerial = 0;
const warmWaiters = [];

function finishInflight() {
  inflight = false;
  const resolve = settleResolve;
  settleResolve = null;
  if (resolve) resolve();
}

function armInflight() {
  inflight = true;
  inflightPromise = new Promise((resolve) => {
    settleResolve = resolve;
  });
}

/** Resolves when the worker is not holding a frame. */
export function whenDiscoverySettled() {
  return inflightPromise;
}

function takePixels(image) {
  const pixels = image.data;
  const whole = pixels.byteOffset === 0 && pixels.byteLength === pixels.buffer.byteLength;
  if (whole) return { kind: 'pixels', pixels, width: image.width, height: image.height };
  const copy = new Uint8ClampedArray(pixels.length);
  copy.set(pixels);
  return { kind: 'pixels', pixels: copy, width: image.width, height: image.height };
}

function postPendingNow(item) {
  armInflight();
  try {
    if (item.kind === 'bitmap') {
      ensureWorker().postMessage({
        bitmap: item.bitmap,
        width: item.width,
        height: item.height,
      }, [item.bitmap]);
      return true;
    }
    ensureWorker().postMessage({
      pixels: item.pixels,
      width: item.width,
      height: item.height,
    }, [item.pixels.buffer]);
    return true;
  } catch {
    if (item.bitmap && typeof item.bitmap.close === 'function') item.bitmap.close();
    completed = { found: null };
    finishInflight();
    return false;
  }
}

function startPending() {
  if (inflight || completed || !pending || broken) return;
  const next = pending;
  pending = null;
  postPendingNow(next);
}

function publish(found) {
  completed = { found: found ?? null };
  finishInflight();
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
      console.error('discovery worker', event.data.message || 'failed');
      publish(null);
      return;
    }
    publish(event.data?.found ?? null);
  };
  worker.onerror = () => {
    publish(null);
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

/**
 * A finished search, including a miss (`found: null`).
 * `ready: false` means the worker has not finished one since the last take.
 */
export function consumeDiscoveryResult() {
  if (!completed) return { ready: false, found: null };
  const result = completed;
  completed = null;
  startPending();
  return { ready: true, found: result.found };
}

export function takeDiscoveryResult() {
  return consumeDiscoveryResult().found;
}

/** True while a search is running or a frame is still waiting on that search. */
export function discoverySearchPending() {
  return inflight || pending != null;
}

function park(item) {
  if (pending?.bitmap && typeof pending.bitmap.close === 'function') pending.bitmap.close();
  pending = item;
}

/** Pixels already read on the main thread. The buffer is transferred when the search starts. */
export function requestImageDiscovery(image) {
  if (broken || typeof Worker === 'undefined') return false;
  if (!image?.data || !image.width || !image.height) return false;
  const owned = takePixels(image);
  if (inflight || completed) {
    park(owned);
    return true;
  }
  if (pending) {
    park(owned);
    startPending();
    return true;
  }
  return postPendingNow(owned);
}

/**
 * Hand a canvas or video to the worker. The search starts before the bitmap is
 * copied, so a waiter blocks until Hough finishes. The main thread does not read pixels.
 */
export function requestCanvasDiscovery(source, width, height) {
  if (broken || typeof Worker === 'undefined' || typeof createImageBitmap !== 'function') return false;
  if (!source || !width || !height) return false;
  if (inflight || completed) return true;
  armInflight();
  createImageBitmap(source).then((bitmap) => {
    try {
      ensureWorker().postMessage({ bitmap, width, height }, [bitmap]);
    } catch {
      if (typeof bitmap.close === 'function') bitmap.close();
      publish(null);
    }
  }).catch(() => publish(null));
  return true;
}

/** @returns {boolean} true when the main thread should not also search this frame */
export function requestVideoDiscovery(video) {
  if (broken || typeof Worker === 'undefined' || typeof createImageBitmap !== 'function') return false;
  if (!video?.videoWidth || !video?.videoHeight) return false;
  const width = video.videoWidth;
  const height = video.videoHeight;
  const serial = ++videoSerial;
  const busy = inflight || completed || pending;
  createImageBitmap(video).then((bitmap) => {
    if (serial !== videoSerial) {
      bitmap.close?.();
      return;
    }
    const item = { kind: 'bitmap', bitmap, width, height };
    if (inflight || completed || pending) park(item);
    else postPendingNow(item);
  }).catch(() => {
    if (serial !== videoSerial) return;
    if (!busy) publish(null);
  });
  return true;
}
