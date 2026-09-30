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

/** Front-camera preview is mirrored horizontally. CV angles stay in sensor space. */
export function previewAngleDeg(angleDeg, mirrored) {
  if (angleDeg == null || !mirrored) return angleDeg;
  return ((180 - angleDeg) % 360 + 360) % 360;
}
