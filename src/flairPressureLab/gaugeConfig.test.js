import assert from 'assert';
import {
  FLAIR_58_SCALE,
  PROCESS_INTERVAL_MS,
  angleToBar,
  classifyTrackingStatus,
  wrapDelta,
} from './gaugeConfig.js';
import { guideCircleStyle, previewAngleDeg } from './geometry.js';
import { cameraErrorMessage } from './cameraErrors.js';
import { circularMedian, createAngleTracker, createRisingThreshold } from './smoothPressure.js';
import { detectNeedleAngle } from './needleFromFrame.js';

function makeNeedleFrame(size, angleDeg) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    data[i * 4] = 236;
    data[i * 4 + 1] = 236;
    data[i * 4 + 2] = 232;
    data[i * 4 + 3] = 255;
  }
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (let r = size * 0.18; r < size * 0.46; r += 0.5) {
    for (let t = -1.6; t <= 1.6; t += 0.4) {
      const x = Math.round(cx + r * cos - t * sin);
      const y = Math.round(cy + r * sin + t * cos);
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const index = (y * size + x) * 4;
      data[index] = 16;
      data[index + 1] = 16;
      data[index + 2] = 16;
    }
  }
  return { data, width: size, height: size };
}

export function runFlairPressureLabTests() {
  const session = { ...FLAIR_58_SCALE, zeroAngleDeg: 20 };
  assert.equal(angleToBar(20, session), 0);
  const mid = angleToBar(20 + 135, session);
  assert.ok(Math.abs(mid - 6) < 0.02, `expected 6 bar, got ${mid}`);
  assert.equal(angleToBar(15, session), 0);

  assert.equal(
    classifyTrackingStatus({ calibrated: false, quality: 0.9, jitterDeg: 0, accepted: true }),
    'CALIBRATING',
  );
  assert.equal(
    classifyTrackingStatus({ calibrated: true, quality: 0.5, jitterDeg: 2, accepted: true }),
    'TRACKING',
  );
  assert.equal(
    classifyTrackingStatus({ calibrated: true, quality: 0.12, jitterDeg: 2, accepted: true }),
    'UNCERTAIN',
  );
  assert.equal(
    classifyTrackingStatus({ calibrated: true, quality: 0.02, jitterDeg: 2, accepted: true }),
    'LOST',
  );

  assert.ok(PROCESS_INTERVAL_MS >= 100 && PROCESS_INTERVAL_MS <= 200);
  assert.equal(1000 / PROCESS_INTERVAL_MS, 8);

  const ring = guideCircleStyle(1920, 1080, 300, 400, 0.3);
  assert.ok(Math.abs(ring.left + ring.width / 2 - 150) < 1);
  assert.ok(Math.abs(ring.top + ring.height / 2 - 200) < 1);
  assert.equal(previewAngleDeg(0, true), 180);
  assert.equal(previewAngleDeg(90, true), 90);
  assert.equal(previewAngleDeg(40, false), 40);

  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /denied/i);
  assert.match(cameraErrorMessage({ name: 'NotReadableError' }), /already in use/i);
  assert.match(cameraErrorMessage({ name: 'NotFoundError' }), /front/i);
  assert.match(cameraErrorMessage({ name: 'UnsupportedError' }), /does not support/i);
  assert.match(cameraErrorMessage({ name: 'RearCameraError' }), /rear camera/i);

  const median = circularMedian([358, 0, 2]);
  assert.ok(median < 3 || median > 357, `median ${median}`);

  const tracker = createAngleTracker({ maxJumpDeg: 20, confirmCount: 2, alpha: 1 });
  tracker.push(10);
  const rejected = tracker.push(80);
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.angle, 10);
  const accepted = tracker.push(82);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.angle, 82);

  const edge = createRisingThreshold(2);
  assert.equal(edge.push(1.2, 500).above, false);
  const crossed = edge.push(2.4, 1000);
  assert.equal(crossed.above, true);
  assert.equal(crossed.crossedAt, 1000);
  assert.equal(edge.push(4, 1500).crossCount, 1);
  assert.equal(edge.push(0.4, 1800).above, false);

  const frame = makeNeedleFrame(96, 40);
  const found = detectNeedleAngle(frame, 47.5, 47.5, 96 * 0.2, 96 * 0.45);
  const error = Math.abs(wrapDelta(40, found.angleDeg));
  assert.ok(error <= 8, `angle ${found.angleDeg} quality ${found.quality} error ${error}`);
  assert.ok(found.quality > 0.15, `quality ${found.quality}`);

  const blank = makeNeedleFrame(96, 40);
  for (let i = 0; i < blank.data.length; i += 4) {
    blank.data[i] = 200;
    blank.data[i + 1] = 200;
    blank.data[i + 2] = 200;
  }
  const flat = detectNeedleAngle(blank, 47.5, 47.5, 20, 40);
  assert.ok(flat.quality < 0.12, `blank quality ${flat.quality}`);
}
