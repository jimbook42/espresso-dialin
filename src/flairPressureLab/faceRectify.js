import { grayscale } from './framePrep.js';
import { FLAIR_58_SCALE } from './gaugeConfig.js';

/**
 * Turn an oblique gauge face into a front-on circle.
 * The candidate circle is only a search window. A full ellipse fit runs on
 * acquisition and when the tracked rim no longer agrees. Later frames nudge
 * the centre from a few rim samples and reuse the warp maps.
 *
 * An oblique close camera maps the circular face to an ellipse whose centre
 * is not the needle pivot. Affine axis scaling leaves the half-bar ticks
 * uneven. A one-parameter disk homography, fit so those ticks land on the
 * printed spacing, puts the pivot back at the circle centre.
 */

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function sampleGray(gray, width, height, x, y) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= width || yi >= height) return null;
  return gray[yi * width + xi];
}

/**
 * One strong radial edge per ray, in a band around the candidate circle.
 * A missing ray (occluder, glare) is left out. Nothing here fills the gap.
 */
export function collectBezelPoints(image, cx, cy, radius) {
  if (!image?.data || !(radius > 4)) return [];
  const { width, height } = image;
  const gray = grayscale(image.data, width, height);
  const rays = 120;
  const bandIn = radius * 0.52;
  const bandOut = radius * 1.48;
  const gap = Math.max(1, radius * 0.015);
  const step = Math.max(1, radius / 90);
  const points = [];
  for (let i = 0; i < rays; i += 1) {
    const angle = (i / rays) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let best = 0;
    let bestR = 0;
    for (let r = bandIn; r <= bandOut; r += step) {
      const inner = sampleGray(gray, width, height, cx + (r - gap) * cos, cy + (r - gap) * sin);
      const outer = sampleGray(gray, width, height, cx + (r + gap) * cos, cy + (r + gap) * sin);
      if (inner == null || outer == null) continue;
      const strength = Math.abs(outer - inner);
      if (strength > best) {
        best = strength;
        bestR = r;
      }
    }
    if (best < 8) continue;
    points.push({
      x: cx + bestR * cos,
      y: cy + bestR * sin,
      strength: best,
      angle,
    });
  }
  if (points.length < 8) return points;
  const strengths = points.map((point) => point.strength).sort((a, b) => a - b);
  const median = strengths[strengths.length >> 1];
  const kept = points.filter((point) => point.strength >= median * 0.35);
  return kept.length >= 8 ? kept : points;
}

function residualPx(point, ellipse) {
  const a = ellipse.size.width / 2;
  const b = ellipse.size.height / 2;
  if (!(a > 1) || !(b > 1)) return Infinity;
  const phi = (ellipse.angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = point.x - ellipse.center.x;
  const dy = point.y - ellipse.center.y;
  const u = dx * cos + dy * sin;
  const v = -dx * sin + dy * cos;
  return Math.abs(Math.hypot(u / a, v / b) - 1) * ((a + b) / 2);
}

function fitOnce(cv, points) {
  if (!cv?.fitEllipse || points.length < 5) return null;
  const data = new Float32Array(points.length * 2);
  for (let i = 0; i < points.length; i += 1) {
    data[i * 2] = points[i].x;
    data[i * 2 + 1] = points[i].y;
  }
  const mat = cv.matFromArray(points.length, 1, cv.CV_32FC2, data);
  try {
    const rect = cv.fitEllipse(mat);
    const width = rect?.size?.width;
    const height = rect?.size?.height;
    if (!(width > 1) || !(height > 1)) return null;
    return {
      center: { x: rect.center.x, y: rect.center.y },
      size: { width, height },
      angle: rect.angle,
    };
  } catch {
    return null;
  } finally {
    mat.delete();
  }
}

function medianOf(values) {
  const copy = values.slice().sort((a, b) => a - b);
  return copy[copy.length >> 1];
}

/** Fit, drop rim points the ellipse does not explain, and fit again. */
export function fitBezelEllipse(cv, points) {
  let current = points;
  let ellipse = null;
  for (let pass = 0; pass < 3; pass += 1) {
    ellipse = fitOnce(cv, current);
    if (!ellipse) return null;
    const residuals = current.map((point) => residualPx(point, ellipse));
    const median = medianOf(residuals);
    const absDev = residuals.map((value) => Math.abs(value - median));
    const mad = medianOf(absDev) || 1;
    const major = Math.max(ellipse.size.width, ellipse.size.height);
    const gate = Math.max(median + mad * 3.5, major * 0.045);
    const next = current.filter((_, index) => residuals[index] <= gate);
    if (next.length < 6 || next.length === current.length) break;
    current = next;
  }
  if (!ellipse || current.length < 6) return null;
  return { ellipse, points: current };
}

function largestAngularGap(points, ellipse) {
  if (points.length < 3) return 360;
  const angles = points.map((point) => {
    const phi = (ellipse.angle * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = point.x - ellipse.center.x;
    const dy = point.y - ellipse.center.y;
    const u = dx * cos + dy * sin;
    const v = -dx * sin + dy * cos;
    return Math.atan2(v, u);
  }).sort((a, b) => a - b);
  let gap = angles[0] + Math.PI * 2 - angles[angles.length - 1];
  for (let i = 1; i < angles.length; i += 1) gap = Math.max(gap, angles[i] - angles[i - 1]);
  return (gap * 180) / Math.PI;
}

function ellipseUsable(ellipse, points, candidate) {
  const major = Math.max(ellipse.size.width, ellipse.size.height);
  const minor = Math.min(ellipse.size.width, ellipse.size.height);
  if (!(major > 4) || minor / major < 0.28) return false;
  const centreShift = Math.hypot(ellipse.center.x - candidate.cx, ellipse.center.y - candidate.cy);
  if (centreShift > candidate.radius * 0.55) return false;
  const meanAxis = (major + minor) / 4;
  if (meanAxis < candidate.radius * 0.4 || meanAxis > candidate.radius * 2.1) return false;
  if (largestAngularGap(points, ellipse) > 200) return false;
  return true;
}

function cropImage(image, x0, y0, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const src = ((y0 + y) * image.width + x0) * 4;
    data.set(image.data.subarray(src, src + width * 4), y * width * 4);
  }
  return { data, width, height };
}

/** Printed half-bar step. 0–10 bar is twenty of these, from the design sweep. */
function halfBarSpacingDeg() {
  const steps = (FLAIR_58_SCALE.maxBar - FLAIR_58_SCALE.minBar) / 0.5;
  return FLAIR_58_SCALE.sweepDeg / steps;
}

function lumaAt(image, x, y) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= image.width || yi >= image.height) return null;
  const o = (yi * image.width + xi) * 4;
  const data = image.data;
  return data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
}

/** OpenCV RotatedRect: `angle` is degrees, clockwise in y-down image coordinates. */
function ellipsePoint(ellipse, theta) {
  const a = ellipse.size.width / 2;
  const b = ellipse.size.height / 2;
  const phi = (ellipse.angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const u = a * Math.cos(theta);
  const v = b * Math.sin(theta);
  return {
    x: ellipse.center.x + u * cos - v * sin,
    y: ellipse.center.y + u * sin + v * cos,
  };
}

/**
 * Disk automorphism. `d` is the projected circle centre in the unit frame
 * whose origin is the ellipse centre. Forward maps a frontal point to that frame.
 */
function diskForward(fx, fy, dx, dy) {
  const rho = Math.hypot(dx, dy);
  if (rho < 1e-8) return { x: fx, y: fy };
  const phi = Math.atan2(dy, dx);
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const scale = Math.sqrt(Math.max(0, 1 - rho * rho));
  const xr = fx * c + fy * s;
  const yr = -fx * s + fy * c;
  const den = 1 + rho * xr;
  if (!(Math.abs(den) > 1e-8)) return { x: fx, y: fy };
  const ox = (xr + rho) / den;
  const oy = (scale * yr) / den;
  return { x: ox * c - oy * s, y: ox * s + oy * c };
}

function diskInverse(u, v, dx, dy) {
  const rho = Math.hypot(dx, dy);
  if (rho < 1e-8) return { x: u, y: v };
  const phi = Math.atan2(dy, dx);
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const scale = Math.sqrt(Math.max(0, 1 - rho * rho));
  const ur = u * c + v * s;
  const vr = -u * s + v * c;
  const den = 1 - rho * ur;
  if (!(Math.abs(den) > 1e-8)) return null;
  const xr = (ur - rho) / den;
  const yr = (scale * vr) / den;
  return { x: xr * c - yr * s, y: xr * s + yr * c };
}

/** Frontal dial angle → angle on the affinely normalised ellipse. Radians. */
export function projectDialAngle(frontalRad, dx, dy) {
  const point = diskForward(Math.cos(frontalRad), Math.sin(frontalRad), dx, dy);
  return Math.atan2(point.y, point.x);
}

/** Angle on the affinely normalised ellipse → frontal dial angle. Radians. */
export function correctObservedAngle(observedRad, dx, dy) {
  const point = diskInverse(Math.cos(observedRad), Math.sin(observedRad), dx, dy);
  if (!point) return observedRad;
  return Math.atan2(point.y, point.x);
}

/** Unit-circle coordinates of an affinely normalised point → frontal coordinates. */
export function normalizedToFrontal(u, v, dx, dy) {
  return diskInverse(u, v, dx, dy);
}

function wrapDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * Walk successive marks about one half-bar apart and score them against a
 * fixed spacing. A lattice that only keeps the nearest hits hides a stretch.
 */
function chainFit(angleDegs, spacing) {
  if (!angleDegs || angleDegs.length < 6 || !(spacing > 0)) return null;
  const sorted = angleDegs.map((deg) => wrapDeg(deg)).sort((a, b) => a - b);
  const ring = sorted.concat(sorted.map((deg) => deg + 360));
  const tol = spacing * 0.85;
  let best = null;
  for (let start = 0; start < sorted.length; start += 1) {
    const seq = [{ deg: sorted[start], step: 0 }];
    let expected = sorted[start] + spacing;
    let from = start + 1;
    let step = 1;
    let skips = 0;
    while (seq.length < 24 && step < 24) {
      let pick = -1;
      let dist = tol;
      for (let j = from; j < ring.length; j += 1) {
        const delta = ring[j] - expected;
        if (delta > tol) break;
        const absDelta = Math.abs(delta);
        if (absDelta < dist) {
          dist = absDelta;
          pick = j;
        }
      }
      if (pick < 0) {
        skips += 1;
        if (skips > 2) break;
        expected += spacing;
        step += 1;
        continue;
      }
      skips = 0;
      seq.push({ deg: ring[pick], step });
      from = pick + 1;
      expected += spacing;
      step += 1;
    }
    if (seq.length < 6) continue;
    let acc = 0;
    for (let k = 0; k < seq.length; k += 1) acc += seq[k].deg - seq[k].step * spacing;
    const phase = acc / seq.length;
    const resid = seq.map((item) => item.deg - (phase + item.step * spacing));
    let sum = 0;
    for (let k = 0; k < resid.length; k += 1) sum += resid[k] * resid[k];
    const rms = Math.sqrt(sum / resid.length);
    const span = seq[seq.length - 1].deg - seq[0].deg;
    const score = rms + Math.max(0, 12 - seq.length) * 0.35;
    if (!best || score < best.score) {
      best = { rms, inliers: seq.length, span, phase, resid, score };
    }
  }
  return best;
}

function scoreOffset(observedRad, dx, dy, spacing) {
  const degs = observedRad.map((rad) => wrapDeg((correctObservedAngle(rad, dx, dy) * 180) / Math.PI));
  return chainFit(degs, spacing);
}

/**
 * Perspective offset that puts observed tick angles on the printed half-bar lattice.
 * Returns a zero offset when the affine angles are already uniform.
 * @param {number[]} observedRad parametric angles on the fitted ellipse
 */
export function fitPerspectiveOffset(observedRad) {
  const spacing = halfBarSpacingDeg();
  const affine = observedRad?.length
    ? scoreOffset(observedRad, 0, 0, spacing)
    : null;
  const degs = (observedRad || []).map((rad) => wrapDeg((rad * 180) / Math.PI)).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < degs.length; i += 1) gaps.push(Math.round((degs[i] - degs[i - 1]) * 10) / 10);
  const zero = {
    dx: 0,
    dy: 0,
    rms: affine?.rms ?? 180,
    affineRms: affine?.rms ?? 180,
    inliers: affine?.inliers ?? 0,
    span: affine?.span ?? 0,
    spacing,
    peaks: degs.length,
    gaps,
  };
  if (!affine || affine.inliers < 6) return zero;
  if (affine.rms <= 0.9 && affine.inliers >= 12 && affine.span >= 100) return zero;
  let best = { ...zero, fitRms: affine.rms };
  const consider = (dx, dy) => {
    const fit = scoreOffset(observedRad, dx, dy, spacing);
    if (!fit || fit.inliers < 6 || fit.span < 40 || fit.rms > 2.6) return;
    const fitScore = fit.rms + Math.max(0, 12 - fit.inliers) * 0.35;
    const bestScore = best.rms + Math.max(0, 12 - (best.inliers || 0)) * 0.35;
    if (fitScore < bestScore - 0.05) {
      best = { dx, dy, rms: fit.rms, affineRms: affine.rms, inliers: fit.inliers, span: fit.span, spacing };
    }
  };
  for (let ir = 1; ir <= 20; ir += 1) {
    const rho = ir * 0.025;
    for (let ip = 0; ip < 24; ip += 1) {
      const phi = (ip / 24) * Math.PI * 2;
      consider(rho * Math.cos(phi), rho * Math.sin(phi));
    }
  }
  if (best.dx !== 0 || best.dy !== 0) {
    const rho = Math.hypot(best.dx, best.dy);
    const phi = Math.atan2(best.dy, best.dx);
    for (let ir = -4; ir <= 4; ir += 1) {
      const rhoTry = rho + ir * 0.006;
      if (rhoTry <= 0.02 || rhoTry >= 0.52) continue;
      for (let ip = -4; ip <= 4; ip += 1) {
        const phiTry = phi + ip * (Math.PI / 90);
        consider(rhoTry * Math.cos(phiTry), rhoTry * Math.sin(phiTry));
      }
    }
  }
  if (best.rms > affine.rms - 0.4 || best.span < 40 || best.rms > 1.8 || best.inliers < 6) return zero;
  return best;
}

function meanAlong(gray, width, height, cx, cy, sx, sy, fracs) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < fracs.length; i += 1) {
    const value = sampleGray(gray, width, height, cx + sx * fracs[i], cy + sy * fracs[i]);
    if (value == null) continue;
    sum += value;
    n += 1;
  }
  return n ? sum / n : null;
}

function tickPeakRadians(gray, width, height, ellipse) {
  const n = 720;
  const score = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const edge = ellipsePoint(ellipse, (i / n) * Math.PI * 2);
    const sx = edge.x - ellipse.center.x;
    const sy = edge.y - ellipse.center.y;
    // The tick radius is not a fixed fraction once the pivot leaves the ellipse centre.
    let best = 0;
    for (let f = 0.58; f <= 0.96; f += 0.025) {
      const here = sampleGray(gray, width, height, ellipse.center.x + sx * f, ellipse.center.y + sy * f);
      const inner = sampleGray(
        gray,
        width,
        height,
        ellipse.center.x + sx * (f - 0.07),
        ellipse.center.y + sy * (f - 0.07),
      );
      if (here == null || inner == null) continue;
      const contrast = inner - here;
      if (contrast > best) best = contrast;
    }
    score[i] = best;
  }
  const smooth = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    for (let k = -2; k <= 2; k += 1) sum += score[(i + k + n) % n];
    smooth[i] = sum / 5;
    if (smooth[i] > max) max = smooth[i];
  }
  if (!(max > 6)) return [];
  const floor = Math.max(6, max * 0.28);
  const peaks = [];
  for (let i = 0; i < n; i += 1) {
    const prev = smooth[(i + n - 1) % n];
    const next = smooth[(i + 1) % n];
    if (smooth[i] < floor || smooth[i] < prev || smooth[i] < next) continue;
    const denom = prev - 2 * smooth[i] + next;
    let off = 0;
    if (Math.abs(denom) > 1e-6) off = clamp(0.5 * (prev - next) / denom, -0.5, 0.5);
    peaks.push({ rad: ((i + off) / n) * Math.PI * 2, strength: smooth[i] });
  }
  peaks.sort((a, b) => b.strength - a.strength);
  const minSep = (halfBarSpacingDeg() * Math.PI) / 180 * 0.55;
  const kept = [];
  for (let i = 0; i < peaks.length; i += 1) {
    const rad = peaks[i].rad;
    let crowded = false;
    for (let j = 0; j < kept.length; j += 1) {
      let delta = Math.abs(rad - kept[j]);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      if (delta < minSep) {
        crowded = true;
        break;
      }
    }
    if (!crowded) kept.push(rad);
    if (kept.length >= 24) break;
  }
  return kept;
}

/**
 * Uniformity of dark rim marks on an already-circular face.
 * Residuals are degrees from the printed half-bar lattice (phase is free).
 */
export function measurePrintedTickResidual(image, cx, cy, radius) {
  if (!image?.data || !(radius > 4)) return null;
  const gray = grayscale(image.data, image.width, image.height);
  const ellipse = {
    center: { x: cx, y: cy },
    size: { width: radius * 2, height: radius * 2 },
    angle: 0,
  };
  const peaks = tickPeakRadians(gray, image.width, image.height, ellipse);
  if (peaks.length < 8) return null;
  const spacing = halfBarSpacingDeg();
  const fit = scoreOffset(peaks, 0, 0, spacing);
  if (!fit) return null;
  return {
    spacing,
    rms: fit.rms,
    inliers: fit.inliers,
    span: fit.span,
    count: peaks.length,
    residuals: fit.resid || [],
  };
}

/**
 * Destination pixel → source pixel. OpenCV's RotatedRect angle is clockwise
 * in image coordinates, which is the standard rotation matrix when y is down.
 */
function circleToEllipseMatrix(ellipse, outSize) {
  const a = ellipse.size.width / 2;
  const b = ellipse.size.height / 2;
  const major = Math.max(ellipse.size.width, ellipse.size.height);
  const radius = major / 2;
  const ox = outSize / 2;
  const oy = outSize / 2;
  const phi = (ellipse.angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const m00 = (a * cos) / radius;
  const m01 = (-b * sin) / radius;
  const m10 = (a * sin) / radius;
  const m11 = (b * cos) / radius;
  const m02 = ellipse.center.x - ox * m00 - oy * m01;
  const m12 = ellipse.center.y - ox * m10 - oy * m11;
  return { radius, values: [m00, m01, m02, m10, m11, m12] };
}

function shapeKey(ellipse, dx, dy, out) {
  const q = (value, step) => Math.round(value / step);
  return [
    q(ellipse.size.width, 1),
    q(ellipse.size.height, 1),
    q(ellipse.angle, 0.5),
    q(dx, 0.008),
    q(dy, 0.008),
    out,
  ].join(':');
}

function relativeMaps(ellipse, dx, dy, out) {
  const mapX = new Float32Array(out * out);
  const mapY = new Float32Array(out * out);
  const major = Math.max(ellipse.size.width, ellipse.size.height);
  const radius = major / 2;
  const half = out / 2;
  const parked = {
    center: { x: 0, y: 0 },
    size: ellipse.size,
    angle: ellipse.angle,
  };
  const [m00, m01, m02, m10, m11, m12] = circleToEllipseMatrix(parked, out).values;
  for (let j = 0; j < out; j += 1) {
    for (let i = 0; i < out; i += 1) {
      const fx = (i - half) / radius;
      const fy = (j - half) / radius;
      const obs = diskForward(fx, fy, dx, dy);
      const ai = half + obs.x * radius;
      const aj = half + obs.y * radius;
      const k = j * out + i;
      mapX[k] = m00 * ai + m01 * aj + m02;
      mapY[k] = m10 * ai + m11 * aj + m12;
    }
  }
  return { mapX, mapY, radius };
}

function mapMat(cv, existing, out, values) {
  if (
    existing
    && existing.rows === out
    && existing.cols === out
    && existing.data32F
    && existing.data32F.length === values.length
  ) {
    existing.data32F.set(values);
    return existing;
  }
  existing?.delete?.();
  return cv.matFromArray(out, out, cv.CV_32FC1, values);
}

/** Drop cached warp maps. Does not touch image pixels. */
export function releaseWarpHold(hold) {
  if (!hold) return;
  hold.mapXMat?.delete?.();
  hold.mapYMat?.delete?.();
  hold.mapXMat = null;
  hold.mapYMat = null;
  hold.relX = null;
  hold.relY = null;
  hold.shapeKey = '';
  hold.cx = null;
  hold.cy = null;
  hold.out = 0;
  hold.radius = 0;
}

function manualWarp(image, mapX, mapY, out) {
  const data = new Uint8ClampedArray(out * out * 4);
  const width = image.width;
  const height = image.height;
  const src = image.data;
  for (let j = 0; j < out; j += 1) {
    for (let i = 0; i < out; i += 1) {
      const k = j * out + i;
      const x = mapX[k];
      const y = mapY[k];
      const dst = k * 4;
      if (!(x >= 0) || !(y >= 0) || x >= width - 1 || y >= height - 1) {
        const xi = clamp(Math.round(x), 0, width - 1);
        const yi = clamp(Math.round(y), 0, height - 1);
        const o = (yi * width + xi) * 4;
        data[dst] = src[o];
        data[dst + 1] = src[o + 1];
        data[dst + 2] = src[o + 2];
        data[dst + 3] = 255;
        continue;
      }
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const tx = x - x0;
      const ty = y - y0;
      const i00 = (y0 * width + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + width * 4;
      const i11 = i01 + 4;
      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;
      data[dst] = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
      data[dst + 1] = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
      data[dst + 2] = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
      data[dst + 3] = 255;
    }
  }
  return { data, width: out, height: out };
}

function warpCircle(cv, image, ellipse, dx, dy, warpHold) {
  const major = Math.max(ellipse.size.width, ellipse.size.height);
  const out = Math.max(16, Math.round(major * 1.08));
  const key = shapeKey(ellipse, dx, dy, out);
  const cx = ellipse.center.x;
  const cy = ellipse.center.y;
  let relX;
  let relY;
  let radius;
  if (warpHold?.shapeKey === key && warpHold.relX && warpHold.relY) {
    relX = warpHold.relX;
    relY = warpHold.relY;
    radius = warpHold.radius;
  } else {
    const built = relativeMaps(ellipse, dx, dy, out);
    relX = built.mapX;
    relY = built.mapY;
    radius = built.radius;
    if (warpHold) {
      warpHold.shapeKey = key;
      warpHold.relX = relX;
      warpHold.relY = relY;
      warpHold.radius = radius;
      warpHold.out = out;
      warpHold.cx = null;
    }
  }
  const reuseAbs = warpHold?.mapXMat
    && warpHold.out === out
    && warpHold.cx != null
    && Math.abs(warpHold.cx - cx) < 0.35
    && Math.abs(warpHold.cy - cy) < 0.35
    && warpHold.shapeKey === key;
  let mapX = null;
  let mapY = null;
  if (!reuseAbs) {
    mapX = new Float32Array(relX.length);
    mapY = new Float32Array(relY.length);
    for (let k = 0; k < relX.length; k += 1) {
      mapX[k] = relX[k] + cx;
      mapY[k] = relY[k] + cy;
    }
  }
  const result = {
    cx: out / 2,
    cy: out / 2,
    radius,
  };
  if (cv.remap && cv.matFromArray && cv.CV_32FC1 != null) {
    const src = cv.matFromImageData({ data: image.data, width: image.width, height: image.height });
    const dst = new cv.Mat();
    let mx = warpHold?.mapXMat || null;
    let my = warpHold?.mapYMat || null;
    let discard = false;
    try {
      if (!reuseAbs) {
        mx = mapMat(cv, mx, out, mapX);
        my = mapMat(cv, my, out, mapY);
        if (warpHold) {
          warpHold.mapXMat = mx;
          warpHold.mapYMat = my;
          warpHold.cx = cx;
          warpHold.cy = cy;
          warpHold.out = out;
        } else {
          discard = true;
        }
      }
      cv.remap(src, dst, mx, my, cv.INTER_LINEAR, cv.BORDER_REPLICATE);
      const data = new Uint8ClampedArray(dst.data.length);
      data.set(dst.data);
      return { ...result, image: { data, width: out, height: out } };
    } catch {
      // JS resample below. A broken map must not be reused.
      if (warpHold) {
        warpHold.mapXMat?.delete?.();
        warpHold.mapYMat?.delete?.();
        warpHold.mapXMat = null;
        warpHold.mapYMat = null;
        warpHold.cx = null;
        discard = false;
      }
    } finally {
      src.delete();
      dst.delete();
      if (discard) {
        mx?.delete?.();
        my?.delete?.();
      }
    }
  }
  if (!mapX) {
    mapX = new Float32Array(relX.length);
    mapY = new Float32Array(relY.length);
    for (let k = 0; k < relX.length; k += 1) {
      mapX[k] = relX[k] + cx;
      mapY[k] = relY[k] + cy;
    }
  }
  return { ...result, image: manualWarp(image, mapX, mapY, out) };
}

function sampleRimNarrow(image, ellipse) {
  const rays = 16;
  const points = [];
  for (let i = 0; i < rays; i += 1) {
    const theta = (i / rays) * Math.PI * 2;
    const edge = ellipsePoint(ellipse, theta);
    const dx = edge.x - ellipse.center.x;
    const dy = edge.y - ellipse.center.y;
    const pred = Math.hypot(dx, dy);
    if (!(pred > 4)) continue;
    const ux = dx / pred;
    const uy = dy / pred;
    const gap = Math.max(1, pred * 0.02);
    const step = Math.max(1, pred / 70);
    let best = 0;
    let bestR = 0;
    for (let r = pred * 0.84; r <= pred * 1.16; r += step) {
      const inner = lumaAt(image, ellipse.center.x + (r - gap) * ux, ellipse.center.y + (r - gap) * uy);
      const outer = lumaAt(image, ellipse.center.x + (r + gap) * ux, ellipse.center.y + (r + gap) * uy);
      if (inner == null || outer == null) continue;
      const strength = Math.abs(outer - inner);
      if (strength > best) {
        best = strength;
        bestR = r;
      }
    }
    if (best < 8) continue;
    points.push({
      x: ellipse.center.x + bestR * ux,
      y: ellipse.center.y + bestR * uy,
      strength: best,
      angle: Math.atan2(uy, ux),
      r: bestR,
      pred,
    });
  }
  return points;
}

function nudgeEllipse(ellipse, samples) {
  const major = Math.max(ellipse.size.width, ellipse.size.height);
  let accCC = 0;
  let accCS = 0;
  let accSS = 0;
  let accEC = 0;
  let accES = 0;
  let scaleNum = 0;
  let scaleDen = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const err = sample.r - sample.pred;
    const c = Math.cos(sample.angle);
    const s = Math.sin(sample.angle);
    accCC += c * c;
    accCS += c * s;
    accSS += s * s;
    accEC += err * c;
    accES += err * s;
    scaleNum += err;
    scaleDen += pred;
  }
  const det = accCC * accSS - accCS * accCS;
  if (Math.abs(det) < samples.length * 0.12) return { ellipse, held: true };
  const sx = (accSS * accEC - accCS * accES) / det;
  const sy = (accCC * accES - accCS * accEC) / det;
  if (Math.hypot(sx, sy) > major * 0.18) return null;
  let scale = 1 + clamp(scaleDen > 0 ? scaleNum / scaleDen : 0, -0.04, 0.04);
  if (Math.abs(ellipse.size.width * (scale - 1)) < 0.45) scale = 1;
  return {
    ellipse: {
      center: { x: ellipse.center.x + sx, y: ellipse.center.y + sy },
      size: { width: ellipse.size.width * scale, height: ellipse.size.height * scale },
      angle: ellipse.angle,
    },
    held: false,
  };
}

function tryTrack(image, candidate, prior) {
  if (!(prior?.width > 4) || !(prior?.height > 4)) return null;
  const ellipse = {
    center: { x: prior.cx, y: prior.cy },
    size: { width: prior.width, height: prior.height },
    angle: prior.angleDeg,
  };
  const major = Math.max(prior.width, prior.height);
  if (Math.hypot(prior.cx - candidate.cx, prior.cy - candidate.cy) > candidate.radius * 0.75) return null;
  const samples = sampleRimNarrow(image, ellipse);
  if (samples.length < 6) {
    const misses = (prior.misses || 0) + 1;
    if (misses >= 5) return null;
    return { ellipse, misses, held: true };
  }
  if (samples.length < 8) return { ellipse, misses: 0, held: true };
  const nudged = nudgeEllipse(ellipse, samples);
  if (!nudged) return null;
  const current = nudged.ellipse;
  const minor = Math.min(current.size.width, current.size.height);
  if (minor / major < 0.28) return null;
  if (Math.hypot(current.center.x - candidate.cx, current.center.y - candidate.cy) > candidate.radius * 0.6) {
    return null;
  }
  const check = sampleRimNarrow(image, current);
  const used = check.length >= 8 ? check : samples;
  let sum = 0;
  for (let i = 0; i < used.length; i += 1) sum += residualPx(used[i], current) ** 2;
  const rms = Math.sqrt(sum / used.length);
  if (rms > major * 0.08) return null;
  return { ellipse: current, misses: 0, held: nudged.held };
}

function publicEllipse(ellipse) {
  return {
    cx: ellipse.center.x,
    cy: ellipse.center.y,
    width: ellipse.size.width,
    height: ellipse.size.height,
    angleDeg: ellipse.angle,
  };
}

function finishEllipse(cv, image, ellipse, dx, dy, warpHold, meta, full) {
  const major = Math.max(ellipse.size.width, ellipse.size.height);
  const minor = Math.min(ellipse.size.width, ellipse.size.height);
  const ellipseOut = publicEllipse(ellipse);
  const geometry = {
    dx,
    dy,
    fit: meta.fit,
    misses: meta.misses,
    tick: meta.tick,
  };
  if (!(major > 4)) return null;
  if (minor / major > 0.985) {
    if (full?.crop) {
      return {
        ok: true,
        image: full.crop,
        cx: full.local.cx,
        cy: full.local.cy,
        radius: (major + minor) / 4,
        ellipse: ellipseOut,
        warped: false,
        geometry,
      };
    }
    return {
      ok: true,
      image,
      cx: ellipse.center.x,
      cy: ellipse.center.y,
      radius: (major + minor) / 4,
      ellipse: ellipseOut,
      warped: false,
      geometry,
    };
  }
  try {
    const warped = warpCircle(cv, image, ellipse, dx, dy, warpHold);
    if (!warped?.image) return null;
    return { ok: true, ...warped, ellipse: ellipseOut, warped: true, geometry };
  } catch {
    return null;
  }
}

/**
 * @param {{ prior?: object, warpHold?: object, perspective?: boolean }} [options]
 * `prior` is an ellipse in the same pixel space as `image` (`cx`, `cy`, `width`,
 * `height`, `angleDeg`, `dx`, `dy`). `warpHold` keeps warp maps between frames.
 * @returns {null | { ok: true, image, cx, cy, radius, ellipse, warped, geometry }}
 * The returned bitmap is a new buffer; the source frame is not kept.
 */
export function rectifyGaugeFace(cv, image, candidate, options = {}) {
  if (!cv?.fitEllipse || !image?.data || !candidate) return null;
  const { width, height } = image;
  const radius = candidate.radius;
  if (!(radius > 4) || !(width > 0) || !(height > 0)) return null;
  const warpHold = options.warpHold || null;
  const perspective = options.perspective !== false;
  if (options.prior && options.track !== false) {
    const tracked = tryTrack(image, candidate, options.prior);
    if (tracked) {
      return finishEllipse(
        cv,
        image,
        tracked.ellipse,
        options.prior.dx || 0,
        options.prior.dy || 0,
        warpHold,
        { fit: tracked.held ? 'hold' : 'track', misses: tracked.misses, tick: null },
      );
    }
  }
  const pad = radius * 1.9;
  const x0 = clamp(Math.floor(candidate.cx - pad), 0, width - 2);
  const y0 = clamp(Math.floor(candidate.cy - pad), 0, height - 2);
  const x1 = clamp(Math.ceil(candidate.cx + pad), x0 + 2, width);
  const y1 = clamp(Math.ceil(candidate.cy + pad), y0 + 2, height);
  const crop = cropImage(image, x0, y0, x1 - x0, y1 - y0);
  const local = { cx: candidate.cx - x0, cy: candidate.cy - y0, radius };
  const points = collectBezelPoints(crop, local.cx, local.cy, local.radius);
  const fitted = fitBezelEllipse(cv, points);
  if (!fitted || !ellipseUsable(fitted.ellipse, fitted.points, local)) return null;
  const imageEllipse = {
    center: {
      x: fitted.ellipse.center.x + x0,
      y: fitted.ellipse.center.y + y0,
    },
    size: fitted.ellipse.size,
    angle: fitted.ellipse.angle,
  };
  const major = Math.max(fitted.ellipse.size.width, fitted.ellipse.size.height);
  const minor = Math.min(fitted.ellipse.size.width, fitted.ellipse.size.height);
  let dx = 0;
  let dy = 0;
  let tick = null;
  if (perspective && minor / major <= 0.985) {
    const gray = grayscale(crop.data, crop.width, crop.height);
    const peaks = tickPeakRadians(gray, crop.width, crop.height, fitted.ellipse);
    tick = fitPerspectiveOffset(peaks);
    dx = tick.dx;
    dy = tick.dy;
  }
  return finishEllipse(cv, image, imageEllipse, dx, dy, warpHold, {
    fit: 'full',
    misses: 0,
    tick,
  }, { crop, local, minor, major });
}

/**
 * Rough circle from the bright face, for when a circular Hough vote is weak.
 * Centre and radius are moments of the bright pixels, not a fixed pose.
 */
export function proposeGaugeCandidate(image) {
  if (!image?.data || !(image.width > 0) || !(image.height > 0)) return null;
  const { width, height, data } = image;
  const gray = grayscale(data, width, height);
  const stride = Math.max(1, Math.round(Math.min(width, height) / 180));
  const samples = [];
  for (let y = 0; y < height; y += stride) {
    const row = y * width;
    for (let x = 0; x < width; x += stride) samples.push(gray[row + x]);
  }
  if (samples.length < 16) return null;
  samples.sort((a, b) => a - b);
  const mid = samples[samples.length >> 1];
  const peak = samples[samples.length - 1];
  const cut = mid + 0.45 * (peak - mid);
  if (!(peak > mid + 12)) return null;
  let n = 0;
  let sx = 0;
  let sy = 0;
  const xs = [];
  const ys = [];
  for (let y = 0; y < height; y += stride) {
    const row = y * width;
    for (let x = 0; x < width; x += stride) {
      if (gray[row + x] < cut) continue;
      xs.push(x);
      ys.push(y);
      sx += x;
      sy += y;
      n += 1;
    }
  }
  if (n < 24) return null;
  const cx = sx / n;
  const cy = sy / n;
  const dists = new Float64Array(n);
  for (let i = 0; i 