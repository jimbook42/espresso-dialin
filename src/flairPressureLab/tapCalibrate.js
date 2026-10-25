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
import { regularizeTapAnchors } from './anchorRegularize.js';

/** Clockwise travel from the printed 5 to the printed 10. */
export const MARK_SWEEP_DEG = FLAIR_58_SCALE.sweepDeg / 2;

/** Legacy reference radius (replay / QA dial size). Scaling uses this as 1.0. */
export const REFERENCE_GAUGE_RADIUS_PX = 90;
/** A tap this far from its feature is the one bad tap at reference radius. */
export const BAD_TAP_PX = 48;
/** Finger noise the snap is expected to absorb at reference radius. */
export const SNAP_NEAR_PX = 36;
const HUB_WINDOW_PX = 28;

/** Estimate dial radius from three user taps (centre → 5 / 10 chords). */
export function estimateGaugeRadiusFromTaps(centre, five, ten) {
  const c = pointOf(centre);
  const f = pointOf(five);
  const t = pointOf(ten);
  if (!c || !f || !t) return REFERENCE_GAUGE_RADIUS_PX;
  const r5 = pointDist(c, f);
  const r10 = pointDist(c, t);
  const chord = pointDist(f, t);
  const theta = (MARK_SWEEP_DEG * Math.PI) / 180;
  const fromChord = chord > 12 ? chord / (2 * Math.sin(theta / 2)) : 0;
  const blended = [r5, r10, fromChord].filter((v) => v > 14);
  if (!blended.length) return REFERENCE_GAUGE_RADIUS_PX;
  const mean = blended.reduce((s, v) => s + v, 0) / blended.length;
  return clamp(mean, 22, 200);
}

/** Pixel tolerances scaled to the estimated gauge radius. */
export function scaledTapTolerances(estRadiusPx) {
  const scale = estRadiusPx / REFERENCE_GAUGE_RADIUS_PX;
  return {
    estRadius: estRadiusPx,
    badTapPx: clamp(BAD_TAP_PX * scale, 18, 80),
    snapNearPx: clamp(SNAP_NEAR_PX * scale, 14, 64),
    hubWindowPx: clamp(HUB_WINDOW_PX * scale, 14, 56),
    looseMarkPx: clamp(96 * scale, 48, 160),
    looseCentrePx: clamp(72 * scale, 36, 120),
  };
}

/** True when centre, 5, and 10 form a plausible printed dial (loose finger tolerance). */
export function tapsGeometricallyConsistent(centre, five, ten, tolerances = null) {
  const c = pointOf(centre);
  const f = pointOf(five);
  const t = pointOf(ten);
  if (!c || !f || !t) return false;
  const est = estimateGaugeRadiusFromTaps(c, f, t);
  const tol = tolerances || scaledTapTolerances(est);
  const markPx = markResidualPx(c, f, t);
  const centrePx = centreResidualPx(c, f, t);
  const fiveR = pointDist(c, f);
  const tenR = pointDist(c, t);
  const radiusRatio = fiveR / Math.max(1, tenR);
  const sweep = clockwiseDeg(pointAngle(c, f), pointAngle(c, t));
  const sweepErr = Math.abs(wrapDelta(sweep, MARK_SWEEP_DEG));
  if (sweepErr > 22) return false;
  if (markPx > tol.looseMarkPx) return false;
  if (centrePx > tol.looseCentrePx) return false;
  if (radiusRatio < 0.55 || radiusRatio > 1.45) return false;
  const minR = est * 0.45;
  const maxR = est * 1.55;
  if (fiveR < minR || tenR < minR || fiveR > maxR || tenR > maxR) return false;
  return true;
}

/** Plain-language redo hint for the sheet. */
export function formatTapRejectReason(result) {
  if (!result || result.ok) return '';
  if (result.userPlaced) return '';
  const named = result.redo || 'centre';
  if (result.reason === 'hub' || named === 'centre') {
    if (result.geometry && result.geometry.centrePx > (result.geometry.markPx || 0) * 0.9) {
      return 'Centre tap does not line up with your 5 and 10 — adjust the pivot.';
    }
    return 'Centre tap missed the pivot — try again.';
  }
  if (named === 'five') return 'The 5 tap does not match your centre and 10 — try the printed 5 again.';
  if (named === 'ten') return 'The 10 tap does not match your centre and 5 — try the printed 10 again.';
  if (result.reason === 'needle') return 'Could not read the rest needle on this frame — refreeze with the needle visible.';
  if (result.reason === 'unregistered') return 'Could not read the colour bands — tap closer to the printed 5 and 10.';
  return 'Tap calibration failed — try again.';
}

export const USER_PLACED_NOTE = 'Using your taps as placed';
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
export function detectBadTap(centre, five, ten, snapped = null, badTapPx = BAD_TAP_PX) {
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
      .filter(([, px]) => px > badTapPx)
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
export function rimMeasure(image, cx, cy, angles = 36, rStep = 1, radiusPrior = REFERENCE_GAUGE_RADIUS_PX) {
  const { data, width, height } = image;
  const radii = [];
  const prevGap = Math.max(2, rStep);
  const scale = radiusPrior / REFERENCE_GAUGE_RADIUS_PX;
  const faceRs = [48, 56, 64].map((r) => r * scale);
  const outsideRs = [112, 120].map((r) => r * scale);
  const rMin = 70 * scale;
  const rMax = 115 * scale;
  for (let i = 0; i < angles; i += 1) {
    const angle = (i / angles) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const at = (r) => lumaAt(data, width, height, Math.round(cx + r * cos), Math.round(cy + r * sin));
    const faceSamples = faceRs.map((r) => at(r)).filter((v) => v != null);
    const outsideSamples = outsideRs.map((r) => at(r)).filter((v) => v != null);
    if (faceSamples.length < 2 || outsideSamples.length < 1) continue;
    const face = faceSamples.reduce((s, v) => s + v, 0) / faceSamples.length;
    const outside = outsideSamples.reduce((s, v) => s + v, 0) / outsideSamples.length;
    if (outside < face + 12) continue;
    const mid = face + (outside - face) * 0.55;
    let cross = 0;
    for (let r = rMin; r <= rMax; r += rStep) {
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

function searchRim(image, prior, span, step, radiusPrior = 0, angles = 36, rStep = 1, strictMin = false, measurePrior = REFERENCE_GAUGE_RADIUS_PX) {
  let best = null;
  const x0 = prior.x;
  const y0 = prior.y;
  for (let dy = -span; dy <= span; dy += step) {
    const cy = y0 + dy;
    for (let dx = -span; dx <= span; dx += step) {
      const cx = x0 + dx;
      if (dx * dx + dy * dy > span * span) continue;
      const measured = rimMeasure(image, cx, cy, angles, rStep, measurePrior);
      if (!measured) continue;
      if (radiusPrior > 20) {
        const scale = measured.radius / radiusPrior;
        if (scale < 0.82 || scale > 1.22) continue;
      }
      const dist = dx * dx + dy * dy;
      const nearer = !strictMin && best && Math.abs(measured.std - best.std) < 0.35 && dist < best.dist;
      const stricter = strictMin && (
        !best
        || measured.std < best.std - 0.05
        || (Math.abs(measured.std - best.std) <= 0.05 && dist < best.dist)
      );
      if (!best || measured.std < best.std - 0.35 || nearer || stricter) {
        best = {
          x: cx,
          y: cy,
          radius: measured.radius,
          std: measured.std,
          score: Math.max(0, (12 - measured.std) / 12),
          dist,
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
function snapHubContrast(image, origin, windowPx, estRadius = REFERENCE_GAUGE_RADIUS_PX) {
  const step = Math.max(1, Math.round(estRadius * 0.028));
  const minR = Math.max(22, Math.round(estRadius * 0.72));
  const maxR = Math.round(estRadius * 1.38);
  const coarse = searchBezel(image, origin, windowPx, 2, radiusList(minR, maxR, step));
  if (!coarse || coarse.score < 0.28) {
    return { ...origin, radius: coarse?.radius ?? estRadius, score: coarse?.score ?? 0, ok: false };
  }
  const fine = searchBezel(
    image,
    coarse,
    3,
    1,
    radiusList(Math.max(20, coarse.radius - 4), coarse.radius + 4, Math.max(1, step)),
  );
  const chosen = fine && fine.score >= coarse.score ? fine : coarse;
  return { x: chosen.x, y: chosen.y, radius: chosen.radius, score: chosen.score, ok: chosen.score >= 0.34 };
}

export function snapHub(image, tap, { windowPx = HUB_WINDOW_PX, estRadius = REFERENCE_GAUGE_RADIUS_PX } = {}) {
  const origin = pointOf(tap);
  const rimSpan = Math.max(windowPx, Math.round(estRadius * 0.38));
  const coarse = searchRim(image, origin, rimSpan, 4, estRadius, 36, 1, false, estRadius);
  const fine = coarse && coarse.std <= LOST_RIM_STD
    ? searchRim(image, coarse, 4, 1, estRadius, 36, 1, false, estRadius)
    : null;
  const rim = fine && fine.std <= coarse.std ? fine : coarse;
  if (rim && rim.std <= 8.5) {
    return { x: rim.x, y: rim.y, radius: rim.radius, score: rim.score, ok: true };
  }
  return snapHubContrast(image, origin, windowPx, estRadius);
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

const TIP_BINS = 8;
const tipSamples = new Float64Array(17);
const tipSides = new Float64Array(8);
const tipDepths = new Float64Array(TIP_BINS);

/**
 * Dark valley along one direction. The samples sit on the tip side of the
 * hub (inner face out toward the numerals), never on the tail. Depth is how
 * far the centre sits below the face on either side, and only a narrow
 * valley counts — a tick is short, a printed band is wide.
 */
function tipValley(image, cx, cy, deg, radius, offsetPx) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ox = cx - sin * offsetPx;
  const oy = cy + cos * offsetPx;
  const { data, width, height } = image;
  let acc = 0;
  let bins = 0;
  let widthSum = 0;
  for (let i = 0; i < TIP_BINS; i += 1) {
    const r = radius * (0.26 + 0.52 * ((i + 0.5) / TIP_BINS));
    const x = ox + r * cos;
    const y = oy + r * sin;
    let ok = true;
    for (let s = 0; s < 17; s += 1) {
      const off = s - 8;
      const lum = lumaAt(data, width, height, Math.round(x - sin * off), Math.round(y + cos * off));
      if (lum == null) {
        ok = false;
        break;
      }
      tipSamples[s] = lum;
    }
    if (!ok) {
      tipDepths[i] = 0;
      continue;
    }
    const center = Math.min(tipSamples[7], tipSamples[8], tipSamples[9]);
    let nSide = 0;
    for (let s = 0; s < 17; s += 1) {
      if (Math.abs(s - 8) < 5) continue;
      tipSides[nSide] = tipSamples[s];
      nSide += 1;
    }
    for (let a = 1; a < nSide; a += 1) {
      const value = tipSides[a];
      let b = a;
      while (b > 0 && tipSides[b - 1] > value) {
        tipSides[b] = tipSides[b - 1];
        b -= 1;
      }
      tipSides[b] = value;
    }
    const side = tipSides[nSide >> 1];
    const depth = side - center;
    tipDepths[i] = depth;
    let dark = 0;
    for (let s = 0; s < 17; s += 1) if (tipSamples[s] < side - 4) dark += 1;
    if (depth > 5 && dark >= 2 && dark <= 8) {
      acc += depth;
      bins += 1;
      widthSum += dark;
    }
  }
  return { acc, bins, width: bins ? widthSum / bins : 0 };
}

function tipCorr(template) {
  if (!template || template.energy < 30) return 1;
  let dot = 0;
  let energy = 0;
  for (let i = 0; i < TIP_BINS; i += 1) {
    const value = tipDepths[i];
    dot += template.depths[i] * value;
    energy += value * value;
  }
  return dot / Math.sqrt(template.energy * energy + 1e-6);
}

/** Appearance of the resting tip. The tail is not part of the template. */
export function captureTipTemplate(image, cx, cy, deg, radius) {
  const measured = tipValley(image, cx, cy, deg, radius, 0);
  const depths = Array.from(tipDepths);
  let energy = 0;
  for (let i = 0; i < TIP_BINS; i += 1) energy += depths[i] * depths[i];
  return {
    depths,
    energy,
    bins: measured.bins,
    width: measured.width,
    score: measured.acc,
  };
}

function keepTip(row) {
  if (!row) return false;
  if (row.bins >= 6 && row.corr >= 0.92 && Math.abs(row.off) <= 8) return true;
  if (row.bins >= 5 && row.corr >= 0.86 && Math.abs(row.off) <= 6 && row.raw >= 80) return true;
  return row.bins >= 5 && row.corr >= 0.9 && Math.abs(row.off) <= 4;
}

function gatherTip(image, cx, cy, radius, template, angles, priorDeg, offStep) {
  let byScore = null;
  let byCorr = null;
  for (let i = 0; i < angles.length; i += 1) {
    const deg = angles[i];
    for (let off = -8; off <= 8; off += offStep) {
      const measured = tipValley(image, cx, cy, deg, radius, off);
      if (measured.bins < 4) continue;
      const corr = Math.max(0, tipCorr(template));
      let raw = measured.acc + measured.bins * 4 - Math.abs(off) * 2.8;
      if (priorDeg != null && Math.abs(wrapDelta(deg, priorDeg)) <= 12) raw += 8;
      const row = { deg, off, raw, bins: measured.bins, corr };
      if (!byScore || raw > byScore.raw) byScore = row;
      if (corr >= 0.72 && (!byCorr || corr > byCorr.corr + 0.02 || (corr >= byCorr.corr && raw > byCorr.raw))) {
        byCorr = row;
      }
    }
  }
  return { byScore, byCorr };
}

function chooseTip(byScore, byCorr) {
  if (byCorr && byScore && Math.abs(wrapDelta(byCorr.deg, byScore.deg)) > 12) {
    const corrStrong = byCorr.corr >= byScore.corr + 0.12
      && byCorr.corr >= 0.9
      && byCorr.bins >= 5
      && byCorr.raw >= 80
      && byCorr.raw >= byScore.raw * 0.75
      && Math.abs(byCorr.off) <= 6;
    if (corrStrong) return byCorr;
    if (keepTip(byScore)) return byScore;
    return null;
  }
  if (keepTip(byScore)) return byScore;
  if (keepTip(byCorr)) return byCorr;
  return null;
}

function scanTip(image, cx, cy, radius, template, angles, priorDeg) {
  const found = gatherTip(image, cx, cy, radius, template, angles, priorDeg, 2);
  return chooseTip(found.byScore, found.byCorr);
}

function anglesNear(prior, half, zero, ten) {
  const span = clockwiseDeg(zero, ten);
  const angles = [];
  for (let delta = -half; delta <= half; delta += 2) {
    const deg = wrap360(prior + delta);
    const along = clockwiseDeg(zero, deg);
    if (along <= span + 18 || along >= 360 - 18) angles.push(deg);
  }
  return angles;
}

function anglesOnArc(zero, ten) {
  const span = clockwiseDeg(zero, ten);
  const angles = [];
  for (let delta = -16; delta <= span + 16; delta += 2) angles.push(wrap360(zero + delta));
  return angles;
}

function refineTip(image, cx, cy, radius, template, rough) {
  let best = rough;
  for (let delta = -2; delta <= 2; delta += 0.5) {
    const deg = wrap360(rough.deg + delta);
    for (let off = rough.off - 2; off <= rough.off + 2; off += 2) {
      if (Math.abs(off) > 8) continue;
      const measured = tipValley(image, cx, cy, deg, radius, off);
      if (measured.bins < 4) continue;
      const corr = Math.max(0, tipCorr(template));
      if (corr + 0.08 < rough.corr) continue;
      const raw = measured.acc + measured.bins * 4 - Math.abs(off) * 2.8;
      if (raw > best.raw) best = { deg, off, raw, bins: measured.bins, corr };
    }
  }
  return best;
}

/**
 * Match the calibrated tip inside the 0–10 arc.
 * A narrow window around the last angle is enough while the needle is
 * moving slowly. A miss widens the window, and a jump falls through to the
 * whole arc in the same frame. Nothing outside the arc is returned.
 */
export function matchTipAngle(image, cx, cy, radius, template, zeroDeg, tenDeg, priorDeg = null, misses = 0) {
  if (!template || !(radius > 12) || zeroDeg == null || tenDeg == null) return null;
  const half = misses >= 2 ? 64 : (misses === 1 ? 36 : 18);
  let found = null;
  if (priorDeg != null) {
    const near = scanTip(image, cx, cy, radius, template, anglesNear(priorDeg, half, zeroDeg, tenDeg), priorDeg);
    if (near && Math.abs(wrapDelta(near.deg, priorDeg)) <= half - 4) found = near;
  }
  if (!found) found = scanTip(image, cx, cy, radius, template, anglesOnArc(zeroDeg, tenDeg), priorDeg);
  if (!found || barFromRestSpan(found.deg, zeroDeg, tenDeg) == null) return null;
  const refined = refineTip(image, cx, cy, radius, template, found);
  if (barFromRestSpan(refined.deg, zeroDeg, tenDeg) == null) return null;
  const jump = priorDeg == null ? 0 : Math.abs(wrapDelta(refined.deg, priorDeg));
  const jumpLimit = misses >= 2 ? 150 : 85;
  if (jump > jumpLimit) return null;
  // A line that barely leaves the last angle is usually the tail or the pin.
  // The detector already had that neighbourhood and declined it.
  if (jump < 30 && refined.corr < 0.95 && refined.bins < 7) return null;
  return {
    angleDeg: refined.deg,
    quality: Math.max(NEEDLE_LOST_QUALITY, Math.min(1, refined.corr)),
    corr: refined.corr,
    bins: refined.bins,
  };
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

  const estRadius = estimateGaugeRadiusFromTaps(centreTap, fiveTap, tenTap);
  const tol = scaledTapTolerances(estRadius);
  const geometry = {
    markPx: markResidualPx(centreTap, fiveTap, tenTap),
    centrePx: centreResidualPx(centreTap, fiveTap, tenTap),
  };
  const snapAttempt = snapHub(image, centreTap, { windowPx: tol.hubWindowPx, estRadius });
  const snapHubPx = snapAttempt.ok ? pointDist(snapAttempt, centreTap) : Number.POSITIVE_INFINITY;
  const geomOk = tapsGeometricallyConsistent(centreTap, fiveTap, tenTap, tol);
  let userPlaced = false;
  let hub;
  let hubPx;

  if (geomOk) {
    hub = {
      x: centreTap.x,
      y: centreTap.y,
      radius: estRadius,
      score: snapAttempt.ok ? snapAttempt.score : 0,
      ok: true,
    };
    hubPx = 0;
    userPlaced = true;
  } else if (!snapAttempt.ok || snapHubPx > tol.badTapPx) {
    return {
      ok: false,
      redo: 'centre',
      reason: 'hub',
      hub: snapAttempt,
      geometry,
      snapPx: { centre: snapHubPx, five: null, ten: null },
    };
  } else {
    hub = snapAttempt;
    hubPx = snapHubPx;
  }

  const needle = readNeedleAt(image, hub.x, hub.y, hub.radius);
  let marks = snapScaleMarks(image, hub, fiveTap, tenTap, needle.angleDeg);
  if (geomOk) {
    const fiveDeg = pointAngle(hub, fiveTap);
    const tenDeg = pointAngle(hub, tenTap);
    const snapped = marks.ok ? marks : {};
    marks = {
      ok: true,
      five: fiveTap,
      ten: tenTap,
      fiveDeg,
      tenDeg,
      fivePx: 0,
      tenPx: 0,
      rotationDeg: snapped.rotationDeg ?? 0,
      colorRadius: hub.radius * 1.4,
      margin: snapped.margin ?? 0,
      bands: snapped.bands,
    };
    userPlaced = true;
  } else if (!marks.ok) {
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
    hubPx: geomOk ? 0 : hubPx,
    fivePx: geomOk ? 0 : marks.fivePx,
    tenPx: geomOk ? 0 : marks.tenPx,
  }, tol.badTapPx);
  if (named.bad && !geomOk) {
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
  const needleWeak = needle.angleDeg == null || (needle.quality ?? 0) < NEEDLE_LOST_QUALITY * 0.5;
  if (needleWeak && !userPlaced) {
    return { ok: false, redo: null, reason: 'needle', hub, marks };
  }

  let zeroAngleDeg = needleWeak
    ? wrap360(marks.tenDeg - FLAIR_58_SCALE.sweepDeg)
    : chooseRestNeedle(needle.angleDeg, marks.tenDeg);
  let tenAngleDeg = marks.tenDeg;
  let fiveAngleDeg = marks.fiveDeg;
  const r6 = taps.r6Anchor ?? taps.r6;
  if (r6 && typeof r6 === 'object') {
    const reg = regularizeTapAnchors(
      { zeroAngleDeg, fiveAngleDeg, tenAngleDeg },
      hub,
      fiveTap,
      tenTap,
      r6,
    );
    zeroAngleDeg = reg.zeroAngleDeg;
    fiveAngleDeg = reg.fiveAngleDeg;
    tenAngleDeg = reg.tenAngleDeg;
  }
  const spanDeg = clockwiseDeg(zeroAngleDeg, tenAngleDeg);
  const fiveBar = fiveCheckBar(fiveAngleDeg, zeroAngleDeg, tenAngleDeg);
  const templateBands = marks.bands
    ? packTemplate(marks.bands)
    : packTemplate(fixedBands(image, hub.x, hub.y, marks.colorRadius, zeroAngleDeg));
  return {
    ok: true,
    redo: null,
    reason: null,
    userPlaced,
    userPlacedNote: userPlaced ? USER_PLACED_NOTE : null,
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
      needleTemplate: captureTipTemplate(image, hub.x, hub.y, zeroAngleDeg, hub.radius),
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
    needleMisses: 0,
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
  const prevShift = tracker.pose.shiftDeg || 0;
  const zeroPrior = wrap360(tracker.calibration.zeroAngleDeg + prevShift);
  const tenPrior = wrap360(tracker.calibration.tenAngleDeg + prevShift);
  let needle = { angleDeg: null, quality: 0, likeness: 0 };
  if (bezelOk) {
    needle = readNeedleAt(image, pose.x, pose.y, pose.radius);
    const detectorOnArc = barFromRestSpan(needle.angleDeg, zeroPrior, tenPrior) != null
      && (needle.quality ?? 0) >= NEEDLE_LOST_QUALITY;
    if (detectorOnArc) {
      tracker.needleMisses = 0;
    } else if (tracker.calibration.needleTemplate) {
      const matched = matchTipAngle(
        image,
        pose.x,
        pose.y,
        pose.radius,
        tracker.calibration.needleTemplate,
        zeroPrior,
        tenPrior,
        tracker.needleDeg,
        tracker.needleMisses || 0,
      );
      if (matched) {
        const gap = Math.abs(wrapDelta(matched.angleDeg, tracker.needleDeg));
        const angleDeg = gap <= 4
          ? wrap360(tracker.needleDeg + wrapDelta(matched.angleDeg, tracker.needleDeg) * 0.7)
          : matched.angleDeg;
        needle = { angleDeg, quality: matched.quality, likeness: matched.corr };
        tracker.needleMisses = 0;
      } else {
        tracker.needleMisses = Math.min(4, (tracker.needleMisses || 0) + 1);
        needle = { angleDeg: null, quality: 0, likeness: 0 };
      }
    }
  }
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

/**
 * Stored-frame pixel → the pixel ffmpeg autorotate shows.
 * Tap files are unmirrored pixels of the 1280×720 file (display matrix
 * still attached). The replay stills are that file after the same
 * rotation, so a 90° or 180° clip otherwise snaps the taps onto the
 * wrong part of the picture. Quarter turns only; anything else is
 * already in display space.
 */
export function mapStoredTapPoint(point, width, height, rotationDeg) {
  const p = pointOf(point);
  if (!p || !(width > 1) || !(height > 1)) return null;
  const quarter = ((Math.round(Number(rotationDeg)) % 360) + 360) % 360;
  if (quarter === 90) return { x: p.y, y: width - 1 - p.x };
  if (quarter === 270) return { x: height - 1 - p.y, y: p.x };
  if (quarter === 180) return { x: width - 1 - p.x, y: height - 1 - p.y };
  return { x: p.x, y: p.y };
}

function writeTapPoint(original, mapped) {
  if (!mapped) return original;
  if (Array.isArray(original)) return [mapped.x, mapped.y];
  if (original && typeof original === 'object') return { ...original, x: mapped.x, y: mapped.y };
  return [mapped.x, mapped.y];
}

/** Map centre / 5 / 10 into the autorotated still. `atSec` stays on the clip clock. */
export function tapsForDisplayFrame(taps, { width, height, rotationDeg = 0 } = {}) {
  if (!taps) return null;
  const quarter = ((Math.round(Number(rotationDeg)) % 360) + 360) % 360;
  if (quarter !== 90 && quarter !== 180 && quarter !== 270) return taps;
  const centre = taps.centre ?? taps[0];
  const five = taps.five ?? taps[1];
  const ten = taps.ten ?? taps[2];
  const mapped = {
    centre: writeTapPoint(centre, mapStoredTapPoint(centre, width, height, quarter)),
    five: writeTapPoint(five, mapStoredTapPoint(five, width, height, quarter)),
    ten: writeTapPoint(ten, mapStoredTapPoint(ten, width, height, quarter)),
  };
  if (taps.atSec != null) mapped.atSec = taps.atSec;
  return mapped;
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
  const atSec = Number(hook.atSec);
  return { centre, five, ten, atSec: Number.isFinite(atSec) ? atSec : null };
}

/** Half-second after atSec. The replay still clock is 8 Hz, so the window holds a few frames. */
export const TAP_CAL_WINDOW_S = 0.5;

/**
 * Replay media time in seconds. Prefer the still's own timestamp.
 * `video.currentTime` on the canvas stand-in is missing, and `Number(missing) || 0`
 * keeps the window shut for every atSec after the first half-second.
 */
export function replayMediaTimeSec(mediaTimeS, mediaNowMs) {
  if (mediaTimeS != null && mediaTimeS !== '' && Number.isFinite(Number(mediaTimeS))) {
    return Number(mediaTimeS);
  }
  const ms = Number(mediaNowMs);
  if (Number.isFinite(ms)) return ms / 1000;
  return 0;
}

/** Open when atSec is omitted (first frame) or sampleT sits in [atSec, atSec + 0.5). */
export function replayTapWindowOpen(sampleT, atSec) {
  if (atSec == null || !Number.isFinite(Number(atSec))) return true;
  if (!Number.isFinite(sampleT)) return false;
  const start = Number(atSec);
  return sampleT + 1e-3 >= start && sampleT < start + TAP_CAL_WINDOW_S;
}

/**
 * Hold the legacy lock until the tap window has closed.
 * A clip that is readable on frame one (084814) otherwise locks before atSec
 * and never spends a sample in CALIBRATING.
 */
export function shouldDeferLegacyLock({ injected, applied, sampleT }) {
  if (applied || !injected) return false;
  const atSec = Number(injected.atSec);
  if (!Number.isFinite(atSec)) return false;
  return Number(sampleT) < atSec + TAP_CAL_WINDOW_S;
}

/** Anchors the replay JSON records after a tap calibration. No image templates. */
export function tapAnchorRecord(calibration) {
  if (!calibration) return null;
  const pt = (point) => (
    point && Number.isFinite(point.x) && Number.isFinite(point.y)
      ? { x: point.x, y: point.y }
      : null
  );
  return {
    centre: pt(calibration.hub),
    five: pt(calibration.five),
    ten: pt(calibration.ten),
    zeroAngleDeg: calibration.zeroAngleDeg ?? null,
    fiveAngleDeg: calibration.fiveAngleDeg ?? null,
    tenAngleDeg: calibration.tenAngleDeg ?? null,
    spanDeg: calibration.spanDeg ?? null,
    radius: calibration.radius ?? null,
  };
}
