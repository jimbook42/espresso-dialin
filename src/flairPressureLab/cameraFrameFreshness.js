/** Some camera/MediaStream drivers present the same pixels with a new frame ID.
 * Exact repeats add no new gauge evidence. Keep them out of the confident curve.
 * Compare a generous fixed window so subpixel pose jitter cannot defeat the check.
 */
export function isRepeatedGaugeFrame(image, previous, calibration, trackedPose = null) {
  if (!previous?.data || !image?.data || image.width !== previous.width || image.height !== previous.height
    || !calibration?.hub || !(calibration.radius > 0)) return false;
  const poses = [{ ...calibration.hub, radius: calibration.radius }];
  if (trackedPose?.radius > 0) poses.push(trackedPose);
  return poses.every(pose => repeatedWindow(image, previous, pose));
}

function repeatedWindow(image, previous, pose) {
  const span = pose.radius * 1.5 + 48;
  const left = Math.max(0, Math.floor(pose.x - span));
  const right = Math.min(image.width, Math.ceil(pose.x + span));
  const top = Math.max(0, Math.floor(pose.y - span));
  const bottom = Math.min(image.height, Math.ceil(pose.y + span));
  if (right <= left || bottom <= top) return false;
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
    const p = (y * image.width + x) * 4;
    if (image.data[p] !== previous.data[p] || image.data[p + 1] !== previous.data[p + 1]
      || image.data[p + 2] !== previous.data[p + 2]) return false;
  }
  return true;
}
