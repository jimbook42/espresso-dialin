/** Post-tare reading considered "zeroed" for anchor purposes. */
export const TARE_STABLE_MAX_G = 0.35;

/** Minimum time after Start before weight triggers (failed/slow tare). */
export const SHOT_WEIGHT_PRIME_SETTLE_MS = 400;

/**
 * @returns {{
 *   startBaselineG: number,
 *   postTareAnchorG: number | null,
 *   tareSucceeded: boolean,
 *   primed: boolean,
 *   primeStartedAtMs: number,
 * }}
 */
export function createShotWeightTracking() {
  return {
    startBaselineG: 0,
    postTareAnchorG: null,
    tareSucceeded: false,
    primed: false,
    primeStartedAtMs: 0,
    lastAcceptedLiveG: 0,
  };
}

/**
 * @param {ReturnType<typeof createShotWeightTracking>} state
 * @param {number} weightAtStartG
 * @param {number} [nowMs]
 */
export function beginShotWeightTracking(state, weightAtStartG, nowMs = Date.now()) {
  const start = Number(weightAtStartG);
  state.startBaselineG = Number.isFinite(start) ? start : 0;
  state.postTareAnchorG = null;
  state.tareSucceeded = false;
  state.primed = false;
  state.primeStartedAtMs = nowMs;
  state.lastAcceptedLiveG = state.startBaselineG;
}

/** @param {ReturnType<typeof createShotWeightTracking>} state @param {boolean} tareSucceeded */
export function noteShotTareOutcome(state, tareSucceeded) {
  state.tareSucceeded = tareSucceeded;
}

/**
 * @param {ReturnType<typeof createShotWeightTracking>} state
 * @param {number} liveG
 * @param {number} [nowMs]
 */
export function ingestShotWeightSample(state, liveG, nowMs = Date.now()) {
  const live = Number(liveG);
  if (!Number.isFinite(live)) return false;

  if (
    state.startBaselineG > TARE_STABLE_MAX_G
    && (state.tareSucceeded || state.postTareAnchorG != null)
    && Math.abs(live - state.startBaselineG) <= 0.5
  ) {
    return false;
  }

  state.lastAcceptedLiveG = live;

  if (state.tareSucceeded && state.postTareAnchorG == null && live <= TARE_STABLE_MAX_G) {
    state.postTareAnchorG = live;
  }

  if (!state.primed) {
    if (state.tareSucceeded) {
      if (state.postTareAnchorG != null) state.primed = true;
    } else if (nowMs - state.primeStartedAtMs >= SHOT_WEIGHT_PRIME_SETTLE_MS) {
      state.primed = true;
    }
  }
  return true;
}

/**
 * Mass added since Start for triggers and relative readout.
 *
 * @param {ReturnType<typeof createShotWeightTracking>} state
 * @param {number} liveG
 */
export function addedMassSinceStartG(state, liveG) {
  if (!weightTriggersReady(state)) return 0;
  const live = Number(state.lastAcceptedLiveG ?? liveG);
  if (!Number.isFinite(live)) return 0;

  if (state.tareSucceeded) {
    const anchor = state.postTareAnchorG ?? 0;
    return Math.max(0, live - anchor);
  }
  return Math.max(0, live - state.startBaselineG);
}

/** @param {ReturnType<typeof createShotWeightTracking>} state @param {number} [nowMs] */
export function weightTriggersReady(state, nowMs = Date.now()) {
  if (state.primed) return true;
  if (!state.tareSucceeded && nowMs - state.primeStartedAtMs >= SHOT_WEIGHT_PRIME_SETTLE_MS) {
    return true;
  }
  if (state.tareSucceeded && state.postTareAnchorG != null) {
    return true;
  }
  return false;
}

/** @deprecated Use addedMassSinceStartG */
export function shotStartWeightBaselineG(weightBeforeTareG, weightAfterTareG, tareSucceeded) {
  if (tareSucceeded) return weightAfterTareG;
  return weightBeforeTareG;
}

/** @deprecated Use addedMassSinceStartG */
export function relativeWeightG(liveWeightG, baselineG) {
  const live = Number(liveWeightG);
  const base = Number(baselineG);
  if (!Number.isFinite(live) || !Number.isFinite(base)) return 0;
  return Math.max(0, live - base);
}
