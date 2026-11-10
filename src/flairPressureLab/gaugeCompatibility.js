import { NEEDLE_LOST_QUALITY, wrap360, wrapDelta } from './gaugeConfig.js';
import { barToDialAngle, CANONICAL_ZERO_BAR_ANGLE_DEG } from './dialFaceTemplate.js';

export const GAUGE_COMPATIBILITY = {
  supported: 'original-flair-58-v1',
  uncertain: 'uncertain',
  unsupported: 'unsupported',
};
export const REST_REFERENCE_TOLERANCE_DEG = 15;

export function isVerifiedGaugeCalibration(calibration) {
  return calibration?.compatibility === GAUGE_COMPATIBILITY.supported;
}

// The original face has a physical stop pin and no printed zero numeral.
// The design angle from that pin to printed 5 is independent of the pointer.
export function expectedFlairRestAngle(fiveDeg) {
  return wrap360(fiveDeg - wrap360(barToDialAngle(5) - CANONICAL_ZERO_BAR_ANGLE_DEG));
}

function pixel(image, x, y) {
  const col = Math.round(x);
  const row = Math.round(y);
  if (col < 0 || row < 0 || col >= image.width || row >= image.height) return null;
  const i = (row * image.width + col) * 4;
  const [r, g, b] = [image.data[i], image.data[i + 1], image.data[i + 2]];
  return { luma: 0.299 * r + 0.587 * g + 0.114 * b, red: (r - Math.max(g, b)) / ((r + g + b) / 3 + 1) };
}

function sample(image, hub, angle, radius, offset = 0) {
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return pixel(image, hub.x + radius * cos - offset * sin, hub.y + radius * sin + offset * cos);
}

function sector(image, hub, start, end, radius, fractions) {
  const points = [];
  for (let angle = start; angle <= end; angle += 5) {
    for (const fraction of fractions) {
      const point = sample(image, hub, angle, radius * fraction);
      if (point) points.push(point);
    }
  }
  return points;
}

function quantile(points, key, fraction) {
  return points.map((point) => point[key]).sort((a, b) => a - b)[Math.floor(points.length * fraction)];
}

export function hasOriginalFlairFace(image, hub, five, ten, radius) {
  const sweep = wrap360(ten - five);
  if (Math.abs(sweep - 90) > 22) return false;
  const espresso = sector(image, hub, five + sweep * 0.2, five + sweep * 0.8, radius, [0.75, 0.87, 0.99]);
  const plain = sector(image, hub, five - 70, five - 25, radius, [0.63, 0.74, 0.85]);
  const stop = sector(image, hub, ten + 40, ten + 100, radius, [1.05, 1.15, 1.25]);
  const blank = sector(image, hub, five - 70, five - 25, radius, [1.05, 1.15, 1.25]);
  if (Math.min(espresso.length, plain.length, stop.length, blank.length) < 24) return false;
  const plainRed = quantile(plain, 'red', 0.5);
  const redFloor = Math.max(0.015, plainRed + 0.06);
  return quantile(espresso, 'red', 0.5) >= redFloor
    && quantile(stop, 'luma', 0.25) < quantile(blank, 'luma', 0.5) * 0.8;
}

// A narrow bright ray with dark shoulders over most of its length is evidence
// of a light pointer. An isolated reflection or mark does not meet this test.
function hasLightPointer(image, hub, radius) {
  const shoulder = Math.max(2, radius * 0.065);
  for (let angle = 0; angle < 360; angle += 2) {
    let bright = 0;
    for (const fraction of [0.28, 0.36, 0.44, 0.52, 0.60, 0.68, 0.76]) {
      const distance = radius * fraction;
      const tip = sample(image, hub, angle, distance);
      const left = sample(image, hub, angle, distance, -shoulder);
      const right = sample(image, hub, angle, distance, shoulder);
      if (!tip || !left || !right) continue;
      const face = Math.max(left.luma, right.luma);
      if (face < 145 && tip.luma - face > Math.max(18, face * 0.3) && tip.red < 0.15) bright += 1;
    }
    if (bright >= 6) return true;
  }
  return false;
}

export function verifyGaugeCompatibility(image, { hub, fiveDeg, tenDeg, radius, needleDeg, needleQuality }) {
  const expectedRestDeg = expectedFlairRestAngle(fiveDeg);
  const restErrorDeg = Number.isFinite(needleDeg) ? Math.abs(wrapDelta(needleDeg, expectedRestDeg)) : null;
  if (hasLightPointer(image, hub, radius)) {
    return { state: GAUGE_COMPATIBILITY.unsupported, reason: 'light-pointer' };
  }
  if (!hasOriginalFlairFace(image, hub, fiveDeg, tenDeg, radius)) {
    return { state: GAUGE_COMPATIBILITY.uncertain, reason: 'printed-face' };
  }
  if (restErrorDeg == null || !(needleQuality >= NEEDLE_LOST_QUALITY)) {
    return { state: GAUGE_COMPATIBILITY.uncertain, reason: 'rest-needle' };
  }
  if (restErrorDeg > REST_REFERENCE_TOLERANCE_DEG) {
    return { state: GAUGE_COMPATIBILITY.uncertain, reason: 'rest-mismatch', expectedRestDeg, restErrorDeg };
  }
  return { state: GAUGE_COMPATIBILITY.supported, reason: 'verified', expectedRestDeg, restErrorDeg };
}
