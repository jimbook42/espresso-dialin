/** Some camera/MediaStream drivers present the same pixels with a new frame ID.
 * Exact repeats add no new gauge evidence. Keep them out of the confident curve.
 * Compare a generous fixed window so subpixel pose jitter cannot defeat the check.
 */
export function isRepeatedGaugeFrame(image, previous, calibration) {
  if (!previous?.data || !image?.data || image.width !== previous.width || image.height !== previous.height
    || !calibration?.hub || !(calibration.radius > 0)) return false;
  const span = calibration.radius * 1.5 + 48;
  const left = Math.max(0, Math.floor(calibration.hub.x - span));
  const right = Math.min(image.width, Math.ceil(calibration.hub.x + span));
  const top = Math.max(0, Math.floor(calibration.hub.y - span));
  const bottom = Math.min(image.height, Math.ceil(calibration.hub.y + span));
  if (right <= left || bottom <= top) return false;
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
    const p = (y * image.width + x) * 4;
    if (image.data[p] !== previous.data[p] || image.data[p + 1] !== previous.data[p + 1]
      || image.data[p + 2] !== previous.data[p + 2]) return false;
  }
  return true;
}
