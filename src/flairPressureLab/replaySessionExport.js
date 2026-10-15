/**
 * In-memory per-frame export for the Playwright replay harness only.
 * Module singleton so React StrictMode remounts do not drop captured frames.
 */

let sessionStartMs = null;
const frames = [];

function resetFrames() {
  sessionStartMs = null;
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
