import { FLAIR_58_SCALE } from './gaugeConfig.js';

/** Design-only Flair 58 dial signature (not loaded from photos or manifest). */
const PROFILE_BINS = 72;

function tickBump(deg, spacing, width) {
  const phase = ((deg % spacing) + spacing) % spacing;
  const d = Math.min(phase, spacing - phase);
  return d <= width ? 1 : 0.15;
}

/**
 * Synthetic rim-edge prior for absolute dial registration.
 * Major ticks, espresso arc, and logo sector weights come from the printed dial layout.
 */
export function buildFlairCanonicalDialProfile() {
  const profile = new Float32Array(PROFILE_BINS);
  for (let i = 0; i < PROFILE_BINS; i += 1) {
    const deg = (i / PROFILE_BINS) * 360;
    let v = tickBump(deg, 30, 5);
    v += tickBump(deg, 7.5, 2) * 0.35;
    if (deg >= 205 && deg <= 285) v += 0.55;
    if (deg >= 295 || deg <= 25) v += 0.35;
    profile[i] = v;
  }
  return profile;
}

export function buildFlairCanonicalFaceProfile() {
  const profile = new Float32Array(PROFILE_BINS);
  for (let i = 0; i < PROFILE_BINS; i += 1) {
    const deg = (i / PROFILE_BINS) * 360;
    let v = 0.12;
    if (deg >= 215 && deg <= 275) v += 0.9;
    if (deg >= 300 || deg <= 15) v += 0.5;
    profile[i] = v;
  }
  return profile;
}

export const FLAIR_CANONICAL_DIAL_PROFILE = buildFlairCanonicalDialProfile();
export const FLAIR_CANONICAL_FACE_PROFILE = buildFlairCanonicalFaceProfile();

/**
 * On the registered dial, needle angle (relative to dial) at 0 bar — from printed scale layout.
 */
export const CANONICAL_ZERO_BAR_ANGLE_DEG = 225;

/** Stateless pressure session: zero from dial art, not rest calibration. */
export const FLAIR_STATELESS_SESSION = {
  zeroAngleDeg: CANONICAL_ZERO_BAR_ANGLE_DEG,
  ...FLAIR_58_SCALE,
};
