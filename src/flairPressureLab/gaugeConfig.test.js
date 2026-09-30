import assert from 'assert';
import {
  FLAIR_58_SCALE,
  PROCESS_INTERVAL_MS,
  angleToBar,
  classifyTrackingStatus,
  selectForwardAngle,
  wrap360,
  wrapDelta,
} from './gaugeConfig.js';
import { guideCircleStyle, previewAngleDeg, previewPointToVideo, videoRegionToPreview } from './geometry.js';
import { cameraErrorMessage } from './cameraErrors.js';
import { circularMedian, createAngleTracker, createRestCalibration, createRisingThreshold } from './smoothPressure.js';
import { detectNeedleAngle } from './needleFromFrame.js';
import { createDiagnosticHistory, stabilityStats } from './diagnosticHistory.js';
import {
  analyzeGaugeImage,
  createGaugeTracker,
  locateGauge,
  matchGaugeRotation,
  measureRimProfile,
} from './gaugeTrack.js';

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

  const region = { nx: 0.72, ny: 0.38, nr: 0.22 };
  for (const mirrored of [false, true]) {
    const preview = videoRegionToPreview(region, 1280, 720, 300, 400, mirrored);
    const back = previewPointToVideo(preview.cx, preview.cy, 1280, 720, 300, 400, mirrored);
    assert.ok(Math.abs(back.nx - region.nx) < 0.01, `nx ${back.nx}`);
    assert.ok(Math.abs(back.ny - region.ny) < 0.01, `ny ${back.ny}`);
  }

  const kept = selectForwardAngle({ angleDeg: 30, peak: 10, oppositeScore: 9, previousAngle: 28 });
  assert.equal(kept.angleDeg, 30);
  assert.equal(kept.held, false);
  const corrected = selectForwardAngle({ angleDeg: 210, peak: 10, oppositeScore: 8, previousAngle: 32 });
  assert.ok(Math.abs(wrapDelta(30, corrected.angleDeg)) < 2, corrected.angleDeg);
  assert.equal(corrected.corrected, true);
  const held = selectForwardAngle({ angleDeg: 210, peak: 10, oppositeScore: 1, previousAngle: 32 });
  assert.equal(held.held, true);
  assert.equal(held.angleDeg, 32);

  const rest = createRestCalibration({ minSamples: 4, maxSpreadDeg: 8, minQuality: 0.1 });
  for (let i = 0; i < 3; i += 1) {
    assert.equal(rest.push({ angleDeg: 15 + i, quality: 0.4 }).ready, false);
  }
  const locked = rest.push({ angleDeg: 16, quality: 0.4 });
  assert.equal(locked.ready, true);
  assert.ok(Math.abs(wrapDelta(16, locked.zeroAngleDeg)) < 3);
  const reset = rest.push({ angleDeg: 80, quality: 0.4 });
  assert.equal(reset.ready, false);
  assert.equal(rest.push({ angleDeg: 10, quality: 0.01 }).count, 0);

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
  const flipped = tracker.push(82 + 180);
  assert.equal(flipped.accepted, false);
  assert.equal(flipped.rejectedFlip, true);
  assert.equal(tracker.push(82 + 180).angle, 82);

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

  const tailed = makeNeedleFrame(96, 40);
  const tailCx = 47.5;
  const tailCy = 47.5;
  const tailRad = (220 * Math.PI) / 180;
  for (let r = 12; r <= 24; r += 0.5) {
    for (let t = -1.2; t <= 1.2; t += 0.4) {
      const x = Math.round(tailCx + r * Math.cos(tailRad) - t * Math.sin(tailRad));
      const y = Math.round(tailCy + r * Math.sin(tailRad) + t * Math.cos(tailRad));
      if (x < 0 || y < 0 || x >= 96 || y >= 96) continue;
      const index = (y * 96 + x) * 4;
      tailed.data[index] = 16;
      tailed.data[index + 1] = 16;
      tailed.data[index + 2] = 16;
    }
  }
  const tipped = detectNeedleAngle(tailed, tailCx, tailCy, 30, 44);
  const tipError = Math.abs(wrapDelta(40, tipped.angleDeg));
  assert.ok(tipError <= 8, `tip angle ${tipped.angleDeg} error ${tipError}`);

  assert.equal(
    classifyTrackingStatus({ calibrated: true, quality: 0.6, jitterDeg: 1, accepted: true, gaugeHeld: true }),
    'UNCERTAIN',
  );

  for (const lighting of [
    { gain: 1, bias: 0 },
    { gain: 0.42, bias: 8 },
    { gain: 1.35, bias: 0 },
  ]) {
    const lit = makeNeedleFrame(96, 40);
    for (let i = 0; i < lit.data.length; i += 4) {
      for (let c = 0; c < 3; c += 1) {
        lit.data[i + c] = Math.max(0, Math.min(255, Math.round(lit.data[i + c] * lighting.gain + lighting.bias)));
      }
    }
    const litFound = detectNeedleAngle(lit, 47.5, 47.5, 96 * 0.2, 96 * 0.45);
    const litError = Math.abs(wrapDelta(40, litFound.angleDeg));
    assert.ok(litError <= 8, `lighting ${lighting.gain} angle ${litFound.angleDeg} q ${litFound.quality}`);
  }

  const gauge = makeGaugeImage(150, { cx: 86, cy: 64, radius: 38, needleDeg: 35, rotationDeg: 0 });
  const located = locateGauge(gauge, { cx: 74, cy: 72, radius: 38 });
  const centerError = Math.hypot(located.cx - 86, located.cy - 64);
  assert.ok(located.ok, `gauge confidence ${located.confidence} score ${located.score}`);
  assert.ok(centerError <= 4, `center error ${centerError.toFixed(1)} at ${located.cx.toFixed(1)},${located.cy.toFixed(1)}`);

  const shaded = makeGaugeImage(150, {
    cx: 86, cy: 64, radius: 38, needleDeg: 35, gain: 0.45, bias: 6, shade: 1,
  });
  const shadedLoc = locateGauge(shaded, { cx: 76, cy: 70, radius: 37 });
  const shadedError = Math.hypot(shadedLoc.cx - 86, shadedLoc.cy - 64);
  assert.ok(shadedLoc.ok, `shaded confidence ${shadedLoc.confidence}`);
  assert.ok(shadedError <= 5, `shaded center error ${shadedError.toFixed(1)}`);

  const empty = { data: new Uint8ClampedArray(110 * 110 * 4), width: 110, height: 110 };
  empty.data.fill(160);
  const missed = locateGauge(empty, { cx: 55, cy: 55, radius: 30 });
  assert.equal(missed.ok, false);

  const still = makeGaugeImage(150, { cx: 75, cy: 75, radius: 36, needleDeg: 40, rotationDeg: 0 });
  const turned = makeGaugeImage(150, { cx: 75, cy: 75, radius: 36, needleDeg: 52, rotationDeg: 12 });
  const needleOnly = makeGaugeImage(150, { cx: 75, cy: 75, radius: 36, needleDeg: 68, rotationDeg: 0 });
  const stillLoc = locateGauge(still, { cx: 75, cy: 75, radius: 36 });
  const turnedLoc = locateGauge(turned, { cx: 75, cy: 75, radius: 36 });
  const needleLoc = locateGauge(needleOnly, { cx: 75, cy: 75, radius: 36 });
  const stillProfile = measureRimProfile(stillLoc.edges, 150, 150, stillLoc.cx, stillLoc.cy, stillLoc.radius);
  const turnedProfile = measureRimProfile(turnedLoc.edges, 150, 150, turnedLoc.cx, turnedLoc.cy, turnedLoc.radius);
  const needleProfile = measureRimProfile(needleLoc.edges, 150, 150, needleLoc.cx, needleLoc.cy, needleLoc.radius);
  const rotated = matchGaugeRotation(stillProfile, turnedProfile, {
    previousDeg: 0,
    needleDeg: 52,
    referenceNeedleDeg: 40,
    maxShiftDeg: 20,
  });
  assert.ok(rotated.ok, `rotation corr ${rotated.confidence} margin ${rotated.margin} est ${rotated.estimateDeg}`);
  assert.ok(Math.abs(wrapDelta(12, rotated.rotationDeg)) <= 6, `rotation ${rotated.rotationDeg}`);
  const pointer = matchGaugeRotation(stillProfile, needleProfile, {
    previousDeg: 0,
    needleDeg: 68,
    referenceNeedleDeg: 40,
    maxShiftDeg: 20,
  });
  assert.ok(pointer.ok, `needle-only corr ${pointer.confidence} margin ${pointer.margin}`);
  assert.ok(Math.abs(wrapDelta(0, pointer.rotationDeg)) <= 6, `needle leaked into rotation ${pointer.rotationDeg}`);

  const translated = makeGaugeImage(150, { cx: 90, cy: 68, radius: 36, needleDeg: 40, rotationDeg: 0 });
  const atNewHub = detectNeedleAngle(translated, 90, 68, 36 * 0.46, 36 * 0.9);
  const atOldHub = detectNeedleAngle(translated, 75, 75, 36 * 0.46, 36 * 0.9);
  assert.ok(Math.abs(wrapDelta(40, atNewHub.angleDeg)) <= 8, `needle on moved gauge ${atNewHub.angleDeg}`);
  assert.ok(Math.abs(wrapDelta(40, atOldHub.angleDeg)) > 8, `stale hub should miss, got ${atOldHub.angleDeg}`);

  const gaugeTracker = createGaugeTracker();
  const identity = { originX: 0, originY: 0, scale: 1 };
  gaugeTracker.seed({ cx: 75, cy: 75, radius: 36 });
  const first = makeGaugeImage(150, { cx: 75, cy: 75, radius: 36, needleDeg: 30, rotationDeg: 0 });
  const moved = makeGaugeImage(150, { cx: 88, cy: 67, radius: 36, needleDeg: 30, rotationDeg: 0 });
  const swung = makeGaugeImage(150, { cx: 88, cy: 67, radius: 36, needleDeg: 58, rotationDeg: 0 });
  const readPose = (image) => {
    let position = null;
    for (let i = 0; i < 3; i += 1) position = gaugeTracker.trackPosition(image, identity);
    const pose = position.pose;
    const needle = detectNeedleAngle(image, pose.cx, pose.cy, pose.radius * 0.46, pose.radius * 0.9);
    const orientation = gaugeTracker.trackOrientation(position.profile, needle.angleDeg, { positionHeld: position.held });
    return {
      pose,
      held: position.held,
      relative: wrap360(needle.angleDeg - orientation.rotationDeg),
      screen: needle.angleDeg,
    };
  };
  const restPose = readPose(first);
  const shifted = readPose(moved);
  const followError = Math.hypot(shifted.pose.cx - 88, shifted.pose.cy - 67);
  assert.equal(shifted.held, false);
  assert.ok(followError <= 5, `follow error ${followError.toFixed(1)}`);
  assert.ok(Math.abs(wrapDelta(restPose.relative, shifted.relative)) <= 8, `shift changed pressure angle ${restPose.relative} -> ${shifted.relative}`);
  const pressed = readPose(swung);
  assert.ok(Math.abs(wrapDelta(shifted.relative + 28, pressed.relative)) <= 10, `needle move ${shifted.relative} -> ${pressed.relative}`);

  const lostFrame = { data: new Uint8ClampedArray(150 * 150 * 4), width: 150, height: 150 };
  lostFrame.data.fill(140);
  const heldPose = gaugeTracker.getPose();
  const heldTrack = gaugeTracker.trackPosition(lostFrame, identity);
  assert.equal(heldTrack.held, true);
  assert.ok(Math.hypot(heldTrack.pose.cx - heldPose.cx, heldTrack.pose.cy - heldPose.cy) < 0.1);

  const history = createDiagnosticHistory({ durationMs: 30000 });
  history.push({ t: 1000, rawAngle: 10, pressure: 1, tracking: 'TRACKING', gaugeX: 1, gaugeY: 2, quality: 0.4 });
  history.push({ t: 12000, rawAngle: 12, pressure: 1.2, tracking: 'UNCERTAIN', gaugeX: 4, gaugeY: 2, quality: 0.1 });
  history.push({ t: 31000, rawAngle: 14, pressure: 1.2, tracking: 'TRACKING', gaugeX: 4, gaugeY: 3, quality: 0.5 });
  assert.equal(history.length, 3);
  history.push({ t: 42000, rawAngle: 16, pressure: 2, tracking: 'TRACKING', gaugeX: 5, gaugeY: 3, quality: 0.5 });
  const trace = history.snapshot();
  assert.equal(trace.length, 3);
  assert.equal(trace[0].t, 12000);
  assert.equal(trace[2].pressure, 2);
  assert.equal(trace[2].tracking, 'TRACKING');
  history.reset();
  assert.equal(history.length, 0);

  const atRest = angleToBar(wrap360(40 - 0), { ...FLAIR_58_SCALE, zeroAngleDeg: 40 });
  const gaugeTurned = angleToBar(wrap360(50 - 10), { ...FLAIR_58_SCALE, zeroAngleDeg: 40 });
  const wrappedRest = angleToBar(wrap360(5 - 330), { ...FLAIR_58_SCALE, zeroAngleDeg: 35 });
  const lifted = angleToBar(wrap360(85 - 0), { ...FLAIR_58_SCALE, zeroAngleDeg: 40 });
  assert.equal(atRest, 0);
  assert.ok(Math.abs(gaugeTurned) < 1e-6, `rotation leaked into pressure ${gaugeTurned}`);
  assert.ok(Math.abs(wrapDelta(35, wrap360(5 - 330))) < 1e-6);
  assert.ok(Math.abs(wrappedRest) < 1e-6, `wrap rest ${wrappedRest}`);
  assert.ok(Math.abs(lifted - 2) < 0.02, `lifted ${lifted}`);

  const stillTracker = createGaugeTracker();
  const stillImage = makeGaugeImage(180, { cx: 92, cy: 88, radius: 40, needleDeg: 47, rotationDeg: 0 });
  stillTracker.seed({ cx: 92, cy: 88, radius: 40 });
  const stillReads = [];
  for (let i = 0; i < 12; i += 1) stillReads.push(analyzeGaugeImage(stillImage, stillTracker));
  const settled = stillReads.slice(4);
  const anchor = settled[0];
  for (const reading of settled) {
    const centreStep = Math.hypot(reading.gauge.cx - anchor.gauge.cx, reading.gauge.cy - anchor.gauge.cy);
    assert.ok(centreStep < 0.05, `stationary centre walked ${centreStep.toFixed(2)}`);
    assert.equal(reading.angleDeg, anchor.angleDeg);
    assert.ok(Math.abs(wrapDelta(anchor.relativeAngleDeg, reading.relativeAngleDeg)) < 0.05);
    assert.ok(Math.abs(wrapDelta(anchor.gauge.rotationDeg, reading.gauge.rotationDeg)) < 0.05);
    assert.equal(reading.gauge.held, false);
  }

  const shiftedImage = makeGaugeImage(180, { cx: 106, cy: 78, radius: 40, needleDeg: 47, rotationDeg: 0 });
  let shiftedRead = null;
  for (let i = 0; i < 4; i += 1) shiftedRead = analyzeGaugeImage(shiftedImage, stillTracker);
  const follow = Math.hypot(shiftedRead.gauge.cx - 106, shiftedRead.gauge.cy - 78);
  assert.ok(follow <= 6, `stillness gate blocked a real move ${follow.toFixed(1)}`);
  assert.ok(Math.abs(wrapDelta(anchor.relativeAngleDeg, shiftedRead.relativeAngleDeg)) <= 8, `move changed relative ${anchor.relativeAngleDeg} -> ${shiftedRead.relativeAngleDeg}`);

  const noisyTracker = createGaugeTracker();
  noisyTracker.seed({ cx: 92, cy: 88, radius: 40 });
  const noisyReads = [];
  for (let i = 0; i < 10; i += 1) {
    const frame = makeGaugeImage(180, {
      cx: 92, cy: 88, radius: 40, needleDeg: 47, rotationDeg: 0, noise: 30, seed: 19 + i * 23,
    });
    noisyReads.push(analyzeGaugeImage(frame, noisyTracker));
  }
  const noisyTail = noisyReads.slice(3);
  const noisyAnchor = noisyTail[0];
  let noisyCentre = 0;
  let noisyAngle = 0;
  for (const reading of noisyTail) {
    noisyCentre = Math.max(noisyCentre, Math.hypot(reading.gauge.cx - noisyAnchor.gauge.cx, reading.gauge.cy - noisyAnchor.gauge.cy));
    noisyAngle = Math.max(noisyAngle, Math.abs(wrapDelta(noisyAnchor.relativeAngleDeg, reading.relativeAngleDeg)));
  }
  assert.ok(noisyCentre <= 2.5, `noisy centre walk ${noisyCentre.toFixed(2)}`);
  assert.ok(noisyAngle <= 3, `noisy relative walk ${noisyAngle.toFixed(2)}`);

  const stats = stabilityStats([
    { gaugeX: 10, gaugeY: 10, rawGaugeX: 10, rawGaugeY: 12, gaugeRotation: 0, rawRotation: 0, rawAngle: 40, relativeAngle: 40, smoothedAngle: 40, pressure: 1 },
    { gaugeX: 10, gaugeY: 10, rawGaugeX: 14, rawGaugeY: 12, gaugeRotation: 0, rawRotation: 5, rawAngle: 40, relativeAngle: 40, smoothedAngle: 40, pressure: 1 },
    { gaugeX: 10, gaugeY: 10, rawGaugeX: 11, rawGaugeY: 15, gaugeRotation: 0, rawRotation: 0, rawAngle: 43, relativeAngle: 40, smoothedAngle: 40, pressure: 1.4 },
  ]);
  assert.equal(stats.centreDelta, 0);
  assert.ok(stats.centreStd < 0.01);
  assert.ok(stats.detectorCentreDelta > 1);
  assert.ok(stats.detectorCentreStd > 1);
  assert.equal(stats.rotationDelta, 0);
  assert.ok(stats.detectorRotationStd > 1);
  assert.equal(stats.screenDelta, 3);
  assert.equal(stats.relativeDelta, 0);
  assert.equal(stats.smoothedDelta, 0);
  assert.ok(stats.pressureStd > 0.1);
}

function angDist(a, b) {
  let distance = Math.abs(a - b) % 360;
  if (distance > 180) distance = 360 - distance;
  return distance;
}

function makeGaugeImage(size, {
  cx,
  cy,
  radius,
  rotationDeg = 0,
  needleDeg = 40,
  gain = 1,
  bias = 0,
  shade = 0,
  noise = 0,
  seed = 1,
} = {}) {
  let state = seed >>> 0;
  const rand = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const data = new Uint8ClampedArray(size * size * 4);
  const needleRad = (needleDeg * Math.PI) / 180;
  const needleCos = Math.cos(needleRad);
  const needleSin = Math.sin(needleRad);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      let value = 190;
      if (dist < radius - 2.4) value = 226;
      if (Math.abs(dist - radius) <= 2.2) value = 22;
      if (dist > radius * 0.73 && dist < radius * 0.92 && dist < radius - 3.2) {
        let ang = (Math.atan2(dy, dx) * 180) / Math.PI - rotationDeg;
        ang = ((ang % 360) + 360) % 360;
        const minor = ang % 30;
        const minorDist = Math.min(minor, 30 - minor);
        const major = ang % 90;
        const majorDist = Math.min(major, 90 - major);
        if (majorDist < 6) value = 16;
        else if (minorDist < 3.2) value = 32;
        if (angDist(ang, 200) < 16 && dist > radius * 0.76) value = 12;
      }
      const along = dx * needleCos + dy * needleSin;
      const across = Math.abs(-dx * needleSin + dy * needleCos);
      if (along > radius * 0.16 && along < radius * 0.84 && across <= 1.6) value = 6;
      value = value * gain + bias + shade * (x / size) * 80;
      if (noise) value += (rand() - 0.5) * noise;
      const index = (y * size + x) * 4;
      const channel = Math.max(0, Math.min(255, Math.round(value)));
      data[index] = channel;
      data[index + 1] = channel;
      data[index + 2] = channel;
      data[index + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}
