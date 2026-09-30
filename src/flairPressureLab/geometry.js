/** Map a video frame onto an object-cover box. */
export function objectCoverMap(videoW, videoH, boxW, boxH) {
  if (!videoW || !videoH || !boxW || !boxH) return null;
  const scale = Math.max(boxW / videoW, boxH / videoH);
  const displayW = videoW * scale;
  const displayH = videoH * scale;
  return {
    scale,
    offsetX: (boxW - displayW) / 2,
    offsetY: (boxH - displayH) / 2,
  };
}

/** Pixel box for the alignment ring so it matches the CV circle under object-cover. */
export function guideCircleStyle(videoW, videoH, boxW, boxH, radiusFraction) {
  const map = objectCoverMap(videoW, videoH, boxW, boxH);
  if (!map) return null;
  const radius = Math.min(videoW, videoH) * radiusFraction * map.scale;
  const cx = map.offsetX + (videoW / 2) * map.scale;
  const cy = map.offsetY + (videoH / 2) * map.scale;
  return {
    width: radius * 2,
    height: radius * 2,
    left: cx - radius,
    top: cy - radius,
  };
}

/** Circle in preview pixels for a gauge region stored in unmirrored video fractions. */
export function videoRegionToPreview(region, videoW, videoH, boxW, boxH, mirrored) {
  const map = objectCoverMap(videoW, videoH, boxW, boxH);
  if (!map || !region) return null;
  const radius = region.nr * Math.min(videoW, videoH) * map.scale;
  let cx = map.offsetX + region.nx * videoW * map.scale;
  const cy = map.offsetY + region.ny * videoH * map.scale;
  if (mirrored) cx = boxW - cx;
  return {
    cx,
    cy,
    radius,
    left: cx - radius,
    top: cy - radius,
    width: radius * 2,
    height: radius * 2,
  };
}

/** Pointer position on the preview → unmirrored video fractions. */
export function previewPointToVideo(screenX, screenY, videoW, videoH, boxW, boxH, mirrored) {
  const map = objectCoverMap(videoW, videoH, boxW, boxH);
  if (!map || !videoW || !videoH) return null;
  const contentX = mirrored ? boxW - screenX : screenX;
  return {
    nx: (contentX - map.offsetX) / map.scale / videoW,
    ny: (screenY - map.offsetY) / map.scale / videoH,
  };
}

/** Front-camera preview is mirrored horizontally. CV angles stay in sensor space. */
export function previewAngleDeg(angleDeg, mirrored) {
  if (angleDeg == null || !mirrored) return angleDeg;
  return ((180 - angleDeg) % 360 + 360) % 360;
}
