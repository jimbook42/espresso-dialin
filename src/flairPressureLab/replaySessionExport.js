/**
 * In-memory per-frame export for the Playwright replay harness only.
 * Module singleton so React StrictMode remounts do not drop captured frames.
 */

let sessionStartMs = null;
let openSearchIndex = null;
const frames = [];

function resetFrames() {
  sessionStartMs = null;
  openSearchIndex = null;
  frames.length = 0;
}

function markSessionStart(t = performance.now()) {
  if (sessionStartMs == null) sessionStartMs = t;
}

function pushFrame(row) {
  if (sessionStartMs == null) sessionStartMs = row.t ?? performance.now();
  const timeS = Math.max(0, ((row.t ?? performance.now()) - sessionStartMs) / 1000);
  frames.push({ ...row, timeS });
}

function snapshotFrames() {
  return frames.slice();
}

export function createReplaySessionExport() {
  return {
    reset: resetFrames,
    markSessionStart,
    push: pushFrame,
    snapshot: snapshotFrames,
  };
}

export function pushPressureReplayFrame(row) {
  pushFrame(row);
}

/** Kept so a posted frame is obvious at the call site. Matching uses the row flag. */
export function markReplaySearchOpen() {
  if (openSearchIndex == null) openSearchIndex = frames.length - 1;
}

/**
 * The oldest frame that asked for a search receives this duration.
 * End-to-end becomes that frame's blocking time plus the worker.
 */
export function completeReplaySearch(searchMs) {
  if (searchMs == null) return;
  const index = frames.findIndex((row) => row.postedSearch && row.workerSearchMs == null);
  const row = index >= 0 ? frames[index] : null;
  openSearchIndex = null;
  if (!row) return;
  row.workerSearchMs = searchMs;
  row.e2eMs = (row.mainThreadMs || 0) + searchMs;
}

export function resetPressureReplaySession() {
  resetFrames();
}

export function installPressureReplayHook() {
  if (typeof window === 'undefined') return;
  window.__pressureLabReplay = {
    getFrames: snapshotFrames,
    reset: resetFrames,
  };
}
