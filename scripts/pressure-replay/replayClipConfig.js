/**
 * Per-clip display-matrix rotation (degrees) for stored 1280×720 replay MP4s.
 * Matches ffprobe stream_side_data rotation on the source phone files.
 * Used when mapping stored pixels into the autorotated still the lab shows.
 */
export const REPLAY_CLIP_ROTATION_DEG = {
  '20261024_124006': -90,
  '20261024_124140': 90,
};

/** Rotation for a clip id; falls back to probed metadata when not in the table. */
export function storedRotationDeg(clipId, probedRotationDeg = 0) {
  if (clipId in REPLAY_CLIP_ROTATION_DEG) return REPLAY_CLIP_ROTATION_DEG[clipId];
  const n = Number(probedRotationDeg);
  return Number.isFinite(n) ? n : 0;
}

export function ffmpegTransposeFilter(rotationDeg) {
  const quarter = ((Math.round(Number(rotationDeg)) % 360) + 360) % 360;
  if (quarter === 90) return 'transpose=1';
  if (quarter === 270) return 'transpose=2';
  if (quarter === 180) return 'transpose=2,transpose=2';
  return null;
}
