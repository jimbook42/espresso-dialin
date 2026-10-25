/**
 * Preview-pixel placement helpers for Lab gauge tap calibration.
 */

import { previewPointToVideo } from '../flairPressureLab/geometry.js';

/** Map a pointer position on the frame box to video pixels (mirrored preview). */
export function pointerToVideoPoint(clientX, clientY, frameRect, videoSize, mirrored = true) {
  if (!frameRect || !videoSize?.w) return null;
  const mapped = previewPointToVideo(
    clientX - frameRect.left,
    clientY - frameRect.top,
    videoSize.w,
    videoSize.h,
    frameRect.width,
    frameRect.height,
    mirrored,
  );
  if (!mapped) return null;
  return { x: mapped.nx * videoSize.w, y: mapped.ny * videoSize.h };
}

/** Map video pixel to preview box coordinates. */
export function videoToPreviewPoint(videoX, videoY, frameRect, videoSize, mirrored = true) {
  if (!frameRect || !videoSize?.w) return null;
  const scale = Math.max(frameRect.width / videoSize.w, frameRect.height / videoSize.h);
  const displayW = videoSize.w * scale;
  const displayH = videoSize.h * scale;
  const offsetX = (frameRect.width - displayW) / 2;
  const offsetY = (frameRect.height - displayH) / 2;
  let x = offsetX + videoX * scale;
  const y = offsetY + videoY * scale;
  if (mirrored) x = frameRect.width - x;
  return { x, y };
}

/**
 * Advance tap phase after a confirmed placement.
 * Returns next phase key or 'runCalibration' when ten is placed.
 */
export function nextTapPhaseAfterConfirm(currentPhase) {
  if (currentPhase === 'centre') return 'five';
  if (currentPhase === 'five') return 'ten';
  if (currentPhase === 'ten') return 'runCalibration';
  return currentPhase;
}

/** Undo the last committed tap; returns phase to edit. */
export function phaseAfterRedo(currentPhase, taps) {
  if (currentPhase === 'ten' || (currentPhase === 'review' && taps.ten)) return 'ten';
  if (currentPhase === 'five' || taps.five) return 'five';
  if (currentPhase === 'centre' || taps.centre) return 'centre';
  return 'centre';
}
