/**
 * Cropped zoom view for frozen-frame gauge tap placement.
 * Maps between preview box pixels and unmirrored video pixels.
 */

import { objectCoverMap } from '../flairPressureLab/geometry.js';

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function initialDialCrop(videoW, videoH, focusX, focusY, dialRadiusPx = 90) {
  const half = clamp(Math.round(dialRadiusPx * 2.35), 100, Math.min(videoW, videoH) * 0.45);
  const cx = clamp(focusX, half, videoW - half);
  const cy = clamp(focusY, half, videoH - half);
  return { cx, cy, half };
}

export function zoomCrop(crop, factor, videoW, videoH) {
  const half = clamp(crop.half * factor, 72, Math.min(videoW, videoH) * 0.48);
  const cx = clamp(crop.cx, half, videoW - half);
  const cy = clamp(crop.cy, half, videoH - half);
  return { cx, cy, half };
}

export function panCropToVideoPoint(crop, vx, vy, videoW, videoH) {
  const half = crop.half;
  const cx = clamp(vx, half, videoW - half);
  const cy = clamp(vy, half, videoH - half);
  return { cx, cy, half };
}

/** Preview box position → video pixel (crop fills the box). */
export function previewPointToVideoCrop(screenX, screenY, boxW, boxH, crop, mirrored) {
  if (!crop || !boxW || !boxH) return null;
  let lx = screenX / boxW;
  const ly = screenY / boxH;
  if (mirrored) lx = 1 - lx;
  return {
    x: crop.cx - crop.half + lx * 2 * crop.half,
    y: crop.cy - crop.half + ly * 2 * crop.half,
  };
}

/** Video pixel → preview box (crop fills the box). */
export function videoPointToPreviewCrop(videoX, videoY, boxW, boxH, crop, mirrored) {
  if (!crop || !boxW || !boxH) return null;
  let lx = (videoX - (crop.cx - crop.half)) / (2 * crop.half);
  const ly = (videoY - (crop.cy - crop.half)) / (2 * crop.half);
  if (mirrored) lx = 1 - lx;
  return { x: lx * boxW, y: ly * boxH };
}

/**
 * Paint a square crop of the source bitmap into the display canvas (object-fill box).
 */
export function paintFrozenCrop(displayCtx, sourceCanvas, boxW, boxH, crop, mirrored) {
  if (!displayCtx || !sourceCanvas || !crop) return;
  const sx = crop.cx - crop.half;
  const sy = crop.cy - crop.half;
  const size = crop.half * 2;
  displayCtx.save();
  displayCtx.setTransform(1, 0, 0, 1, 0, 0);
  displayCtx.clearRect(0, 0, boxW, boxH);
  if (mirrored) {
    displayCtx.translate(boxW, 0);
    displayCtx.scale(-1, 1);
    displayCtx.drawImage(sourceCanvas, sx, sy, size, size, 0, 0, boxW, boxH);
  } else {
    displayCtx.drawImage(sourceCanvas, sx, sy, size, size, 0, 0, boxW, boxH);
  }
  displayCtx.restore();
}

/** Loupe: magnify a region of the 1:1 source canvas around a video pixel. */
export function paintLoupeFromSource(loupeCtx, sourceCanvas, videoX, videoY, loupeSize, zoom) {
  if (!loupeCtx || !sourceCanvas) return;
  const srcR = Math.max(8, (loupeSize / zoom) / 2);
  const sx = videoX - srcR;
  const sy = videoY - srcR;
  loupeCtx.clearRect(0, 0, loupeSize, loupeSize);
  loupeCtx.save();
  loupeCtx.beginPath();
  loupeCtx.arc(loupeSize / 2, loupeSize / 2, loupeSize / 2 - 2, 0, Math.PI * 2);
  loupeCtx.clip();
  loupeCtx.drawImage(sourceCanvas, sx, sy, srcR * 2, srcR * 2, 0, 0, loupeSize, loupeSize);
  loupeCtx.strokeStyle = '#c88a4b';
  loupeCtx.lineWidth = 2;
  loupeCtx.beginPath();
  loupeCtx.moveTo(loupeSize / 2, 8);
  loupeCtx.lineTo(loupeSize / 2, loupeSize - 8);
  loupeCtx.moveTo(8, loupeSize / 2);
  loupeCtx.lineTo(loupeSize - 8, loupeSize / 2);
  loupeCtx.stroke();
  loupeCtx.restore();
}

/** Full-frame object-cover paint for review. */
export function paintObjectCover(displayCtx, sourceCanvas, boxW, boxH, mirrored) {
  if (!displayCtx || !sourceCanvas || !boxW || !boxH) return;
  const map = objectCoverMap(sourceCanvas.width, sourceCanvas.height, boxW, boxH);
  if (!map) return;
  const dw = sourceCanvas.width * map.scale;
  const dh = sourceCanvas.height * map.scale;
  displayCtx.save();
  displayCtx.setTransform(1, 0, 0, 1, 0, 0);
  displayCtx.clearRect(0, 0, boxW, boxH);
  if (mirrored) {
    displayCtx.translate(boxW, 0);
    displayCtx.scale(-1, 1);
    displayCtx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, map.offsetX, map.offsetY, dw, dh);
  } else {
    displayCtx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, map.offsetX, map.offsetY, dw, dh);
  }
  displayCtx.restore();
}
