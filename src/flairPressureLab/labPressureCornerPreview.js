/**
 * CSS crop/zoom for the shot-screen Lab corner camera preview (tracked gauge pose).
 * Pure helpers — no DOM, no reader path.
 */

export const CORNER_CROP_RADIUS_MULT = 2.6;
export const CORNER_PREVIEW_STALE_MS = 1000;
export const CORNER_PREVIEW_FULL_FRAME_AFTER_MS = 2000;
export const CORNER_PREVIEW_POSE_MIN_INTERVAL_MS = 100;
export const CORNER_PREVIEW_SMOOTH_ALPHA = 0.38;
export const CORNER_PREVIEW_MIN_HALF_PX = 72;
export const CORNER_PREVIEW_MAX_HALF_FRACTION = 0.48;
export const CORNER_PREVIEW_MAX_ZOOM = 6;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function maxCropHalf(videoW, videoH) {
  if (!videoW || !videoH) return CORNER_PREVIEW_MIN_HALF_PX;
  return Math.min(videoW, videoH) * CORNER_PREVIEW_MAX_HALF_FRACTION;
}

/** Square crop window ~2.6× dial radius around hub, clamped inside the frame. */
export function dialCropFromPose(hubX, hubY, radiusPx, videoW, videoH) {
  if (!(videoW > 1) || !(videoH > 1) || !(radiusPx > 0)) return null;
  const maxHalf = maxCropHalf(videoW, videoH);
  const half = clamp(
    radiusPx * CORNER_CROP_RADIUS_MULT,
    CORNER_PREVIEW_MIN_HALF_PX,
    maxHalf,
  );
  const cx = clamp(hubX, half, videoW - half);
  const cy = clamp(hubY, half, videoH - half);
  return { cx, cy, half };
}

/** Exponential low-pass for crop centre and half (no overshoot on constant target). */
export function smoothDialCrop(prev, target, alpha = CORNER_PREVIEW_SMOOTH_ALPHA) {
  if (!target) return prev;
  if (!prev) return { ...target };
  const t = clamp(alpha, 0, 1);
  return {
    cx: prev.cx + (target.cx - prev.cx) * t,
    cy: prev.cy + (target.cy - prev.cy) * t,
    half: prev.half + (target.half - prev.half) * t,
  };
}

/**
 * Blend crop toward full-frame (large half, frame centre). factor 0 = crop, 1 = full frame.
 */
export function blendCropToFullFrame(crop, videoW, videoH, factor) {
  if (!crop || !(videoW > 1) || !(videoH > 1)) return null;
  const f = clamp(factor, 0, 1);
  if (f <= 0) return { ...crop };
  const fullHalf = maxCropHalf(videoW, videoH);
  const cx = crop.cx + ((videoW / 2) - crop.cx) * f;
  const cy = crop.cy + ((videoH / 2) - crop.cy) * f;
  const half = crop.half + (fullHalf - crop.half) * f;
  return {
    cx: clamp(cx, half, videoW - half),
    cy: clamp(cy, half, videoH - half),
    half: clamp(half, CORNER_PREVIEW_MIN_HALF_PX, fullHalf),
  };
}

/**
 * object-cover zoom centered on crop hub. mirrored=false matches current corner preview (no flip).
 */
export function cornerPreviewVideoStyle({
  videoW,
  videoH,
  boxW,
  boxH,
  crop,
  mirrored = false,
}) {
  if (!(videoW > 1) || !(videoH > 1) || !boxW || !boxH) {
    return { objectFit: 'cover', objectPosition: '50% 50%' };
  }
  if (!crop) {
    return { objectFit: 'cover', objectPosition: '50% 50%' };
  }

  const coverScale = Math.max(boxW / videoW, boxH / videoH);
  const visibleW = boxW / coverScale;
  const visibleH = boxH / coverScale;
  const span = crop.half * 2;
  const zoom = clamp(
    Math.max(visibleW / span, visibleH / span),
    1,
    CORNER_PREVIEW_MAX_ZOOM,
  );

  let ox = (crop.cx / videoW) * 100;
  const oy = (crop.cy / videoH) * 100;
  if (mirrored) ox = 100 - ox;

  const origin = `${ox}% ${oy}%`;
  const mirror = mirrored ? 'scaleX(-1) ' : '';
  return {
    objectFit: 'cover',
    objectPosition: origin,
    transformOrigin: origin,
    transform: `${mirror}scale(${zoom})`,
  };
}

/**
 * Pose quality for preview crop (not used by the reader).
 * @param {{ atMs: number, lost?: boolean, uncertain?: boolean }} pose
 */
export function cornerPreviewCropFactor(pose, nowMs) {
  if (!pose || !pose.atMs) return 1;
  const age = nowMs - pose.atMs;
  if (age > CORNER_PREVIEW_FULL_FRAME_AFTER_MS) return 1;
  if (age > CORNER_PREVIEW_STALE_MS) {
    const t = (age - CORNER_PREVIEW_STALE_MS)
      / (CORNER_PREVIEW_FULL_FRAME_AFTER_MS - CORNER_PREVIEW_STALE_MS);
    return clamp(t, 0, 1);
  }
  if (pose.lost || pose.uncertain) {
    return clamp(age / CORNER_PREVIEW_FULL_FRAME_AFTER_MS, 0, 0.85);
  }
  return 0;
}

export function shouldPublishCornerPreviewPose(nowMs, lastPublishMs) {
  return nowMs - lastPublishMs >= CORNER_PREVIEW_POSE_MIN_INTERVAL_MS;
}

export function cornerPreviewCropFromPose(pose, videoW, videoH, nowMs = Date.now()) {
  const factor = cornerPreviewCropFactor(pose, nowMs);
  if (factor >= 1 || !pose || !(pose.radius > 0)) return null;
  const target = dialCropFromPose(pose.hubX, pose.hubY, pose.radius, videoW, videoH);
  if (!target) return null;
  return blendCropToFullFrame(target, videoW, videoH, factor);
}
