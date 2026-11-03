import { needleTipFromSample } from '../flairPressureLab/shotReplayInterpolation.js';

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

