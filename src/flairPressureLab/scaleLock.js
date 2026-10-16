import { wrap360, wrapDelta } from './gaugeConfig.js';

/**
 * In-plane rotation of a locked printed face.
 *
 * The first confident colour registration is the scale. Later frames do not
 * search the whole circle again. They measure how far the face/ring profile
 * moved since the previous locked frame and add that delta to the template.
 * A large step, or a run of weak profiles, drops the lock. While the lock is
 * down, nothing is published until a full registration succeeds.
 */

/** One profile bin is 5°. A frame-to-frame step past this is not tracking. */
export const SCALE_LOCK_MAX_DELTA_DEG = 20;
/** A flat annulus has no centroid. Below this the face is not a dial. */
export const SCALE_LOCK_MIN_CONCENTRATION = 0.45;
/** Sub-degree centroid noise is not motion. */
const QUIET_DELTA_DEG = 1;
/** Weak frames may keep the last lock. A longer miss re-registers. */
const LOCK_MISS_LIMIT = 3;

export function faceProfileFromBands(bands) {
  if (!bands?.red?.length) return null;
  const n = bands.red.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = (bands.red[i] || 0) + 0.25 * (bands.dark?.[i] || 0);
  }
  return out;
}

function circularCentroid(profile) {
  if (!profile?.length) return null;
  const step = 360 / profile.length;
  let sin = 0;
  let cos = 0;
  let mass = 0;
  for (let i = 0; i < profile.length; i += 1) {
    const weight = profile[i];
    if (weight <= 0) continue;
    const rad = ((i * step) * Math.PI) / 180;
    sin += weight * Math.sin(rad);
    cos += weight * Math.cos(rad);
    mass += weight;
  }
  if (mass < 1e-3) return null;
  return {
    deg: wrap360((Math.atan2(sin, cos) * 180) / Math.PI),
    concentration: Math.hypot(sin, cos) / mass,
    mass,
  };
}

/**
 * Clockwise degrees to take `reference` onto `current`.
 * Both profiles are image-angle histograms of the same face.
 */
export function estimateRotationDelta(reference, current) {
  const empty = { ok: false, deltaDeg: 0, confidence: 0, periodMargin: 0 };
  const from = circularCentroid(reference);
  const to = circularCentroid(current);
  if (!from || !to) return empty;
  const confidence = Math.min(from.concentration, to.concentration);
  const deltaDeg = wrapDelta(from.deg, to.deg);
  const ok = confidence >= SCALE_LOCK_MIN_CONCENTRATION && from.mass >= 0.2 && to.mass >= 0.2;
  return {
    ok,
    deltaDeg,
    confidence,
    periodMargin: confidence,
  };
}

function tracked(lock, extra = {}) {
  return {
    mode: 'track',
    registered: true,
    needsFull: false,
    rotationDeg: lock.rotationDeg,
    confidence: lock.confidence ?? 0,
    periodMargin: lock.periodMargin ?? 0,
    lock,
    ...extra,
  };
}

/**
 * @param {object|null} lock
 * @param {{ profile?: Float32Array|null, fullRegistration?: object|null|undefined }} measurement
 * `fullRegistration === undefined` means the caller has not tried a full search yet.
 */
export function stepScaleLock(lock, { profile = null, fullRegistration, qualityHold = false } = {}) {
  const unlocked = {
    mode: 'unlocked',
    registered: false,
    needsFull: false,
    rotationDeg: 0,
    confidence: 0,
    periodMargin: 0,
    lock: null,
  };
  // A readable face still moves the lock during blur. A washed-out face, or a
  // wild jump on a bad frame, keeps the last registration instead of unlocking.
  if (qualityHold && lock?.profile && (!profile || profile.length !== lock.profile.length)) {
    return tracked({ ...lock, misses: lock.misses ?? 0 });
  }
  if (lock?.profile && profile && lock.profile.length === profile.length) {
    const delta = estimateRotationDelta(lock.profile, profile);
    const step = Math.abs(delta.deltaDeg);
    const tooFar = delta.ok && step > SCALE_LOCK_MAX_DELTA_DEG;
    if (delta.ok && !tooFar) {
      const applied = step < QUIET_DELTA_DEG ? 0 : delta.deltaDeg;
      const rotationDeg = wrap360(lock.rotationDeg + applied);
      return tracked({
        rotationDeg,
        profile,
        confidence: delta.confidence,
        periodMargin: Math.max(delta.periodMargin, lock.periodMargin ?? 0),
        misses: 0,
      });
    }
    if (qualityHold) {
      return tracked({ ...lock, misses: lock.misses ?? 0 });
    }
    if (!tooFar) {
      const misses = (lock.misses ?? 0) + 1;
      if (misses < LOCK_MISS_LIMIT) {
        return tracked({ ...lock, misses });
      }
    }
  }
  if (fullRegistration === undefined) {
    return { ...unlocked, needsFull: true, rotationDeg: lock?.rotationDeg ?? 0 };
  }
  if (fullRegistration?.ok && profile) {
    return {
      mode: 'register',
      registered: true,
      needsFull: false,
      rotationDeg: fullRegistration.rotationDeg,
      confidence: fullRegistration.confidence ?? 0,
      periodMargin: fullRegistration.periodMargin ?? 0,
      lock: {
        rotationDeg: fullRegistration.rotationDeg,
        profile,
        confidence: fullRegistration.confidence ?? 0,
        periodMargin: fullRegistration.periodMargin ?? 0,
        misses: 0,
      },
    };
  }
  return unlocked;
}
