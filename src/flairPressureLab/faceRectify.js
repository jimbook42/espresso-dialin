import { grayscale } from './framePrep.js';

/**
 * Turn an oblique gauge face into a front-on circle.
 * The candidate circle is only a search window. Ellipse centre, axes, and
 * tilt come from the bezel edge on this frame (cv.fitEllipse), then
 * cv.warpAffine maps that ellipse onto a circle the size of its major axis.
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

function warpToCircle(cv, image, ellipse) {
  const major = Math.max(ellipse.size.width, ellipse.size.height);
  const out = Math.max(16, Math.round(major * 1.08));
  const { radius, values } = circleToEllipseMatrix(ellipse, out);
  const src = cv.matFromImageData({ data: image.data, width: image.width, height: image.height });
  const dst = new cv.Mat();
  const map = cv.matFromArray(2, 3, cv.CV_64F, values);
  const size = new cv.Size(out, out);
  try {
    const flags = cv.INTER_LINEAR + cv.WARP_INVERSE_MAP;
    cv.warpAffine(src, dst, map, size, flags, cv.BORDER_REPLICATE);
    const data = new Uint8ClampedArray(dst.data.length);
    data.set(dst.data);
    return {
      image: { data, width: out, height: out },
      cx: out / 2,
      cy: out / 2,
      radius,
    };
  } finally {
    src.delete();
    dst.delete();
    map.delete();
  }
}

/**
 * @returns {null | { ok: true, image, cx, cy, radius, ellipse, warped }}
 * `ellipse` is in the same pixel space as `image`. The returned bitmap is a
 * new buffer; the source frame is not kept.
 */
export function rectifyGaugeFace(cv, image, candidate) {
  if (!cv?.fitEllipse || !cv?.warpAffine || !image?.data || !candidate) return null;
  const { width, height } = image;
  const radius = candidate.radius;
  if (!(radius > 4) || !(width > 0) || !(height > 0)) return null;
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
  const major = Math.max(fitted.ellipse.size.width, fitted.ellipse.size.height);
  const minor = Math.min(fitted.ellipse.size.width, fitted.ellipse.size.height);
  const ellipse = {
    cx: fitted.ellipse.center.x + x0,
    cy: fitted.ellipse.center.y + y0,
    width: fitted.ellipse.size.width,
    height: fitted.ellipse.size.height,
    angleDeg: fitted.ellipse.angle,
  };
  if (minor / major > 0.985) {
    return {
      ok: true,
      image: crop,
      cx: local.cx,
      cy: local.cy,
      radius: (major + minor) / 4,
      ellipse,
      warped: false,
    };
  }
  try {
    const warped = warpToCircle(cv, crop, fitted.ellipse);
    return { ok: true, ...warped, ellipse, warped: true };
  } catch {
    return null;
  }
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
  for (let i = 0; i < n; i += 1) dists[i] = Math.hypot(xs[i] - cx, ys[i] - cy);
  dists.sort();
  const radius = dists[Math.floor(n * 0.82)];
  const minDim = Math.min(width, height);
  if (!(radius > 8) || radius < minDim * 0.02 || radius > minDim * 0.48) return null;
  return { ok: true, cx, cy, radius, source: 'face-blob' };
}
