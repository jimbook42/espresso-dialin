import { needleTipFromSample } from '../flairPressureLab/shotReplayInterpolation.js';

/** Cover-crop the display around the reader's existing hub, without changing
 * the source video or the source coordinates used by the reader/needle line.
 */
export function shotGaugeObjectPosition(frame, sourceW, sourceH, boxW, boxH) {
  if (!(sourceW > 0 && sourceH > 0 && boxW > 0 && boxH > 0)
    || !Number.isFinite(frame?.hubX) || !Number.isFinite(frame?.hubY)) return '50% 50%';
  const scale = Math.max(boxW / sourceW, boxH / sourceH);
  const position = (hub, source, box) => {
    const excess = source * scale - box;
    if (excess <= 0) return 50;
    const offset = Math.min(excess, Math.max(0, hub * scale - box / 2));
    return offset / excess * 100;
  };
  return `${position(frame.hubX, sourceW, boxW).toFixed(2)}% ${position(frame.hubY, sourceH, boxH).toFixed(2)}%`;
}

/** Display-only observer of the existing camera and reader frame output. */
export function drawShotGaugeFrame(context, video, frame, nowMs) {
  const { videoWidth: width, videoHeight: height } = video;
  if (video.readyState < 2 || !width || !height) return;
  const canvas = context.canvas;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.drawImage(video, 0, 0, width, height);
  const tip = needleTipFromSample(frame);
  if (!frame?.valid || !frame.fresh || frame.held || !tip
    || nowMs - frame.observedAtMs > 500) return;
  context.beginPath();
  context.moveTo(frame.hubX, frame.hubY);
  context.lineTo(tip.x, tip.y);
  context.strokeStyle = '#e0a660';
  context.lineWidth = Math.max(2, frame.radius * 0.025);
  context.stroke();
}

