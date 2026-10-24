/**
 * Gauge profile: everything that is specific to one gauge.
 * The needle model never sees this. It only maps a crop angle (degrees
 * clockwise from the calibrated rest needle) onto a scale value.
 */
import { wrap360 } from './gaugeConfig.js';

export const REST_PHASES = ['rest', 'dry_1', 'used_1'];

const NEEDLE_NUMBER_FIELDS = [
  ['width', 0, 0.5],
  ['length', 0, 1.5],
  ['tailRatio', 0, 1.5],
  ['shade', 0, 1],
  ['softness', 0, 1],
  ['hub', 0, 0.5],
  ['tipLenRatio', 0, 2],
  ['tailLenRatio', 0, 2],
];

function fail(message) {
  throw new Error(`gauge profile: ${message}`);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function imageAngle(from, to) {
  return wrap360((Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI);
}

export function clockwise(fromDeg, toDeg) {
  return wrap360(toDeg - fromDeg);
}

/** Even counts use the mean of the two central samples. */
export function median(values) {
  const sorted = values.filter((value) => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return null;
  if (n % 2) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function requireNeedle(needle) {
  if (!needle || typeof needle !== 'object') fail('needle is required');
  for (const [key, lo, hi] of NEEDLE_NUMBER_FIELDS) {
    if (!finite(needle[key]) || needle[key] < lo || needle[key] > hi) {
      fail(`needle.${key} must be a number in [${lo}, ${hi}]`);
    }
  }
  if (typeof needle.color !== 'string' || !needle.color) fail('needle.color is required');
  if (typeof needle.template !== 'string' || !needle.template) fail('needle.template is required');
}

function requireRectify(rectify) {
  if (!rectify || typeof rectify !== 'object') fail('rectify is required');
  if (rectify.mode !== 'cartesian' && rectify.mode !== 'polar') fail('rectify.mode must be cartesian or polar');
  const size = rectify.cartesian?.size;
  const dial = rectify.cartesian?.dialRadiusPx;
  if (size !== 96 || dial !== 40) fail('cartesian crop must be 96 with dial radius 40');
  const bins = rectify.polar?.radiusBins;
  const angles = rectify.polar?.angleBins;
  const outer = rectify.polar?.outerRadiusPx;
  if (bins !== 48 || angles !== 360 || outer !== 48) fail('polar unwrap must be 48×360 with outer radius 48');
}

/**
 * Validate a profile object. Returns the same object when it is usable.
 * Needle width, length, tail ratio, shade, softness, and hub stay configurable.
 */
export function parseGaugeProfile(profile) {
  if (!profile || typeof profile !== 'object') fail('expected an object');
  if (typeof profile.id !== 'string' || !profile.id) fail('id is required');
  const scale = profile.scale;
  if (!scale || scale.interp !== 'piecewise-linear') fail('scale.interp must be piecewise-linear');
  if (!finite(scale.min) || !finite(scale.max) || !(scale.max > scale.min)) fail('scale min/max are required');
  if (!Array.isArray(scale.anchors) || scale.anchors.length < 2) fail('scale.anchors need at least two points');
  let previous = -Infinity;
  for (const anchor of scale.anchors) {
    if (!anchor || !finite(anchor.deg) || !finite(anchor.value)) fail('each anchor needs deg and value');
    if (anchor.deg < previous) fail('anchors must be sorted by deg');
    if (anchor.deg === previous) fail('anchor degrees must be unique');
    previous = anchor.deg;
  }
  if (!profile.rest || !finite(profile.rest.deg) || !finite(profile.rest.value)) fail('rest.deg and rest.value are required');
  requireNeedle(profile.needle);
  requireRectify(profile.rectify);
  if (!finite(profile.maxSlewPerSec) || profile.maxSlewPerSec <= 0) fail('maxSlewPerSec must be positive');
  return profile;
}

/**
 * Piecewise-linear value. Degrees are clockwise from the rest needle.
 * Outside the first and last anchors the value stays on the end anchor.
 */
export function angleToValue(angleDeg, profile) {
  const parsed = parseGaugeProfile(profile);
  if (!finite(angleDeg)) return null;
  const anchors = parsed.scale.anchors;
  if (angleDeg <= anchors[0].deg) return anchors[0].value;
  const last = anchors[anchors.length - 1];
  if (angleDeg >= last.deg) return last.value;
  for (let i = 1; i < anchors.length; i += 1) {
    const right = anchors[i];
    const left = anchors[i - 1];
    if (angleDeg <= right.deg) {
      const span = right.deg - left.deg;
      const t = span === 0 ? 0 : (angleDeg - left.deg) / span;
      return left.value + t * (right.value - left.value);
    }
  }
  return last.value;
}

function frameAngles(frame) {
  return {
    clip: frame.clip,
    phase: frame.phase,
    pinToTip: clockwise(imageAngle(frame.hub, frame.zero), imageAngle(frame.hub, frame.tip)),
    pinToFive: clockwise(imageAngle(frame.hub, frame.zero), imageAngle(frame.hub, frame.five)),
    pinToTen: clockwise(imageAngle(frame.hub, frame.zero), imageAngle(frame.hub, frame.ten)),
  };
}

function fitSubset(rows, restPhases) {
  const rest = new Set(restPhases);
  const restRows = rows.filter((row) => rest.has(row.phase));
  if (!restRows.length || !rows.length) return null;
  const pinOffsetDeg = median(restRows.map((row) => row.pinToTip));
  const pinToFiveDeg = median(rows.map((row) => row.pinToFive));
  const pinToTenDeg = median(rows.map((row) => row.pinToTen));
  return {
    pinOffsetDeg,
    pinToFiveDeg,
    pinToTenDeg,
    anchor0Deg: 0,
    anchor5Deg: pinToFiveDeg - pinOffsetDeg,
    anchor10Deg: pinToTenDeg - pinOffsetDeg,
    n: rows.length,
    nRest: restRows.length,
  };
}

function spread(values) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, spread: max - min };
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * Flair 58 profile. Anchors come from the label fit.
 * Needle width, length, tail ratio, shade, softness, and hub are config.
 */
export function buildFlair58Profile(fit) {
  return {
    id: 'flair58-v1',
    schemaVersion: 1,
    scale: {
      anchors: [
        { deg: 0, value: 0 },
        { deg: round4(fit.anchor5Deg), value: 5 },
        { deg: round4(fit.anchor10Deg), value: 10 },
      ],
      min: 0,
      max: 10,
      unit: 'bar',
      interp: 'piecewise-linear',
      zero: 'rest-needle',
    },
    rest: { deg: 0, value: 0, pinOffsetDeg: round4(fit.pinOffsetDeg) },
    needle: {
      width: 0.045,
      length: 0.86,
      tailRatio: 0.5,
      shade: 0.08,
      softness: 0.35,
      hub: 0.12,
      tipLenRatio: 1,
      tailLenRatio: 0.5,
      color: 'dark',
      template: 'needle.png',
    },
    rectify: {
      mode: 'cartesian',
      cartesian: { size: 96, dialRadiusPx: 40 },
      polar: { radiusBins: 48, angleBins: 360, outerRadiusPx: 48 },
    },
    masks: [],
    background: 'dial_clean.png',
    maxSlewPerSec: 4,
    fit: {
      source: 'scripts/pressure-label/fixtures/labels-2026-10-22.json',
      method: 'median clockwise from the 0 pin, minus the rest-needle offset',
      restPhases: REST_PHASES,
      pinOffsetDeg: fit.pinOffsetDeg,
      pinToFiveDeg: fit.pinToFiveDeg,
      pinToTenDeg: fit.pinToTenDeg,
      n: fit.n,
      nRest: fit.nRest,
      leaveOneClipOutSpread: fit.spread,
      leaveOneClipOut: fit.leaveOneClipOut.map((row) => ({
        clip: row.clip,
        pinOffsetDeg: row.pinOffsetDeg,
        anchor5Deg: row.anchor5Deg,
        anchor10Deg: row.anchor10Deg,
      })),
    },
  };
}

/**
 * Fit 0 / 5 / 10 from hand labels.
 * 0 bar is the rest needle, not the 0 pin. The pin offset is the median
 * clockwise angle from the pin to the tip on rest frames. Five and ten are
 * the median pin angles minus that offset. Leave-one-clip-out refits the
 * same way with each clip held out.
 */
export function fitAnchorsFromLabels(frames, { restPhases = REST_PHASES } = {}) {
  const rows = frames.map(frameAngles);
  const full = fitSubset(rows, restPhases);
  if (!full) fail('labels need rest frames and scale marks');
  const clips = [...new Set(rows.map((row) => row.clip))];
  const leaveOneClipOut = [];
  for (const clip of clips) {
    const held = fitSubset(rows.filter((row) => row.clip !== clip), restPhases);
    if (!held) continue;
    leaveOneClipOut.push({ clip, ...held });
  }
  return {
    ...full,
    clips: clips.length,
    leaveOneClipOut,
    spread: {
      pinOffsetDeg: spread(leaveOneClipOut.map((row) => row.pinOffsetDeg)),
      anchor5Deg: spread(leaveOneClipOut.map((row) => row.anchor5Deg)),
      anchor10Deg: spread(leaveOneClipOut.map((row) => row.anchor10Deg)),
    },
  };
}
