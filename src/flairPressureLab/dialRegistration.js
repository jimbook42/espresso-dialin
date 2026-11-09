import { getOpenCvSync } from './opencvRuntime.js';
import { wrap360, wrapDelta } from './gaugeConfig.js';
import { matchGaugeRotation } from './gaugeTrack.js';

// Only transient image patches. Nothing here is added to a saved calibration.
const references = new Map();
const SIZE = 128;
const CENTRE = SIZE / 2;
const FACE_RADIUS = 48;
// A 19 px window at level 2 already spans 76 px of this 96 px face.
// That mixes printed corners with moving bezel/background pixels. Rim search
// supplies coarse translation; one octave keeps LK local to the printed face.
const FLOW_PYRAMID_LEVEL = 1;

function key(cal) {
  return [cal.hub.x, cal.hub.y, cal.radius, cal.zeroAngleDeg, cal.fiveAngleDeg, cal.tenAngleDeg].join('/');
}

function grayAt(image, x, y) {
  if (x < 1 || y < 1 || x >= image.width - 2 || y >= image.height - 2) return 0;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const at = (dx, dy) => {
    const p = ((iy + dy) * image.width + ix + dx) * 4;
    return image.data[p] * 0.299 + image.data[p + 1] * 0.587 + image.data[p + 2] * 0.114;
  };
  return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy)
    + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
}

function patch(image, pose) {
  const data = new Uint8Array(SIZE * SIZE);
  const scale = pose.radius / FACE_RADIUS;
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const dx = (x - CENTRE) * scale, dy = (y - CENTRE) * scale;
    data[y * SIZE + x] = grayAt(image, pose.x + dx, pose.y + dy);
  }
  // LK assumes comparable brightness. Camera exposure can change after the
  // lever/hand moves; use the face interior, not the changing surround, to
  // normalize both patches. A contrast floor prevents amplification of noise.
  let sum = 0, sum2 = 0, count = 0;
  for (let y = 0; y < SIZE; y += 2) for (let x = 0; x < SIZE; x += 2) {
    const r = Math.hypot(x - CENTRE, y - CENTRE) / FACE_RADIUS;
    if (r < 0.35 || r > 0.8) continue;
    const value = data[y * SIZE + x];
    sum += value; sum2 += value * value; count += 1;
  }
  const mean = sum / count;
  const deviation = Math.sqrt(Math.max(0, sum2 / count - mean * mean));
  const gain = 32 / Math.max(8, deviation);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.max(0, Math.min(255, Math.round(128 + (data[i] - mean) * gain)));
  }
  return data;
}

// Only an initial-flow proposal. The original forward/backward, RANSAC and
// printed-pixel gates still have to verify the complete affine transform.
function printedProfile(data) {
  return Float32Array.from({ length: 72 }, (_, bin) => {
    const angle = bin * Math.PI / 36;
    let sum = 0, count = 0;
    for (let r = FACE_RADIUS * 0.48; r <= FACE_RADIUS * 0.82; r++) {
      sum += data[Math.round(CENTRE + r * Math.sin(angle)) * SIZE + Math.round(CENTRE + r * Math.cos(angle))];
      count++;
    }
    return sum / count;
  });
}

// Distributed corners on the printed face, excluding the pivot and needle ray.
function corners(data, needleDeg) {
  const candidates = [];
  for (let y = 15; y < SIZE - 15; y += 3) for (let x = 15; x < SIZE - 15; x += 3) {
    const dx = x - CENTRE, dy = y - CENTRE, r = Math.hypot(dx, dy);
    if (r < FACE_RADIUS * 0.48 || r > FACE_RADIUS * 0.95) continue;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    if (needleDeg != null && (Math.abs(wrapDelta(angle, needleDeg)) < 18
      || Math.abs(wrapDelta(angle, needleDeg + 180)) < 18)) continue;
    let xx = 0, xy = 0, yy = 0;
    for (let v = -2; v <= 2; v += 1) for (let u = -2; u <= 2; u += 1) {
      const i = (y + v) * SIZE + x + u;
      const gx = (data[i + 1] - data[i - 1]) / 2;
      const gy = (data[i + SIZE] - data[i - SIZE]) / 2;
      xx += gx * gx; xy += gx * gy; yy += gy * gy;
    }
    const score = (xx + yy - Math.hypot(xx - yy, 2 * xy)) / 2;
    if (score > 100) candidates.push({ x, y, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const c of candidates) {
    if (selected.every(p => Math.hypot(p.x - c.x, p.y - c.y) >= 7)) selected.push(c);
    if (selected.length === 48) break;
  }
  return selected;
}

export function rememberDialReference(image, cal) {
  const data = patch(image, { ...cal.hub, radius: cal.radius });
  const points = corners(data, cal.zeroAngleDeg);
  if (points.length < 10) return;
  references.set(key(cal), { data, points });
  // Bounded to a few small patches and released with the app session.
  if (references.size > 4) references.delete(references.keys().next().value);
}

export function createDialRegistration(cal) {
  return { reference: references.get(key(cal)) ?? null, matrix: null, misses: 0 };
}

/** Restore transient features after reload using an independently confirmed face pose.
 * The supplied shift is from saved face-band templates, never the current needle.
 */
export function seedDialRegistration(image, cal, pose, state, shiftDeg, needleDeg) {
  if (state.reference) return;
  const data = patch(image, pose);
  const points = corners(data, needleDeg ?? wrap360(cal.zeroAngleDeg + shiftDeg));
  if (points.length < 10) return;
  const angle = shiftDeg * Math.PI / 180;
  const baseMatrix = [Math.cos(angle), -Math.sin(angle), Math.sin(angle), Math.cos(angle)];
  // Compose the confirmed initial rotation algebraically instead of resampling
  // the reference a second time and biasing its corner positions.
  state.reference = { data, points, baseMatrix };
  state.last = { x: pose.x, y: pose.y, matrix: [1, 0, 0, 1], scale: pose.radius / FACE_RADIUS };
}

/** Reference-image direction -> current-image direction. */
export function transformDialAngle(angle, matrix) {
  if (!matrix || angle == null) return angle;
  const r = angle * Math.PI / 180, x = Math.cos(r), y = Math.sin(r);
  return wrap360(Math.atan2(matrix[2] * x + matrix[3] * y, matrix[0] * x + matrix[1] * y) * 180 / Math.PI);
}

export function inverseDialAngle(angle, matrix) {
  return matrix ? transformDialAngle(angle, [matrix[3], -matrix[1], -matrix[2], matrix[0]]) : angle;
}

/** Match static printed features to the calibration frame, never to the needle. */
export function registerDialFrame(image, _cal, pose, state, { verifyIdentity = false, initialRotationDeg = null } = {}) {
  const cv = getOpenCvSync();
  if (!cv?.calcOpticalFlowPyrLK || !cv?.estimateAffine2D || !state.reference) return null;
  const owned = [];
  const own = value => { owned.push(value); return value; };
  try {
    // Wide recovery uses the printed detail inside the circular bezel.
    // Keep that fit after recovery: returning to the broad LK window can pull
    // a verified rotation back towards the rotationally invariant surround.
    const printedFaceFlow = verifyIdentity || state.printedFaceFlow === true;
    const ref = printedFaceFlow ? { ...state.reference,
      points: state.reference.points.filter(p => Math.hypot(p.x - CENTRE, p.y - CENTRE) <= FACE_RADIUS * 0.82),
    } : state.reference;
    if (ref.points.length < 10) return null;
    const previous = own(cv.matFromArray(SIZE, SIZE, cv.CV_8UC1, ref.data));
    const currentData = patch(image, pose);
    const current = own(cv.matFromArray(SIZE, SIZE, cv.CV_8UC1, currentData));
    const source = own(cv.matFromArray(ref.points.length, 1, cv.CV_32FC2, ref.points.flatMap(p => [p.x, p.y])));
    const rotationProposal = initialRotationDeg ?? (verifyIdentity ? matchGaugeRotation(
      ref.profile ??= printedProfile(ref.data), printedProfile(currentData),
      { maxShiftDeg: 40, referenceNeedleDeg: _cal.zeroAngleDeg },
    ).estimateDeg : null);
    const proposalRad = (rotationProposal ?? 0) * Math.PI / 180;
    const seed = rotationProposal != null ? ref.points.flatMap(p => {
      const dx = p.x - CENTRE, dy = p.y - CENTRE;
      return [CENTRE + Math.cos(proposalRad) * dx - Math.sin(proposalRad) * dy,
        CENTRE + Math.sin(proposalRad) * dx + Math.cos(proposalRad) * dy];
    }) : state.last ? ref.points.flatMap(p => {
      const dx = p.x - CENTRE, dy = p.y - CENTRE, last = state.last;
      // After loss, the old translation is no longer a useful prediction.
      // Use the current rim as a search seed; only matching face pixels can
      // certify the recovered hub and transform through the original taps.
      const anchorX = state.misses > 0 ? pose.x : last.x;
      const anchorY = state.misses > 0 ? pose.y : last.y;
      // Both patches are already normalized to the candidate radius. After
      // loss, retaining the old *pixel* scale sends LK towards the wrong glyphs
      // when the lever changes apparent size. Retain orientation/tilt only.
      const scale = state.misses > 0
        ? 1 / Math.sqrt(last.matrix[0] * last.matrix[3] - last.matrix[1] * last.matrix[2])
        : last.scale * FACE_RADIUS / pose.radius;
      return [CENTRE + (anchorX - pose.x) * FACE_RADIUS / pose.radius + scale * (last.matrix[0] * dx + last.matrix[1] * dy),
        CENTRE + (anchorY - pose.y) * FACE_RADIUS / pose.radius + scale * (last.matrix[2] * dx + last.matrix[3] * dy)];
    }) : null;
    const target = own(seed ? cv.matFromArray(ref.points.length, 1, cv.CV_32FC2, seed) : new cv.Mat());
    const status = own(new cv.Mat()), error = own(new cv.Mat());
    const windowSize = printedFaceFlow ? 11 : 19;
    const pyramidLevel = printedFaceFlow ? 0 : FLOW_PYRAMID_LEVEL;
    cv.calcOpticalFlowPyrLK(previous, current, source, target, status, error, new cv.Size(windowSize, windowSize), pyramidLevel,
      new cv.TermCriteria(cv.TermCriteria_COUNT | cv.TermCriteria_EPS, 30, 0.01),
      seed ? cv.OPTFLOW_USE_INITIAL_FLOW : 0);
    // Reverse tracking has a known starting estimate too. An unseeded reverse
    // search can converge on another glyph even when forward tracking is right.
    // LK must still refine the estimate from pixels and pass the same 1 px check.
    const back = own(source.clone()), backStatus = own(new cv.Mat()), backError = own(new cv.Mat());
    cv.calcOpticalFlowPyrLK(current, previous, target, back, backStatus, backError, new cv.Size(windowSize, windowSize), pyramidLevel,
      new cv.TermCriteria(cv.TermCriteria_COUNT | cv.TermCriteria_EPS, 30, 0.01), cv.OPTFLOW_USE_INITIAL_FLOW);
    const a = [], b = [];
    for (let i = 0; i < ref.points.length; i += 1) {
      const p = ref.points[i], x = target.data32F[2 * i], y = target.data32F[2 * i + 1];
      if (!status.data[i] || !backStatus.data[i] || error.data32F[i] > 25) continue;
      if (Math.hypot(back.data32F[2 * i] - p.x, back.data32F[2 * i + 1] - p.y) > 1) continue;
      if (x < 8 || y < 8 || x > SIZE - 8 || y > SIZE - 8) continue;
      a.push(p.x, p.y); b.push(x, y);
    }
    if (a.length < 16) return null;
    const from = own(cv.matFromArray(a.length / 2, 1, cv.CV_32FC2, a));
    const to = own(cv.matFromArray(b.length / 2, 1, cv.CV_32FC2, b));
    const inliers = own(new cv.Mat());
    const affine = own(cv.estimateAffine2D(from, to, inliers, cv.RANSAC, 1.5, 1000, 0.99, 10));
    if (affine.empty()) return null;
    const m = Array.from(affine.data64F), sectors = new Set();
    let count = 0, residual = 0;
    for (let i = 0; i < a.length / 2; i += 1) if (inliers.data[i]) {
      const x = a[2 * i], y = a[2 * i + 1];
      residual += (m[0] * x + m[1] * y + m[2] - b[2 * i]) ** 2
        + (m[3] * x + m[4] * y + m[5] - b[2 * i + 1]) ** 2;
      sectors.add(Math.floor((Math.atan2(y - CENTRE, x - CENTRE) + Math.PI) / (Math.PI / 2)) % 4);
      count += 1;
    }
    const det = m[0] * m[4] - m[1] * m[3];
    const norm = m[0] ** 2 + m[1] ** 2 + m[3] ** 2 + m[4] ** 2;
    const spread = Math.sqrt(Math.max(0, norm * norm - 4 * det * det));
    const minScale = Math.sqrt((norm - spread) / 2), maxScale = Math.sqrt((norm + spread) / 2);
    const base = ref.baseMatrix ?? [1, 0, 0, 1];
    const localMatrix = [m[0], m[1], m[3], m[4]];
    const matrix = [m[0] * base[0] + m[1] * base[2], m[0] * base[1] + m[1] * base[3],
      m[3] * base[0] + m[4] * base[2], m[3] * base[1] + m[4] * base[3]];
    const rotation = Math.atan2(matrix[2] - matrix[1], matrix[0] + matrix[3]) * 180 / Math.PI;
    const x = m[0] * CENTRE + m[1] * CENTRE + m[2];
    const y = m[3] * CENTRE + m[4] * CENTRE + m[5];
    if (count < 8 || count < a.length / 4 || sectors.size < 3 || residual / count > 1.5
      || det < 0.65 || det > 1.5 || minScale < 0.65 || maxScale > 1.5
      || maxScale / minScale > 1.8 || Math.abs(rotation) > 40 || Math.hypot(x - CENTRE, y - CENTRE) > 18) return null;
    // Whole-frame reacquisition needs matching printed pixels as well as a
    // coherent flow field. A circle or repeated glyph pattern is not identity.
    if (verifyIdentity && printedPixelAgreement(ref.data, currentData, _cal.zeroAngleDeg, m) < 0.85) return null;
    if (verifyIdentity) state.printedFaceFlow = true;
    const scale = pose.radius / FACE_RADIUS;
    state.matrix = matrix;
    state.misses = 0;
    const hub = { x: pose.x + (x - CENTRE) * scale, y: pose.y + (y - CENTRE) * scale };
    state.last = { ...hub, matrix: localMatrix, scale };
    return { ...hub,
      radius: pose.radius * Math.sqrt(det), matrix, shiftDeg: wrap360(rotation),
      quality: count / ref.points.length, residual: Math.sqrt(residual / count), inliers: count };
  } catch {
    return null;
  } finally {
    owned.reverse().forEach(mat => mat.delete());
  }
}

function printedPixelAgreement(reference, current, needleDeg, m) {
  let n = 0, sumA = 0, sumB = 0, aa = 0, bb = 0, ab = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const dx = x - CENTRE, dy = y - CENTRE, radius = Math.hypot(dx, dy);
      if (radius < FACE_RADIUS * 0.48 || radius > FACE_RADIUS * 0.82) continue;
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      if (Math.abs(wrapDelta(angle, needleDeg)) < 18 || Math.abs(wrapDelta(angle, needleDeg + 180)) < 18) continue;
      const u = m[0] * x + m[1] * y + m[2], v = m[3] * x + m[4] * y + m[5];
      if (u < 0 || v < 0 || u >= SIZE - 1 || v >= SIZE - 1) continue;
      const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
      const a = reference[y * SIZE + x];
      const b = (current[iy * SIZE + ix] * (1 - fx) + current[iy * SIZE + ix + 1] * fx) * (1 - fy)
        + (current[(iy + 1) * SIZE + ix] * (1 - fx) + current[(iy + 1) * SIZE + ix + 1] * fx) * fy;
      n++; sumA += a; sumB += b; aa += a * a; bb += b * b; ab += a * b;
  }
  const variance = (aa - sumA * sumA / n) * (bb - sumB * sumB / n);
  return n >= 200 && variance > 0 ? (ab - sumA * sumB / n) / Math.sqrt(variance) : 0;
}
