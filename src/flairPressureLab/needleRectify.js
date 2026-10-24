/**
 * Canonical needle crop for the angle-only model.
 * The tracker pose (centre, dial radius, tap-calibration rotation) is the only
 * geometry. The crop carries no bar value, anchor, or gauge id.
 *
 * Cartesian: 96×96, dial radius 40 px, pivot on the continuous centre.
 * Polar: 48×360, rows = radius (inner → outer), columns = angle
 * (column a is a degrees, 0° = +x, clockwise because y grows downward).
 * `rotationDeg` is the source angle placed at crop angle 0.
 *
 * Sampling matches scripts/needle-reader/rectify.py. Both bilinear-sample
 * RGBA and write CHW float32 in [0, 1].
 */

export const RECTIFY_CARTESIAN_SIZE = 96;
export const RECTIFY_DIAL_RADIUS_PX = 40;
export const RECTIFY_POLAR_RADIUS_BINS = 48;
export const RECTIFY_POLAR_ANGLE_BINS = 360;
export const RECTIFY_POLAR_OUTER_PX = 48;
export const RECTIFY_MODES = ['cartesian', 'polar'];

/** Default is Cartesian. Set `mode` to `polar` to unwrap. */
export const NEEDLE_RECTIFY_CONFIG = {
  mode: 'cartesian',
  cartesian: { size: RECTIFY_CARTESIAN_SIZE, dialRadiusPx: RECTIFY_DIAL_RADIUS_PX },
  polar: {
    radiusBins: RECTIFY_POLAR_RADIUS_BINS,
    angleBins: RECTIFY_POLAR_ANGLE_BINS,
    outerRadiusPx: RECTIFY_POLAR_OUTER_PX,
  },
};

function snap(value) {
  const nearest = Math.round(value);
  if (Math.abs(value - nearest) <= 1e-6) return nearest;
  return value;
}

function bilinearRgb(data, width, height, x, y) {
  if (!(x >= 0) || !(y >= 0) || x > width - 1 || y > height - 1) return [0, 0, 0];
  const xq = snap(x);
  const yq = snap(y);
  const x0 = Math.floor(xq);
  const y0 = Math.floor(yq);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = xq - x0;
  const ty = yq - y0;
  const row0 = y0 * width;
  const row1 = y1 * width;
  const i00 = (row0 + x0) * 4;
  const i10 = (row0 + x1) * 4;
  const i01 = (row1 + x0) * 4;
  const i11 = (row1 + x1) * 4;
  const rgb = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    const v0 = data[i00 + c] * (1 - tx) + data[i10 + c] * tx;
    const v1 = data[i01 + c] * (1 - tx) + data[i11 + c] * tx;
    rgb[c] = v0 * (1 - ty) + v1 * ty;
  }
  return rgb;
}

export function resolveRectifySpec(options = {}) {
  const base = options.profile?.rectify || {};
  const mode = options.mode || base.mode || NEEDLE_RECTIFY_CONFIG.mode;
  if (!RECTIFY_MODES.includes(mode)) {
    throw new Error(`rectify mode must be cartesian or polar, got ${mode}`);
  }
  const cartesian = { ...NEEDLE_RECTIFY_CONFIG.cartesian, ...base.cartesian, ...options.cartesian };
  const polar = { ...NEEDLE_RECTIFY_CONFIG.polar, ...base.polar, ...options.polar };
  return {
    mode,
    size: cartesian.size,
    dialRadiusPx: cartesian.dialRadiusPx,
    radiusBins: polar.radiusBins,
    angleBins: polar.angleBins,
    outerRadiusPx: polar.outerRadiusPx,
  };
}

/**
 * Pose from the dial tracker and the tap calibration.
 * `rotationDeg` is the source angle (rest needle, once calibrated) that
 * lands on 0° in the crop. Omit it and image +x stays at crop 0°.
 */
export function rectifyPoseFromTrack(gauge, calibration = null) {
  if (!gauge || !(gauge.radius > 1) || gauge.cx == null || gauge.cy == null) return null;
  const rotationDeg = calibration?.restAngleDeg
    ?? calibration?.zeroAngleDeg
    ?? gauge.rotationDeg
    ?? 0;
  return {
    cx: gauge.cx,
    cy: gauge.cy,
    radius: gauge.radius,
    rotationDeg,
  };
}

function sourcePoint(pose, lx, ly, dialRadiusPx) {
  const theta = ((pose.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const scale = pose.radius / dialRadiusPx;
  return [
    pose.cx + (cos * lx - sin * ly) * scale,
    pose.cy + (sin * lx + cos * ly) * scale,
  ];
}

function writeRgb(out, index, plane, rgb) {
  out[index] = rgb[0] / 255;
  out[plane + index] = rgb[1] / 255;
  out[2 * plane + index] = rgb[2] / 255;
}

function rectifyCartesian(image, pose, spec) {
  const size = spec.size;
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  const { data, width, height } = image;
  for (let j = 0; j < size; j += 1) {
    const ly = (j + 0.5) - size / 2;
    for (let i = 0; i < size; i += 1) {
      const lx = (i + 0.5) - size / 2;
      const [x, y] = sourcePoint(pose, lx, ly, spec.dialRadiusPx);
      writeRgb(out, j * size + i, plane, bilinearRgb(data, width, height, x, y));
    }
  }
  return { tensor: out, width: size, height: size };
}

function rectifyPolar(image, pose, spec) {
  const rows = spec.radiusBins;
  const cols = spec.angleBins;
  const plane = rows * cols;
  const out = new Float32Array(3 * plane);
  const { data, width, height } = image;
  for (let r = 0; r < rows; r += 1) {
    const rho = ((r + 0.5) / rows) * spec.outerRadiusPx;
    for (let a = 0; a < cols; a += 1) {
      const rad = (a * Math.PI) / 180;
      const lx = rho * Math.cos(rad);
      const ly = rho * Math.sin(rad);
      const [x, y] = sourcePoint(pose, lx, ly, spec.dialRadiusPx);
      writeRgb(out, r * cols + a, plane, bilinearRgb(data, width, height, x, y));
    }
  }
  return { tensor: out, width: cols, height: rows };
}

/**
 * Rectify one RGBA frame. `image` is `{ data, width, height }` with
 * row-major RGBA bytes. The returned tensor is CHW float32 in [0, 1]
 * and is not retained by this module.
 */
export function rectifyNeedle(image, pose, options = {}) {
  const spec = resolveRectifySpec(options);
  const width = image?.width;
  const height = image?.height;
  const empty = spec.mode === 'polar'
    ? { tensor: new Float32Array(3 * spec.radiusBins * spec.angleBins), width: spec.angleBins, height: spec.radiusBins }
    : { tensor: new Float32Array(3 * spec.size * spec.size), width: spec.size, height: spec.size };
  if (!image?.data || !(width > 1) || !(height > 1) || !(pose?.radius > 1)) {
    return { mode: spec.mode, layout: 'CHW', channels: 3, ...empty, spec };
  }
  const cropped = spec.mode === 'polar'
    ? rectifyPolar(image, pose, spec)
    : rectifyCartesian(image, pose, spec);
  return { mode: spec.mode, layout: 'CHW', channels: 3, ...cropped, spec };
}

function lumaAt(tensor, width, height, x, y) {
  if (!(x >= 0) || !(y >= 0) || x > width - 1 || y > height - 1) return 1;
  const xq = snap(x);
  const yq = snap(y);
  const x0 = Math.floor(xq);
  const y0 = Math.floor(yq);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = xq - x0;
  const ty = yq - y0;
  const plane = width * height;
  let acc = 0;
  const weights = [0.299, 0.587, 0.114];
  for (let c = 0; c < 3; c += 1) {
    const base = c * plane;
    const v00 = tensor[base + y0 * width + x0];
    const v10 = tensor[base + y0 * width + x1];
    const v01 = tensor[base + y1 * width + x0];
    const v11 = tensor[base + y1 * width + x1];
    const v0 = v00 * (1 - tx) + v10 * tx;
    const v1 = v01 * (1 - tx) + v11 * tx;
    acc += weights[c] * (v0 * (1 - ty) + v1 * ty);
  }
  return acc;
}

function peakAngle(score) {
  let index = 0;
  for (let i = 1; i < score.length; i += 1) {
    if (score[i] > score[index]) index = i;
  }
  const y0 = score[(index + score.length - 1) % score.length];
  const y1 = score[index];
  const y2 = score[(index + 1) % score.length];
  const denom = y0 - 2 * y1 + y2;
  let delta = 0;
  if (Math.abs(denom) > 1e-12) delta = 0.5 * (y0 - y2) / denom;
  if (delta > 1) delta = 1;
  if (delta < -1) delta = -1;
  const turns = score.length === 360 ? 360 : score.length;
  return ((index + delta) % turns + turns) % turns;
}

/**
 * Tip-direction estimate from a rectified tensor, in crop degrees.
 * Same rays in Python. Used to prove the two crops agree within 0.3°.
 */
export function measureTensorAngle(tensor, spec) {
  const resolved = spec?.size ? spec : resolveRectifySpec(spec || {});
  const score = new Float64Array(resolved.angleBins || 360);
  if (resolved.mode === 'polar') {
    const rows = resolved.radiusBins;
    const cols = resolved.angleBins;
    const plane = rows * cols;
    const r0 = Math.round(rows * 0.30);
    const r1 = Math.round(rows * 0.82);
    for (let a = 0; a < cols; a += 1) {
      let acc = 0;
      let n = 0;
      for (let r = r0; r < r1; r += 1) {
        const i = r * cols + a;
        const luma = 0.299 * tensor[i] + 0.587 * tensor[plane + i] + 0.114 * tensor[2 * plane + i];
        acc += 1 - luma;
        n += 1;
      }
      score[a] = n ? acc / n : 0;
    }
    return peakAngle(score);
  }
  const size = resolved.size;
  const radii = [18, 24, 30, 36];
  for (let deg = 0; deg < 360; deg += 1) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    let acc = 0;
    for (let k = 0; k < radii.length; k += 1) {
      const lx = radii[k] * cos;
      const ly = radii[k] * sin;
      const x = lx + size / 2 - 0.5;
      const y = ly + size / 2 - 0.5;
      acc += 1 - lumaAt(tensor, size, size, x, y);
    }
    score[deg] = acc / radii.length;
  }
  return peakAngle(score);
}
