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
function paintLoupeEdgeExtended(loupeCtx, sourceCanvas, videoX, videoY, loupeSize, srcR) {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const size = srcR * 2;
  const scale = loupeSize / size;
  const idealL = videoX - srcR;
  const idealT = videoY - srcR;
  const idealR = idealL + size;
  const idealB = idealT + size;

  const visL = Math.max(0, idealL);
  const visT = Math.max(0, idealT);
  const visR = Math.min(sw, idealR);
  const visB = Math.min(sh, idealB);
  const dVisL = (visL - idealL) * scale;
  const dVisT = (visT - idealT) * scale;
  const dVisW = (visR - visL) * scale;
  const dVisH = (visB - visT) * scale;

  const blit = (sx, sy, swidth, sheight, dx, dy, dwidth, dheight) => {
    if (swidth <= 0 || sheight <= 0 || dwidth <= 0 || dheight <= 0) return;
    loupeCtx.drawImage(sourceCanvas, sx, sy, swidth, sheight, dx, dy, dwidth, dheight);
  };

  blit(visL, visT, visR - visL, visB - visT, dVisL, dVisT, dVisW, dVisH);

  if (idealL < 0) {
    const dw = (-idealL) * scale;
    blit(0, visT, 1, visB - visT, 0, dVisT, dw, dVisH);
  }
  if (idealR > sw) {
    const dw = (idealR - sw) * scale;
    blit(sw - 1, visT, 1, visB - visT, loupeSize - dw, dVisT, dw, dVisH);
  }
  if (idealT < 0) {
    const dh = (-idealT) * scale;
    blit(visL, 0, visR - visL, 1, dVisL, 0, dVisW, dh);
  }
  if (idealB > sh) {
    const dh = (idealB - sh) * scale;
    blit(visL, sh - 1, visR - visL, 1, dVisL, loupeSize - dh, dVisW, dh);
  }
  if (idealL < 0 && idealT < 0) {
    const dw = (-idealL) * scale;
    const dh = (-idealT) * scale;
    blit(0, 0, 1, 1, 0, 0, dw, dh);
  }
  if (idealR > sw && idealT < 0) {
    const dw = (idealR - sw) * scale;
    const dh = (-idealT) * scale;
    blit(sw - 1, 0, 1, 1, loupeSize - dw, 0, dw, dh);
  }
  if (idealL < 0 && idealB > sh) {
    const dw = (-idealL) * scale;
    const dh = (idealB - sh) * scale;
    blit(0, sh - 1, 1, 1, 0, loupeSize - dh, dw, dh);
  }
  if (idealR > sw && idealB > sh) {
    const dw = (idealR - sw) * scale;
    const dh = (idealB - sh) * scale;
    blit(sw - 1, sh - 1, 1, 1, loupeSize - dw, loupeSize - dh, dw, dh);
  }
}

/** Fraction of non-transparent pixels inside the loupe circle (for tests). */
export function loupeCircleFillRatio(loupeCtx, loupeSize) {
  const data = loupeCtx.getImageData(0, 0, loupeSize, loupeSize).data;
  const cx = loupeSize / 2;
  const cy = loupeSize / 2;
  const r = loupeSize / 2 - 2;
  let inside = 0;
  let filled = 0;
  for (let y = 0; y < loupeSize; y += 1) {
    for (let x = 0; x < loupeSize; x += 1) {
      if (Math.hypot(x - cx, y - cy) > r) continue;
      inside += 1;
      const a = data[(y * loupeSize + x) * 4 + 3];
      if (a > 8) filled += 1;
    }
  }
  return inside ? filled / inside : 0;
}

export function paintLoupeFromSource(loupeCtx, sourceCanvas, videoX, videoY, loupeSize, zoom) {
  if (!loupeCtx || !sourceCanvas) return;
  const srcR = Math.max(8, (loupeSize / zoom) / 2);
  loupeCtx.clearRect(0, 0, loupeSize, loupeSize);
  loupeCtx.save();
  loupeCtx.beginPath();
  loupeCtx.arc(loupeSize / 2, loupeSize / 2, loupeSize / 2 - 2, 0, Math.PI * 2);
  loupeCtx.clip();
  paintLoupeEdgeExtended(loupeCtx, sourceCanvas, videoX, videoY, loupeSize, srcR);
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
