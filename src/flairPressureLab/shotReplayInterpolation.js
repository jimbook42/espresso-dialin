import { wrap360, wrapDelta } from './gaugeConfig.js';

/**
 * @param {import('./shotReplaySampleLogger.js').ShotReplaySample[]} samples
 * @param {number} tS
 */
export function interpolateReplaySample(samples, tS) {
  if (!samples?.length || !Number.isFinite(tS)) return null;
  if (tS <= samples[0].tS) return { ...samples[0] };
  const last = samples[samples.length - 1];
  if (tS >= last.tS) return { ...last };

  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    if (tS < a.tS || tS > b.tS) continue;
    const span = b.tS - a.tS;
    const u = span > 0 ? (tS - a.tS) / span : 0;
    return {
      tS,
      bar: lerpNullable(a.bar, b.bar, u),
      hubX: lerpNullable(a.hubX, b.hubX, u),
      hubY: lerpNullable(a.hubY, b.hubY, u),
      radius: lerpNullable(a.radius, b.radius, u),
      needleDeg: lerpAngleDeg(a.needleDeg, b.needleDeg, u),
      valid: a.valid && b.valid,
    };
  }
  return null;
}

function lerpNullable(a, b, u) {
  if (a == null || b == null) return a ?? b ?? null;
  return a + (b - a) * u;
}

function lerpAngleDeg(a, b, u) {
  if (a == null || b == null) return a ?? b ?? null;
  const delta = wrapDelta(b, a);
  return wrap360(a + delta * u);
}

/** Image-space needle tip (degrees clockwise from +x, y down). */
export function needleTipFromSample(sample) {
  if (
    sample?.hubX == null
    || sample.hubY == null
    || sample.radius == null
    || sample.needleDeg == null
  ) {
    return null;
  }
  const rad = (sample.needleDeg * Math.PI) / 180;
  const r = sample.radius * 0.92;
  return {
    x: sample.hubX + r * Math.cos(rad),
    y: sample.hubY + r * Math.sin(rad),
  };
}

export function formatReplaySizeMb(byteSize) {
  if (!byteSize || !Number.isFinite(byteSize)) return '0.0';
  return (byteSize / (1024 * 1024)).toFixed(1);
}
