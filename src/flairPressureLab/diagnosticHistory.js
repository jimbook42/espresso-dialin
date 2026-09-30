/** Rolling lab trace. Memory only — never Dexie, shots, or the network. */
import { wrapDelta } from './gaugeConfig.js';

export const DIAGNOSTIC_HISTORY_MS = 30_000;
export const STABILITY_WINDOW = 24;

export function createDiagnosticHistory({ durationMs = DIAGNOSTIC_HISTORY_MS } = {}) {
  let samples = [];
  return {
    reset() {
      samples = [];
    },
    push(sample) {
      const t = sample.t ?? Date.now();
      samples.push({ ...sample, t });
      const cutoff = t - durationMs;
      let drop = 0;
      while (drop < samples.length && samples[drop].t < cutoff) drop += 1;
      if (drop) samples.splice(0, drop);
    },
    snapshot() {
      return samples.slice();
    },
    get length() {
      return samples.length;
    },
  };
}

function finite(values) {
  return values.filter((value) => value != null && !Number.isNaN(value));
}

function spread(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function angleSpread(values) {
  if (values.length < 2) return null;
  const base = values[0];
  return spread(values.map((value) => wrapDelta(base, value)));
}

function pair(samples, pick) {
  const values = finite(samples.map(pick));
  const last = samples.length ? pick(samples[samples.length - 1]) : null;
  const prev = samples.length > 1 ? pick(samples[samples.length - 2]) : null;
  return { values, last, prev };
}

/** Last-frame step and rolling spread. In memory only, from the lab trace. */
export function stabilityStats(samples, windowSize = STABILITY_WINDOW) {
  const recent = (samples || []).slice(-windowSize);
  const centreX = pair(recent, (sample) => sample.gaugeX);
  const centreY = pair(recent, (sample) => sample.gaugeY);
  const rawX = pair(recent, (sample) => sample.rawGaugeX);
  const rawY = pair(recent, (sample) => sample.rawGaugeY);
  const rotation = pair(recent, (sample) => sample.gaugeRotation);
  const rawRotation = pair(recent, (sample) => sample.rawRotation);
  const screen = pair(recent, (sample) => sample.rawAngle);
  const relative = pair(recent, (sample) => sample.relativeAngle);
  const smoothed = pair(recent, (sample) => sample.smoothedAngle);
  const pressure = pair(recent, (sample) => sample.pressure);
  const centreDelta = centreX.last == null || centreX.prev == null || centreY.last == null || centreY.prev == null
    ? null
    : Math.hypot(centreX.last - centreX.prev, centreY.last - centreY.prev);
  const detectorDelta = rawX.last == null || rawX.prev == null || rawY.last == null || rawY.prev == null
    ? null
    : Math.hypot(rawX.last - rawX.prev, rawY.last - rawY.prev);
  const xSpread = spread(centreX.values);
  const ySpread = spread(centreY.values);
  const rawXSpread = spread(rawX.values);
  const rawYSpread = spread(rawY.values);
  return {
    count: recent.length,
    centreDelta,
    centreStd: xSpread == null || ySpread == null ? null : Math.hypot(xSpread, ySpread),
    detectorCentreDelta: detectorDelta,
    detectorCentreStd: rawXSpread == null || rawYSpread == null ? null : Math.hypot(rawXSpread, rawYSpread),
    rotationDelta: rotation.last == null || rotation.prev == null ? null : wrapDelta(rotation.prev, rotation.last),
    rotationStd: angleSpread(rotation.values),
    detectorRotationDelta: rawRotation.last == null || rawRotation.prev == null ? null : wrapDelta(rawRotation.prev, rawRotation.last),
    detectorRotationStd: angleSpread(rawRotation.values),
    screenDelta: screen.last == null || screen.prev == null ? null : wrapDelta(screen.prev, screen.last),
    screenStd: angleSpread(screen.values),
    relativeDelta: relative.last == null || relative.prev == null ? null : wrapDelta(relative.prev, relative.last),
    relativeStd: angleSpread(relative.values),
    smoothedDelta: smoothed.last == null || smoothed.prev == null ? null : wrapDelta(smoothed.prev, smoothed.last),
    smoothedStd: angleSpread(smoothed.values),
    pressureStd: spread(pressure.values),
  };
}
