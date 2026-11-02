/** Export-only session evidence. Never written to shot/settings/replay databases.
 * Retain only the latest committed replay; a page reload explicitly loses it. */
let latest = null;
import { SHOT_REPLAY_MAX_DURATION_S } from './shotReplayRecorder.js';
const clone = value => JSON.parse(JSON.stringify(value, (_key, entry) =>
  ArrayBuffer.isView(entry) ? Array.from(entry) : entry));

export function calibrationEvidence(calibration, atSec) {
  if (!calibration) return null;
  const {hub, five, ten, radius, colorRadius, rotationDeg, zeroAngleDeg,
    fiveAngleDeg, tenAngleDeg, spanDeg, userPlaced, legacyScale, template,
    needleTemplate} = calibration;
  return clone({atSec, hub, five, ten, radius, colorRadius, rotationDeg,
    zeroAngleDeg, fiveAngleDeg, tenAngleDeg, spanDeg,
    userPlaced: userPlaced === true, placement: userPlaced ? 'user-placed' : 'snapped',
    legacyScale: legacyScale === true, template, needleTemplate});
}

export function createLabReplayDiagnostics() {
  let frames = [], calibrations = [], previousCalibration = null;
  return {
    reset() { frames = []; calibrations = []; previousCalibration = null; },
    push(frame) {
      if (!Number.isFinite(frame.tS) || frame.tS < 0 || frame.tS > SHOT_REPLAY_MAX_DURATION_S) return;
      if (frame.calibration && frame.calibration !== previousCalibration) {
        calibrations.push(calibrationEvidence(frame.calibration, frame.tS));
        previousCalibration = frame.calibration;
      }
      frames.push({tS: frame.tS, capturedAtSec: frame.capturedAtSec ?? null,
        measuredAtSec: frame.measuredAtSec ?? null,
        status: frame.fresh ? 'fresh' : frame.held ? 'held' : 'gap',
        bar: frame.bar ?? null, rawBar: frame.rawBar ?? null,
        needleDeg: frame.needleDeg ?? null, hubX: frame.hubX ?? null,
        hubY: frame.hubY ?? null, radius: frame.radius ?? null,
        zeroDeg: frame.zeroDeg ?? null, fiveDeg: frame.fiveDeg ?? null,
        tenDeg: frame.tenDeg ?? null, reason: frame.reason ?? null});
    },
    snapshot() { return clone({calibrations, frames}); },
  };
}

export function commitReplayDiagnostics(shotId, diagnostics) {
  latest = clone({shotId: String(shotId), ...diagnostics});
}

export function replayDiagnosticsForShot(shotId) {
  return latest?.shotId === String(shotId) ? clone(latest) : null;
}
