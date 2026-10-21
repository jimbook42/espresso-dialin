import { FLAIR_58_SCALE, wrapDelta } from './gaugeConfig.js';
import {
  barToDialAngle,
  CANONICAL_ZERO_BAR_ANGLE_DEG,
  ESPRESSO_SECTOR,
  STOP_SECTOR,
} from './dialFaceTemplate.js';

/** Design-only Flair 58 dial signature (not loaded from photos or manifest). */
const PROFILE_BINS = 72;
const BIN_DEG = 360 / PROFILE_BINS;
const BASELINE = 0.12;

function inSector(deg, startDeg, endDeg) {
  const span = ((endDeg - startDeg) % 360 + 360) % 360;
  const offset = ((deg - startDeg) % 360 + 360) % 360;
  return offset <= span;
}

function tickBump(deg, tickDeg, halfWidth, peak) {
  const d = Math.abs(wrapDelta(deg, tickDeg));
  if (d > halfWidth) return 0;
  return peak * (1 - d / halfWidth);
}

function scaleTickAngles() {
  const majors = [];
  for (let bar = FLAIR_58_SCALE.minBar; bar <= FLAIR_58_SCALE.maxBar; bar += 1) {
    majors.push(barToDialAngle(bar));
  }
  const minors = [];
  for (let bar = FLAIR_58_SCALE.minBar + 0.5; bar < FLAIR_58_SCALE.maxBar; bar += 1) {
    minors.push(barToDialAngle(bar));
  }
  return {
    majors,
    minors,
    startDeg: barToDialAngle(FLAIR_58_SCALE.minBar),
    endDeg: barToDialAngle(FLAIR_58_SCALE.maxBar),
    stopPinDeg: barToDialAngle(FLAIR_58_SCALE.minBar),
  };
}

/**
 * Synthetic rim-edge prior for absolute dial registration.
 * Minor ticks exist only on the printed 0–10 bar arc; nothing past 10 is scaled.
 */
export function buildFlairCanonicalDialProfile() {
  const profile = new Float32Array(PROFILE_BINS);
  const { majors, minors, startDeg, endDeg, stopPinDeg } = scaleTickAngles();
  for (let i = 0; i < PROFILE_BINS; i += 1) {
    const deg = i * BIN_DEG;
    let v = BASELINE;
    if (inSector(deg, startDeg, endDeg)) {
      v += 0.2;
      for (const tick of majors) v += tickBump(deg, tick, 4.5, 0.9);
      for (const tick of minors) v += tickBump(deg, tick, 2.2, 0.32);
      v += tickBump(deg, barToDialAngle(5), 5, 0.22);
      v += tickBump(deg, barToDialAngle(10), 5, 0.28);
    }
    v += tickBump(deg, stopPinDeg, 3, 0.45);
    profile[i] = v;
  }
  return profile;
}

/** Mid-face prior: Espresso block, STOP band, and numeral sectors from the template. */
export function buildFlairCanonicalFaceProfile() {
  const profile = new Float32Array(PROFILE_BINS);
  for (let i = 0; i < PROFILE_BINS; i += 1) {
    const deg = i * BIN_DEG;
    let v = BASELINE;
    if (inSector(deg, ESPRESSO_SECTOR.startDeg, ESPRESSO_SECTOR.endDeg)) v += 0.9;
    if (inSector(deg, STOP_SECTOR.startDeg, STOP_SECTOR.endDeg)) v += 0.5;
    v += tickBump(deg, barToDialAngle(5), 6, 0.18);
    v += tickBump(deg, barToDialAngle(10), 6, 0.18);
    profile[i] = v;
  }
  return profile;
}

export const FLAIR_CANONICAL_DIAL_PROFILE = buildFlairCanonicalDialProfile();
export const FLAIR_CANONICAL_FACE_PROFILE = buildFlairCanonicalFaceProfile();

export { CANONICAL_ZERO_BAR_ANGLE_DEG };

/** Stateless pressure session: zero from dial art, not rest calibration. */
export const FLAIR_STATELESS_SESSION = {
  zeroAngleDeg: CANONICAL_ZERO_BAR_ANGLE_DEG,
  ...FLAIR_58_SCALE,
};
