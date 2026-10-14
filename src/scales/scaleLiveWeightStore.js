/** @typedef {'shot' | 'stale' | 'hidden'} ShotWeightReadoutMode */

/**
 * @typedef {{
 *   liveWeightG: number,
 *   liveRelativeWeightG: number,
 *   weightTriggersPrimed: boolean,
 *   isConnected: boolean,
 *   connectStatus: string,
 * }} ScaleLiveWeightSnapshot
 */

const defaultSnapshot = () => ({
  liveWeightG: 0,
  liveRelativeWeightG: 0,
  weightTriggersPrimed: false,
  isConnected: false,
  connectStatus: 'idle',
});

let snapshot = defaultSnapshot();
const listeners = new Set();

export function getScaleLiveWeightSnapshot() {
  return snapshot;
}

export function subscribeScaleLiveWeight(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishScaleLiveWeight(patch) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

export function resetScaleLiveWeightStore() {
  snapshot = defaultSnapshot();
  listeners.forEach((listener) => listener());
}

/**
 * @param {{
 *   timerRunning: boolean,
 *   weightTriggersPrimed: boolean,
 *   liveRelativeWeightG: number,
 *   liveWeightG: number,
 *   isConnected: boolean,
 * }} input
 * @returns {{ visible: boolean, grams: number, mode: ShotWeightReadoutMode }}
 */
export function resolveShotWeightReadout({
  timerRunning,
  weightTriggersPrimed,
  liveRelativeWeightG,
  liveWeightG,
  isConnected,
}) {
  if (!isConnected) {
    return { visible: false, grams: 0, mode: 'hidden' };
  }
  const show =
    timerRunning || (Number.isFinite(liveWeightG) && liveWeightG > 0);
  if (!show) {
    return { visible: false, grams: 0, mode: 'hidden' };
  }
  const shotRelative = timerRunning && weightTriggersPrimed;
  return {
    visible: true,
    grams: shotRelative ? liveRelativeWeightG : liveWeightG,
    mode: shotRelative ? 'shot' : 'stale',
  };
}
