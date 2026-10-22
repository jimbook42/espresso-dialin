/**
 * Tap calibration for the pressure lab.
 *
 * The user freezes a rest frame and taps the hub, the printed 5, and the
 * printed 10. Each tap is pulled onto the feature next to it: the hub is the
 * centre of the black bezel (the screw sits on that pivot), and 5 / 10 are
 * the printed rays from the red Espresso block and the STOP band. One tap
 * that misses its feature is named and redone. The resting needle on that
 * frozen frame is 0 bar. The span from that needle to the snapped 10 is the
 * 0–10 scale. Later frames follow the bezel and the colour bands inside a
 * window around the last pose and read only the needle against that frame.
 * The needle is not a tracking feature.
 */

import {
  FLAIR_58_SCALE,
  NEEDLE_LOST_QUALITY,
  OUTER_RADIUS_RATIO,
  TIP_INNER_RATIO,
  wrap360,
  wrapDelta,
} from './gaugeConfig.js';
import { barToDialAngle, RED_BAND_INNER_FRACTION, RED_BAND_OUTER_FRACTION, DARK_BAND_INNER_FRACTION, DARK_BAND_OUTER_FRACTION } from './dialFaceTemplate.js';
import { measureDialColorBands, registerDialFromColorBands } from './colorRegistration.js';
import { detectNeedleAngle, refineNeedleAngle } from './needleFromFrame.js';

/** Clockwise travel from the printed 5 to the printed 10. */
export const MARK_SWEEP_DEG = FLAIR_58_SCALE.sweepDeg / 2;

/** A tap this far from its feature is the one bad tap. */
export const BAD_TAP_PX = 48;
/** Finger noise the snap is expected to absorb. */
export const SNAP_NEAR_PX = 36;
const HUB_WINDOW_PX = 28;
const LOST_BEZEL = 0.35;
const LOST_RIM_STD = 10;
const TRACK_NEAR_PX = 10;
const TRACK_FAR_PX = 36;

const RING = 28;
const COS = new Float64Array(RING);
const SIN = new Float64Array(RING);
for (let i = 0; i < RING; i += 1) {
  const a = (i / RING) * Math.PI * 2;
  COS[i] = Math.cos(a);
  SIN[i] = Math.sin(a);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function pointOf(value) {
  if (!value) return null;
  if (Array.isArray(value)) return { x: value[0], y: value[1] };
  if (Number.isFinite(value.x) && Number.isFinite(value.y)) return { x: value.x, y: value.y };
  return null;
}

export function pointDist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointAngle(from, to) {
  return wrap360((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
}

export function clockwiseDeg(fromDeg, toDeg) {
  return wrap360(toDeg - fromDeg);
}

function pointOnRay(origin, radius, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: origin.x + radius * Math.cos(rad),
    y: origin.y + radius * Math.sin(rad),
  };
}

function lumaOf(data, width, height, x, y) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= width || yi >= height) return null;
  const o = (yi * width + xi) * 4;
  return data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
}

/**
 * How much the triple disagrees with an isosceles printed 5→10.
 * Five and ten share one residual: the construction is symmetric, so the
 * name of the bad mark comes from which tap missed its snapped feature.
 */
export function markResidualPx(centre, five, ten) {
  const radius = pointDist(centre, ten);
  const angle = pointAngle(centre, ten) - MARK_SWEEP_DEG;
  const implied = pointOnRay(centre, radius, angle);
  return pointDist(five, implied);
}

export function centreResidualPx(centre, five, ten) {
  const dx = ten.x - five.x;
  const dy = ten.y - five.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 8) return Infinity;
  const theta = (MARK_SWEEP_DEG * Math.PI) / 180;
  const radius = chord / (2 * Math.sin(theta / 2));
  const offset = radius * Math.cos(theta / 2);
  const midX = (five.x + ten.x) / 2;
  const midY = (five.y + ten.y) / 2;
  const px = -dy / chord;
  const py = dx / chord;
  const candidates = [
    { x: midX + px * offset, y: midY + py * offset },
    { x: midX - px * offset, y: midY - py * offset },
  ];
  let best = null;
  for (const candidate of candidates) {
    const swept = clockwiseDeg(pointAngle(candidate, five), pointAngle(candidate, ten));
    const err = Math.abs(wrapDelta(swept, MARK_SWEEP_DEG));
    if (!best || err < best.err) best = { err, candidate };
  }
  return pointDist(centre, best.candidate);
}

/**
 * Name one tap that is not on its feature.
 * `snapped` distances are tap → feature. A single distance past `BAD_TAP_PX`
 * is that tap. Geometry alone flags an inconsistent triple when no feature
 * distances are available.
 */
export function detectBadTap(centre, five, ten, snapped = null) {
  const c = pointOf(centre);
  const f = pointOf(five);
  const t = pointOf(ten);
  const geometry = {
    markPx: markResidualPx(c, f, t),
    centrePx: centreResidualPx(c, f, t),
    radiusRatio: pointDist(c, f) / Math.max(1, pointDist(c, t)),
    sweepDeg: clockwiseDeg(pointAngle(c, f), pointAngle(c, t)),
  };
  const distances = snapped
    ? {
      centre: snapped.hubPx ?? snapped.centre ?? 0,
      five: snapped.fivePx ?? snapped.five ?? 0,
      ten: snapped.tenPx ?? snapped.ten ?? 0,
    }
    : null;
  let bad = null;
  if (distances) {
    const far = Object.entries(distances)
      .filter(([, px]) => px > BAD_TAP_PX)
      .sort((a, b) => b[1] - a[1]);
    if (far.length === 1) bad = far[0][0];
    else if (far.length > 1) bad = far[0][0];
  } else if (geometry.markPx > 96 && geometry.centrePx > geometry.markPx) {
    bad = 'centre';
  } else if (geometry.markPx > 96) {
    const fiveR = pointDist(c, f);
    const tenR = pointDist(c, t);
    bad = Math.abs(fiveR - tenR) < 8
      ? (geometry.centrePx > geometry.markPx ? 'centre' : 'ten')
      : (Math.abs(fiveR - (fiveR + tenR) / 2) > Math.abs(tenR - (fiveR + tenR) / 2) ? 'five' : 'ten');
  }
  return { bad, geometry, distances };
}

/**
 * Bar on the rest-needle scale. 0 is the frozen needle, 10 is the snapped 10.
 * Travel just under rest or just past 10 stays on the scale. The rest of the
 * circle is not a reading.
 */
export function barFromRestSpan(needleDeg, zeroDeg, tenDeg) {
  if (needleDeg == null || zeroDeg == null || tenDeg == null) return null;
  const span = clockwiseDeg(zeroDeg, tenDeg);
  if (!(span > 40) || span > 280) return null;
  const delta = clockwiseDeg(zeroDeg, needleDeg);
  const edge = Math.min(16, span * 0.1);
  if (delta >= 360 - edge) return 0;
  if (delta <= span) return (delta / span) * 10;
  if (delta <= span + edge) return 10;
  return null;
}

/** Where the printed 5 falls on the rest→10 scale. A large miss is a warning. */
export function fiveCheckBar(fiveDeg, zeroDeg, tenDeg) {
  return barFromRestSpan(fiveDeg, zeroDeg, tenDeg);
}

export const FIVE_WARN_BAR = 0.75;

function bezelScoreAt(data, width, height, cx, cy, radius) {
  let hit = 0;
  let n = 0;
  const innerR = radius * 0.72;
  const outerR = radius + 22;
  for (let i = 0; i < RING; i += 1) {
    const ox = Math.round(cx + radius * COS[i]);
    const oy = Math.round(cy + radius * SIN[i]);
    const ix = Math.round(cx + innerR * COS[i]);
    const iy = Math.round(cy + innerR * SIN[i]);
    const zx = Math.round(cx + outerR * COS[i]);
    const zy = Math.round(cy + outerR * SIN[i]);
    if (ox < 0 || oy < 0 || ox >= width || oy >= height) continue;
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) continue;
    if (zx < 0 || zy < 0 || zx >= width || zy >= height) continue;
    n += 1;
    const ring = (oy * width + ox) * 4;
    const inner = (iy * width + ix) * 4;
    const outer = (zy * width + zx) * 4;
    const ringL = data[ring] * 0.299 + data[ring + 1] * 0.587 + data[ring + 2] * 0.114;
    const innerL = data[inner] * 0.299 + data[inner + 1] * 0.587 + data[inner + 2] * 0.114;
    const outerL = data[outer] * 0.299 + data[outer + 1] * 0.587 + data[outer + 2] * 0.114;
    if (ringL < innerL - 10 && outerL > ringL + 16) hit += 1;
  }
  if (n < RING * 0.6) return 0;
  return hit / n;
}

function lumaAt(data, width, height, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const p = (y * width + x) * 4;
  return data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
}

/**
 * How circular the bright outer edge is around this centre.
 * A real pivot has one crossing radius. An offset centre swings.
 * Returns null when the surround is not brighter than the face.
 */
export function rimMeasure(image, cx, cy, angles = 36, rStep = 1) {
  const { data, width, height } = image;
  const radii = [];
  const prevGap = Math.max(2, rStep);
  for (let i = 0; i < angles; i += 1) {
    const angle = (i / angles) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const at = (r) => lumaAt(data, width, height, Math.round(cx + r * cos), Math.round(cy + r * sin));
    const faceSamples = [at(48), at(56), at(64)].filter((v) => v != null);
    const outsideSamples = [at(112), at(120)].filter((v) => v != null);
    if (faceSamples.length < 2 || outsideSamples.length < 1) continue;
    const face = faceSamples.reduce((s, v) => s + v, 0) / faceSamples.length;
    const outside = outsideSamples.reduce((s, v) => s + v, 0) / outsideSamples.length;
    if (outside < face + 12) continue;
    const mid = face + (outside - face) * 0.55;
    let cross = 0;
    for (let r = 70; r <= 115; r += rStep) {
      const cur = at(r);
      const prev = at(r - prevGap);
      if (cur != null && prev != null && cur >= mid && prev < mid) {
        cross = r;
        break;
      }
    }
    if (cross) radii.push(cross);
  }
  if (radii.length < angles * 0.5) return null;
  const mean = radii.reduce((sum, r) => sum + r, 0) / radii.length;
  const variance = radii.reduce((sum, r) => sum + (r - mean) ** 2, 0) / radii.length;
  return { std: Math.sqrt(variance), radius: mean * 0.9, n: radii.length };
}

function searchRim(image, prior, span, step, radiusPrior = 0, angles = 36, rStep = 1) {
  let best = null;
  const x0 = prior.x;
  const y0 = prior.y;
  for (let dy = -span; dy <= span; dy += step) {
    const cy = y0 + dy;
    for (let dx = -span; dx <= span; dx += step) {
      const cx = x0 + dx;
      if (dx * dx + dy * dy > span * span) continue;
      const measured = rimMeasure(image, cx, cy, angles, rStep);
      if (!measured) continue;
      if (radiusPrior > 20) {
        const scale = measured.radius / radiusPrior;
        if (scale < 0.88 || scale > 1.14) continue;
      }
      const nearer = best && Math.abs(measured.std - best.std) < 0.35 && (dx * dx + dy * dy) < best.dist;
      if (!best || measured.std < best.std - 0.35 || nearer) {
        best = {
          x: cx,
          y: cy,
          radius: measured.radius,
          std: measured.std,
          score: Math.max(0, (12 - measured.std) / 12),
          dist: dx * dx + dy * dy,
        };
      }
    }
  }
  return best;
}

function searchBezel(image, prior, span, step, radii) {
  const { data, width, height } = image;
  let best = null;
  const x0 = prior.x;
  const y0 = prior.y;
  for (let dy = -span; dy <= span; dy += step) {
    const cy = y0 + dy;
    if (cy < 8 || cy >= height - 8) continue;
    for (let dx = -span; dx <= span; dx += step) {
      const cx = x0 + dx;
      if (cx < 8 || cx >= width - 8) continue;
      if (dx * dx + dy * dy > span * span) continue;
      for (let r = 0; r < radii.length; r += 1) {
        const radius = radii[r];
        const score = bezelScoreAt(data, width, height, cx, cy, radius);
        if (!best || score > best.score) best = { x: cx, y: cy, radius, score };
      }
    }
  }
  return best;
}

function radiusList(minR, maxR, step) {
  const out = [];
  for (let radius = minR; radius <= maxR; radius += step) out.push(radius);
  return out;
}

/**
 * Pull a centre tap onto the bezel pivot. The screw is the centre of that
 * circle; at replay size the screw itself is only a couple of pixels.
 */
function snapHubContrast(image, origin, windowPx) {
  const coarse = searchBezel(image, origin, windowPx, 2, radiusList(78, 110, 2));
  if (!coarse || coarse.score < 0.28) {
    return { ...origin, radius: coarse?.radius ?? 90, score: coarse?.score ?? 0, ok: false };
  }
  const fine = searchBezel(
    image,
    coarse,
    3,
    1,
    radiusList(Math.max(70, coarse.radius - 4), coarse.radius + 4, 2),
  );
  const chosen = fine && fine.score >= coarse.score ? fine : coarse;
  return { x: chosen.x, y: chosen.y, radius: chosen.radius, score: chosen.score, ok: chosen.score >= 0.34 };
}

export function snapHub(image, tap, { windowPx = HUB_WINDOW_PX } = {}) {
  const origin = pointOf(tap);
  const coarse = searchRim(image, origin, Math.max(windowPx, 32), 4);
  const fine = coarse && coarse.std <= LOST_RIM_STD ? searchRim(image, coarse, 4, 1) : null;
  const rim = fine && fine.std <= coarse.std ? fine : coarse;
  if (rim && rim.std <= 8.5) {
    return { x: rim.x, y: rim.y, radius: rim.radius, score: rim.score, ok: true };
  }
  return snapHubContrast(image, origin, windowPx);
}

function cropImage(image, cx, cy, radius) {
  const pad = Math.max(16, Math.round(radius * 1.2));
  const x0 = clamp(Math.round(cx - pad), 0, image.width - 2);
  const y0 = clamp(Math.round(cy - pad), 0, image.height - 2);
  const x1 = clamp(Math.round(cx + pad), x0 + 2, image.width);
  const y1 = clamp(Math.round(cy + pad), y0 + 2, image.height);
  const width = x1 - x0;
  const height = y1 - y0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const src = ((y0 + y) * image.width + x0) * 4;
    data.set(image.data.subarray(src, src + width * 4), y * width * 4);
  }
  return {
    image: { width, height, data },
    cx: cx - x0,
    cy: cy - y0,
  };
}

/** The rest needle points at the pin, about one sweep short of the printed 10. */
export function chooseRestNeedle(angleDeg, tenDeg) {
  if (angleDeg == null || tenDeg == null) return angleDeg;
  const target = FLAIR_58_SCALE.sweepDeg;
  const direct = clockwiseDeg(angleDeg, tenDeg);
  const flipped = clockwiseDeg(wrap360(angleDeg + 180), tenDeg);
  if (Math.abs(wrapDelta(flipped, target)) + 12 < Math.abs(wrapDelta(direct, target))) {
    return wrap360(angleDeg + 180);
  }
  return angleDeg;
}

export function readNeedleAt(image, cx, cy, radius, hintDeg = null) {
  if (!(radius > 12)) return { angleDeg: null, quality: 0, likeness: 0 };
  const cropped = cropImage(image, cx, cy, radius);
  const inner = radius * TIP_INNER_RATIO;
  const outer = radius * OUTER_RADIUS_RATIO;
  const found = detectNeedleAngle(cropped.image, cropped.cx, cropped.cy, inner, outer, null, hintDeg);
  if (found.angleDeg == null) return found;
  found.angleDeg = refineNeedleAngle(cropped.image, cropped.cx, cropped.cy, inner, outer, found.angleDeg);
  return found;
}

function featureMissPx(hub, tap, projected) {
  const fraction = pointDist(hub, tap) / Math.max(1, hub.radius);
  // A purely radial miss stays on the template ray. Only a tap that leaves
  // the numeral band is charged extra; ordinary 25px finger noise is not.
  const radial = fraction < 0.18 || fraction > 1.35 ? 40 : 0;
  return pointDist(tap, projected) + radial;
}

function colorCandidates(bezelRadius) {
  const out = [];
  for (let scale = 1.15; scale <= 1.75; scale += 0.08) out.push(bezelRadius * scale);
  return out;
}

/**
 * Place 5 and 10 on the template rays nearest the taps.
 * The nearer tap picks the colour radius, so one wild tap does not rotate the dial.
 */
export function snapScaleMarks(image, hub, fiveTap, tenTap, needleDeg) {
  const five = pointOf(fiveTap);
  const ten = pointOf(tenTap);
  const fiveR = pointDist(hub, five);
  const tenR = pointDist(hub, ten);
  let best = null;
  for (const colorRadius of colorCandidates(hub.radius)) {
    const bands = measureDialColorBands(image, hub.x, hub.y, colorRadius, needleDeg);
    const reg = registerDialFromColorBands(bands);
    if (!reg.ok || bands.redMass < 2.5) continue;
    const fiveDeg = wrap360(barToDialAngle(5) + reg.rotationDeg);
    const tenDeg = wrap360(barToDialAngle(10) + reg.rotationDeg);
    const fivePt = pointOnRay(hub, fiveR, fiveDeg);
    const tenPt = pointOnRay(hub, tenR, tenDeg);
    const fivePx = featureMissPx(hub, five, fivePt);
    const tenPx = featureMissPx(hub, ten, tenPt);
    const near = Math.min(fivePx, tenPx);
    const far = Math.max(fivePx, tenPx);
    const rank = far + near * 0.35 - reg.periodMargin * 24;
    if (!best || rank < best.rank) {
      best = {
        rank,
        five: fivePt,
        ten: tenPt,
        fiveDeg,
        tenDeg,
        fivePx,
        tenPx,
        rotationDeg: reg.rotationDeg,
        colorRadius,
        margin: reg.periodMargin,
        redMass: bands.redMass,
        bands,
      };
    }
  }
  if (!best) {
    return {
      ok: false,
      five,
      ten,
      fiveDeg: pointAngle(hub, five),
      tenDeg: pointAngle(hub, ten),
      fivePx: null,
      tenPx: null,
      rotationDeg: 0,
      colorRadius: hub.radius,
      margin: 0,
    };
  }
  return { ok: true, ...best };
}

function fixedBands(image, cx, cy, radius, needleDeg) {
  const red = new Float32Array(72);
  const dark = new Float32Array(72);
  const bin = 360 / 72;
  let redMass = 0;
  let darkMass = 0;
  const lums = [];
  const darkSamples = [];
  for (let i = 0; i < 180; i += 1) {
    const deg = i * 2;
    if (needleDeg != null && (Math.abs(wrapDelta(deg, needleDeg)) < 16 || Math.abs(wrapDelta(deg, needleDeg + 180)) < 16)) {
      continue;
    }
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    for (const fraction of [DARK_BAND_INNER_FRACTION, (DARK_BAND_INNER_FRACTION + DARK_BAND_OUTER_FRACTION) / 2, DARK_BAND_OUTER_FRACTION]) {
      const lum = lumaOf(image.data, image.width, image.height, cx + radius * fraction * cos, cy + radius * fraction * sin);
      if (lum == null) continue;
      lums.push(lum);
      darkSamples.push({ deg, lum });
    }
    for (const fraction of [RED_BAND_INNER_FRACTION, (RED_BAND_INNER_FRACTION + RED_BAND_OUTER_FRACTION) / 2, RED_BAND_OUTER_FRACTION]) {
      const x = Math.round(cx + radius * fraction * cos);
      const y = Math.round(cy + radius * fraction * sin);
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const o = (y * image.width + x) * 4;
      const r = image.data[o];
      const g = image.data[o + 1];
      const b = image.data[o + 2];
      const chroma = Math.max(0, r - Math.max(g, b)) / ((r + g + b) / 3 + 1);
      if (chroma < 0.08) continue;
      const index = Math.round(deg / bin) % 72;
      red[index] += chroma;
      redMass += chroma;
    }
  }
  if (lums.length) {
    const sorted = lums.slice().sort((a, b) => a - b);
    const cut = sorted[Math.floor(sorted.length / 2)] * 0.62;
    for (const sample of darkSamples) {
      if (sample.lum > cut) continue;
      const index = Math.round(sample.deg / bin) % 72;
      dark[index] += 1;
      darkMass += 1;
    }
  }
  return { red, dark, redMass, darkMass };
}

function correlateShift(template, observed) {
  const bins = template.length;
  let best = -1;
  let bestShift = 0;
  let templateEnergy = 0;
  for (let i = 0; i < bins; i += 1) templateEnergy += template[i] * template[i];
  if (templateEnergy < 1e-4) return { corr: 0, shiftDeg: 0 };
  for (let shift = 0; shift < bins; shift += 1) {
    let dot = 0;
    let observedEnergy = 0;
    for (let i = 0; i < bins; i += 1) {
      const value = observed[(i + shift) % bins];
      dot += template[i] * value;
      observedEnergy += value * value;
    }
    const corr = dot / Math.sqrt(templateEnergy * observedEnergy + 1e-6);
    if (corr > best) {
      best = corr;
      bestShift = shift;
    }
  }
  return { corr: best, shiftDeg: bestShift * (360 / bins) };
}

function packTemplate(bands) {
  const red = Float32Array.from(bands.red);
  const dark = Float32Array.from(bands.dark);
  return { red, dark };
}

/**
 * Calibrate from three taps on one frozen frame.
 * Returns a redo name when a single tap misses, otherwise the in-memory scale.
 */
export function calibrateFromTaps(image, taps) {
  const centreTap = pointOf(taps.centre ?? taps[0]);
  const fiveTap = pointOf(taps.five ?? taps[1]);
  const tenTap = pointOf(taps.ten ?? taps[2]);
  if (!centreTap || !fiveTap || !tenTap) {
    return { ok: false, redo: 'centre', reason: 'missing-tap' };
  }

  const hub = snapHub(image, centreTap);
  const hubPx = pointDist(hub, centreTap);
  if (!hub.ok || hubPx > BAD_TAP_PX) {
    return {
      ok: false,
      redo: 'centre',
      reason: 'hub',
      hub,
      snapPx: { centre: hubPx, five: null, ten: null },
    };
  }

  const needle = readNeedleAt(image, hub.x, hub.y, hub.radius);
  const marks = snapScaleMarks(image, hub, fiveTap, tenTap, needle.angleDeg);
  if (!marks.ok) {
    return {
      ok: false,
      redo: null,
      reason: 'unregistered',
      hub,
      marks,
      snapPx: { centre: hubPx, five: null, ten: null },
    };
  }
  const named = detectBadTap(centreTap, fiveTap, tenTap, {
    hubPx,
    fivePx: marks.fivePx,
    tenPx: marks.tenPx,
  });
  if (named.bad && named.bad !== 'centre') {
    return {
      ok: false,
      redo: named.bad,
      reason: 'mark',
      hub,
      marks,
      snapPx: { centre: hubPx, five: marks.fivePx, ten: marks.tenPx },
      geometry: named.geometry,
    };
  }
  if (needle.angleDeg == null || (needle.quality ?? 0) < NEEDLE_LOST_QUALITY * 0.5) {
    return { ok: false, redo: null, reason: 'needle', hub, marks };
  }

  const zeroAngleDeg = chooseRestNeedle(needle.angleDeg, marks.tenDeg);
  const tenAngleDeg = marks.tenDeg;
  const fiveAngleDeg = marks.fiveDeg;
  const spanDeg = clockwiseDeg(zeroAngleDeg, tenAngleDeg);
  const fiveBar = fiveCheckBar(fiveAngleDeg, zeroAngleDeg, tenAngleDeg);
  const templateBands = marks.bands
    ? packTemplate(marks.bands)
    : packTemplate(fixedBands(image, hub.x, hub.y, marks.colorRadius, zeroAngleDeg));
  return {
    ok: true,
    redo: null,
    reason: null,
    fiveWarn: fiveBar == null || Math.abs(fiveBar - 5) > FIVE_WARN_BAR,
    fiveBar,
    snapPx: { centre: hubPx, five: marks.fivePx, ten: marks.tenPx },
    calibration: {
      hub: { x: hub.x, y: hub.y },
      five: marks.five,
      ten: marks.ten,
      radius: hub.radius,
      colorRadius: marks.colorRadius,
      rotationDeg: marks.rotationDeg,
      zeroAngleDeg,
      fiveAngleDeg,
      tenAngleDeg,
      spanDeg,
      bezelScore: hub.score,
      margin: marks.margin,
      template: templateBands,
      needleQuality: needle.quality,
    },
  };
}

export function createCalibratedTracker(calibration) {
  return {
    calibration,
    pose: {
      x: calibration.hub.x,
      y: calibration.hub.y,
      radius: calibration.radius,
      rotationDeg: calibration.rotationDeg,
      shiftDeg: 0,
    },
    needleDeg: calibration.zeroAngleDeg,
    score: 1,
  };
}

function asPose(prior, measured) {
  return {
    x: prior.x,
    y: prior.y,
    radius: measured.radius,
    std: measured.std,
    score: Math.max(0, (12 - measured.std) / 12),
  };
}

function trackPose(image, tracker) {
  const prior = tracker.pose;
  const here = rimMeasure(image, prior.x, prior.y);
  let found = searchRim(image, prior, TRACK_NEAR_PX, 2, prior.radius);
  // A weak local rim means the gauge moved. Look further, cheaply, and only
  // accept a centre that is clearly rounder than staying put.
  if (!found || found.std > 5.4) {
    const far = searchRim(image, prior, 48, 6, prior.radius, 16, 2);
    if (far && (!found || far.std + 0.8 < found.std)) found = far;
  }
  if (!found || found.std > 5.4) {
    const wider = searchRim(image, prior, 96, 8, prior.radius, 16, 2);
    if (wider && (!found || wider.std + 0.8 < (found?.std ?? 99))) found = wider;
  }
  if (found && found.std <= LOST_RIM_STD) {
    const checked = rimMeasure(image, found.x, found.y);
    if (checked) found = { ...found, std: checked.std, radius: checked.radius, score: Math.max(0, (12 - checked.std) / 12) };
  }
  if (here && here.std <= LOST_RIM_STD && (!found || found.std > here.std - 0.8)) {
    found = asPose(prior, here);
  }
  if (found && found.std <= LOST_RIM_STD) {
    const fine = searchRim(image, found, 3, 1, prior.radius);
    if (fine && fine.std + 0.3 < found.std) found = fine;
    return found;
  }
  const near = searchBezel(
    image,
    prior,
    TRACK_NEAR_PX,
    2,
    radiusList(Math.max(48, prior.radius - 6), prior.radius + 6, 3),
  );
  found = near;
  if (!found || found.score < LOST_BEZEL) {
    found = searchBezel(
      image,
      prior,
      TRACK_FAR_PX,
      3,
      radiusList(Math.max(48, prior.radius - 14), prior.radius + 14, 4),
    );
  }
  if (found && found.score >= LOST_BEZEL) {
    const fine = searchBezel(
      image,
      found,
      3,
      1,
      [found.radius - 2, found.radius, found.radius + 2],
    );
    if (fine && fine.score >= found.score) found = fine;
  }
  return found;
}

/**
 * Follow the calibrated dial and read the needle against the rest→10 scale.
 * A weak bezel or colour match does not move the pose.
 */
export function readCalibratedFrame(image, tracker) {
  const found = trackPose(image, tracker);
  const bezelOk = Boolean(
    found && (found.std != null ? found.std <= LOST_RIM_STD : found.score >= LOST_BEZEL),
  );
  const pose = bezelOk ? found : tracker.pose;
  const scale = tracker.calibration.radius > 1 ? pose.radius / tracker.calibration.radius : 1;
  const colorRadius = tracker.calibration.colorRadius * scale;
  const needle = bezelOk
    ? readNeedleAt(image, pose.x, pose.y, pose.radius)
    : { angleDeg: null, quality: 0, likeness: 0 };
  const bands = fixedBands(
    image,
    pose.x,
    pose.y,
    colorRadius,
    needle.angleDeg ?? tracker.needleDeg,
  );
  const redShift = correlateShift(tracker.calibration.template.red, bands.red);
  const darkShift = correlateShift(tracker.calibration.template.dark, bands.dark);
  const shiftDisagree = Math.abs(wrapDelta(redShift.shiftDeg, darkShift.shiftDeg));
  const shiftSmall = Math.abs(wrapDelta(redShift.shiftDeg, 0)) <= 14;
  const shiftAgrees = darkShift.corr < 0.45 || shiftDisagree <= 12;
  const shiftOk = bands.redMass > 1.2 && redShift.corr >= 0.72 && shiftSmall && shiftAgrees;
  const shiftDeg = shiftOk ? redShift.shiftDeg : tracker.pose.shiftDeg;
  const match = redShift.corr;
  const score = (bezelOk ? found.score : 0) * (0.35 + 0.65 * Math.max(0, match));
  const lost = !bezelOk;
  if (bezelOk) {
    tracker.pose = {
      x: pose.x,
      y: pose.y,
      radius: pose.radius,
      rotationDeg: wrap360(tracker.calibration.rotationDeg + shiftDeg),
      shiftDeg,
    };
    if (needle.angleDeg != null && (needle.quality ?? 0) >= NEEDLE_LOST_QUALITY) {
      tracker.needleDeg = needle.angleDeg;
    }
  }
  tracker.score = score;
  const zero = wrap360(tracker.calibration.zeroAngleDeg + shiftDeg);
  const ten = wrap360(tracker.calibration.tenAngleDeg + shiftDeg);
  const five = wrap360(tracker.calibration.fiveAngleDeg + shiftDeg);
  const bar = !lost && needle.angleDeg != null && (needle.quality ?? 0) >= NEEDLE_LOST_QUALITY
    ? barFromRestSpan(needle.angleDeg, zero, ten)
    : null;
  return {
    ok: bar != null,
    lost,
    bar,
    score,
    bezelScore: found?.score ?? 0,
    match,
    shiftDeg: lost ? tracker.pose.shiftDeg : shiftDeg,
    hub: { x: tracker.pose.x, y: tracker.pose.y },
    radius: tracker.pose.radius,
    needleDeg: needle.angleDeg,
    needleQuality: needle.quality ?? 0,
    likeness: needle.likeness ?? 0,
    zeroDeg: zero,
    fiveDeg: five,
    tenDeg: ten,
  };
}

/** Replay builds only. `cx,cy,fx,fy,tx,ty` in unmirrored video pixels. */
export function parseTapCalQuery(search) {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const raw = params.get('tapcal');
  if (!raw) return null;
  const nums = raw.split(/[,\s]+/).map(Number);
  if (nums.length < 6 || nums.some((n) => !Number.isFinite(n))) return null;
  return {
    centre: { x: nums[0], y: nums[1] },
    five: { x: nums[2], y: nums[3] },
    ten: { x: nums[4], y: nums[5] },
  };
}

export function tapsFromReplayHook(target = typeof window !== 'undefined' ? window : null) {
  const hook = target?.__pressureLabTapCal;
  if (!hook) return null;
  const taps = hook.taps || hook;
  const centre = pointOf(taps.centre ?? taps[0]);
  const five = pointOf(taps.five ?? taps[1]);
  const ten = pointOf(taps.ten ?? taps[2]);
  if (!centre || !five || !ten) return null;
  return { centre, five, ten };
}
