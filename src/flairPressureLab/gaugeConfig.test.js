import assert from 'assert';
import {
  FLAIR_58_SCALE,
  OUTER_RADIUS_RATIO,
  PROCESS_INTERVAL_MS,
  TIP_INNER_RATIO,
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
import { DIAGNOSTIC_WINDOW_MS, createDiagnosticHistory, stabilityStats } from './diagnosticHistory.js';
import { buildDiagnosticReport, formatLocalTimestamp } from './diagnosticReport.js';
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

  const strongRay = { quality: 0.6, likeness: 0.8 };
  const tracker = createAngleTracker({ maxJumpDeg: 20, confirmCount: 2, alpha: 1 });
  tracker.push(10);
  const rejected = tracker.push(80);
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.heldReason, 'jump-ambiguous');
  assert.equal(rejected.angle, 10);
  const stillAmbiguous = tracker.push(82);
  assert.equal(stillAmbiguous.accepted, false);
  assert.equal(stillAmbiguous.angle, 10);
  const evidenced = createAngleTracker({ maxJumpDeg: 20, confirmCount: 2, alpha: 1 });
  evidenced.push(10);
  assert.equal(evidenced.push(80, strongRay).accepted, false);
  const accepted = evidenced.push(82, strongRay);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.angle, 82);
  const flipped = evidenced.push(82 + 180, strongRay);
  assert.equal(flipped.accepted, false);
  assert.equal(flipped.rejectedFlip, true);
  assert.equal(evidenced.push(82 + 180, strongRay).angle, 82);

  const cautious = createAngleTracker({ maxJumpDeg: 24, confirmCount: 3, alpha: 1 });
  cautious.push(10);
  assert.equal(cautious.push(60, { quality: 0.1, likeness: 0.2 }).accepted, false);
  assert.equal(cautious.push(60, { quality: 0.1, likeness: 0.2 }).accepted, false);
  assert.equal(cautious.push(60, { quality: 0.1, likeness: 0.2 }).accepted, false);
  const stillHeld = cautious.push(61, { quality: 0.1, likeness: 0.2 });
  assert.equal(stillHeld.accepted, false);
  assert.equal(stillHeld.heldReason, 'jump-ambiguous');
  assert.equal(stillHeld.angle, 10);
  const weakLocked = cautious.push(60, { quality: 0.22, likeness: 0.3 });
  assert.equal(weakLocked.accepted, false);
  assert.equal(weakLocked.angle, 10);

  const clearJump = createAngleTracker({ maxJumpDeg: 24, confirmCount: 3, alpha: 1 });
  clearJump.push(10);
  assert.equal(clearJump.push(60, strongRay).accepted, false);
  const pendingJump = clearJump.push(60, strongRay);
  assert.equal(pendingJump.accepted, false);
  assert.equal(pendingJump.heldReason, 'jump-unconfirmed');
  const confirmed = clearJump.push(62, strongRay);
  assert.equal(confirmed.accepted, true);
  assert.equal(confirmed.angle, 62);

  const sweep = createAngleTracker({ maxJumpDeg: 24, confirmCount: 3, alpha: 1 });
  sweep.push(0);
  assert.equal(sweep.push(30, strongRay).accepted, false);
  assert.equal(sweep.push(60, strongRay).angle, 0);
  const swept = sweep.push(90, strongRay);
  assert.equal(swept.accepted, true);
  assert.equal(swept.angle, 90);

  const falseWalk = createAngleTracker({ maxJumpDeg: 24, confirmCount: 3, alpha: 1 });
  falseWalk.push(0);
  for (const raw of [30, 60, 90, 120]) {
    const step = falseWalk.push(raw, { quality: 0.55, likeness: 0.25 });
    assert.equal(step.accepted, false, `a weak ray walked to ${step.angle}`);
    assert.equal(step.angle, 0);
  }

  const modest = createAngleTracker({ maxJumpDeg: 24, confirmCount: 3, alpha: 1 });
  modest.push(10);
  const modestWeak = modest.push(28, { quality: 0.12, likeness: 0.2 });
  assert.equal(modestWeak.accepted, false);
  assert.equal(modestWeak.angle, 10);
  const modestReal = modest.push(28, strongRay);
  assert.equal(modestReal.accepted, true);
  assert.equal(modestReal.angle, 28);
  const smallWeak = createAngleTracker({ maxJumpDeg: 24, confirmCount: 3, alpha: 1 });
  smallWeak.push(10);
  const smallStep = smallWeak.push(16, { quality: 0.12, likeness: 0.2 });
  assert.equal(smallStep.accepted, true);
  assert.ok(Math.abs(wrapDelta(16, smallStep.angle)) < 1);

  const around = createAngleTracker({ maxJumpDeg: 24, confirmCount: 3, alpha: 1 });
  around.push(350);
  const wrappedSmall = around.push(356, { quality: 0.1, likeness: 0.2 });
  assert.equal(wrappedSmall.accepted, true);
  assert.ok(Math.abs(wrapDelta(356, wrappedSmall.angle)) < 1, `wrap small ${wrappedSmall.angle}`);
  const wrappedModerate = around.push(14, strongRay);
  assert.equal(wrappedModerate.accepted, true);
  assert.ok(Math.abs(wrapDelta(14, wrappedModerate.angle)) < 1, `wrap moderate ${wrappedModerate.angle}`);
  const wrongWay = createAngleTracker({ maxJumpDeg: 24, confirmCount: 3, alpha: 1 });
  wrongWay.push(10);
  for (let i = 0; i < 4; i += 1) {
    const heldWrap = wrongWay.push(350, { quality: 0.5, likeness: 0.2 });
    assert.equal(heldWrap.accepted, false);
    assert.equal(heldWrap.angle, 10);
  }

  const poseSnap = createAngleTracker({ maxJumpDeg: 24, confirmCount: 3, alpha: 1 });
  poseSnap.push(47);
  const snapped = poseSnap.push(106, { ...strongRay, poseSnap: true });
  assert.equal(snapped.accepted, false);
  assert.equal(snapped.heldReason, 'pose-snap');
  assert.equal(snapped.angle, 47);
  assert.equal(poseSnap.push(106, strongRay).accepted, false);
  assert.equal(poseSnap.push(106, strongRay).accepted, false);
  const afterSnap = poseSnap.push(107, strongRay);
  assert.equal(afterSnap.accepted, true);
  assert.ok(Math.abs(wrapDelta(106, afterSnap.angle)) <= 2);

  const alternating = createAngleTracker({ maxJumpDeg: 24, confirmCount: 3, alpha: 1 });
  alternating.push(20);
  for (let i = 0; i < 6; i += 1) {
    const next = i % 2 === 0 ? 63 : 20;
    const step = alternating.push(next, { quality: 0.5 });
    assert.equal(step.angle, 20, `alternating frame ${i} moved to ${step.angle}`);
  }
  alternating.push(null);
  assert.equal(alternating.push(70, { quality: 0.6 }).accepted, false);

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

  const rival = blankFrame(140, 228);
  paintRadial(rival, 70, 70, 15, 16, 52, 1.5, 36);
  paintRadial(rival, 70, 70, 58, 46, 58, 2.4, 0);
  const rivalFound = detectNeedleAngle(rival, 70, 70, 140 * 0.18, 140 * 0.44);
  const rivalError = Math.abs(wrapDelta(15, rivalFound.angleDeg));
  assert.ok(rivalError <= 8, `dark outer tick won at ${rivalFound.angleDeg} q ${rivalFound.quality.toFixed(3)} likeness ${rivalFound.likeness.toFixed(3)}`);
  assert.ok(rivalFound.quality > 0.15, `rival quality ${rivalFound.quality}`);
  assert.ok(rivalFound.likeness > 0.4, `needle likeness ${rivalFound.likeness}`);
  assert.equal(typeof rivalFound.secondAngleDeg, 'number');
  assert.ok(rivalFound.margin > 0.15, `margin ${rivalFound.margin}`);

  const tickOnly = blankFrame(140, 228);
  paintRadial(tickOnly, 70, 70, 58, 46, 58, 2.4, 0);
  const tickFound = detectNeedleAngle(tickOnly, 70, 70, 140 * 0.18, 140 * 0.44);
  assert.ok(tickFound.quality < 0.08, `outer tick looked like a needle q ${tickFound.quality.toFixed(3)} likeness ${tickFound.likeness.toFixed(3)} angle ${tickFound.angleDeg}`);

  const dotted = blankFrame(140, 228);
  paintRadial(dotted, 70, 70, 200, 18, 54, 1.4, 42);
  for (let r = 18; r <= 54; r += 5) paintRadial(dotted, 70, 70, 100, r, r + 1.2, 2.2, 0);
  const dottedFound = detectNeedleAngle(dotted, 70, 70, 140 * 0.16, 140 * 0.42);
  const dottedError = Math.abs(wrapDelta(200, dottedFound.angleDeg));
  assert.ok(dottedError <= 8, `fragmented radial won at ${dottedFound.angleDeg} q ${dottedFound.quality.toFixed(3)}`);

  const broader = blankFrame(140, 228);
  paintRadial(broader, 70, 70, 40, 18, 58, 1.5, 18);
  paintRadial(broader, 70, 70, 110, 16, 60, 3.2, 36);
  const broaderFound = detectNeedleAngle(broader, 70, 70, 140 * 0.18, 140 * 0.44);
  const broaderError = Math.abs(wrapDelta(40, broaderFound.angleDeg));
  assert.ok(broaderError <= 8, `wider mark outranked the needle at ${broaderFound.angleDeg} q ${broaderFound.quality.toFixed(3)}`);
  assert.ok(broaderFound.quality > 0.15, `broader quality ${broaderFound.quality}`);

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
  const atNewHub = detectNeedleAngle(translated, 90, 68, 36 * TIP_INNER_RATIO, 36 * OUTER_RADIUS_RATIO);
  const atOldHub = detectNeedleAngle(translated, 75, 75, 36 * TIP_INNER_RATIO, 36 * OUTER_RADIUS_RATIO);
  assert.ok(Math.abs(wrapDelta(40, atNewHub.angleDeg)) <= 8, `needle on moved gauge ${atNewHub.angleDeg}`);
  assert.ok(Math.abs(wrapDelta(40, atOldHub.angleDeg)) > 8, `stale hub should miss, got ${atOldHub.angleDeg}`);

  const sleeveGauge = makeGaugeImage(180, {
    cx: 90, cy: 90, radius: 60, needleDeg: 47, sleeveEdge: { angleDeg: 125, value: 40 },
  });
  const sleeveNeedle = detectNeedleAngle(sleeveGauge, 90, 90, 60 * TIP_INNER_RATIO, 60 * OUTER_RADIUS_RATIO);
  assert.ok(Math.abs(wrapDelta(47, sleeveNeedle.angleDeg)) <= 8, `sleeve step stole the needle at ${sleeveNeedle.angleDeg} q ${sleeveNeedle.quality.toFixed(3)}`);
  assert.ok(sleeveNeedle.quality >= 0.18, `sleeve needle quality ${sleeveNeedle.quality}`);
  assert.ok(sleeveNeedle.likeness >= 0.4, `sleeve needle likeness ${sleeveNeedle.likeness}`);

  const stepOnlyGauge = makeGaugeImage(180, {
    cx: 90, cy: 90, radius: 60, needleDeg: 47, drawNeedle: false, sleeveEdge: { angleDeg: 125, value: 40 },
  });
  const stepOnlyNeedle = detectNeedleAngle(stepOnlyGauge, 90, 90, 60 * TIP_INNER_RATIO, 60 * OUTER_RADIUS_RATIO);
  assert.ok(
    stepOnlyNeedle.quality < 0.18 || stepOnlyNeedle.likeness < 0.4,
    `radial sleeve step looked like a needle q ${stepOnlyNeedle.quality.toFixed(3)} like ${stepOnlyNeedle.likeness.toFixed(3)} at ${stepOnlyNeedle.angleDeg}`,
  );
  const stepTracker = createAngleTracker();
  stepTracker.push(47);
  for (let i = 0; i < 6; i += 1) {
    const step = stepTracker.push(stepOnlyNeedle.angleDeg, {
      quality: stepOnlyNeedle.quality,
      likeness: stepOnlyNeedle.likeness,
    });
    assert.equal(step.accepted, false, `sleeve step accepted on frame ${i} as ${step.angle}`);
    assert.ok(Math.abs(wrapDelta(47, step.angle)) < 1);
  }

  const chordGauge = makeGaugeImage(180, {
    cx: 90, cy: 90, radius: 60, needleDeg: 47, sleeveChord: { angleDeg: 90, offset: 28, value: 38 },
  });
  const chordNeedle = detectNeedleAngle(chordGauge, 90, 90, 60 * TIP_INNER_RATIO, 60 * OUTER_RADIUS_RATIO);
  assert.ok(Math.abs(wrapDelta(47, chordNeedle.angleDeg)) <= 8, `chord sleeve stole the needle at ${chordNeedle.angleDeg} q ${chordNeedle.quality.toFixed(3)}`);

  const coveredGauge = makeGaugeImage(180, {
    cx: 90, cy: 90, radius: 60, needleDeg: 47, drawNeedle: false, sleeveChord: { angleDeg: 15, offset: 8, value: 36 },
  });
  const coveredNeedle = detectNeedleAngle(coveredGauge, 90, 90, 60 * TIP_INNER_RATIO, 60 * OUTER_RADIUS_RATIO);
  const coveredTracker = createAngleTracker();
  coveredTracker.push(47);
  for (let i = 0; i < 5; i += 1) {
    const step = coveredTracker.push(coveredNeedle.angleDeg, {
      quality: coveredNeedle.quality,
      likeness: coveredNeedle.likeness,
    });
    if (Math.abs(wrapDelta(47, coveredNeedle.angleDeg)) > 12) {
      assert.equal(step.accepted, false, `occluding chord accepted ${coveredNeedle.angleDeg}`);
    }
    assert.ok(Math.abs(wrapDelta(47, step.angle)) <= 12, `occluding chord moved pressure to ${step.angle}`);
  }

  const restingNeedle = detectNeedleAngle(
    makeGaugeImage(180, { cx: 90, cy: 90, radius: 60, needleDeg: 47 }),
    90, 90, 60 * TIP_INNER_RATIO, 60 * OUTER_RADIUS_RATIO,
  );
  const fastNeedle = detectNeedleAngle(
    makeGaugeImage(180, { cx: 90, cy: 90, radius: 60, needleDeg: 110 }),
    90, 90, 60 * TIP_INNER_RATIO, 60 * OUTER_RADIUS_RATIO,
  );
  assert.ok(Math.abs(wrapDelta(47, restingNeedle.angleDeg)) <= 8, `rest needle ${restingNeedle.angleDeg}`);
  assert.ok(Math.abs(wrapDelta(110, fastNeedle.angleDeg)) <= 8, `fast needle ${fastNeedle.angleDeg}`);
  assert.ok(fastNeedle.quality >= 0.18 && fastNeedle.likeness >= 0.4, `fast evidence q ${fastNeedle.quality} like ${fastNeedle.likeness}`);
  const fastTracker = createAngleTracker();
  fastTracker.push(restingNeedle.angleDeg);
  const fastMeta = { quality: fastNeedle.quality, likeness: fastNeedle.likeness };
  assert.equal(fastTracker.push(fastNeedle.angleDeg, fastMeta).accepted, false);
  assert.equal(fastTracker.push(fastNeedle.angleDeg, fastMeta).accepted, false);
  const fastLocked = fastTracker.push(fastNeedle.angleDeg, fastMeta);
  assert.equal(fastLocked.accepted, true);
  assert.ok(Math.abs(wrapDelta(fastNeedle.angleDeg, fastLocked.angle)) <= 2, `fast lock ${fastLocked.angle}`);

  const translatedNeedle = detectNeedleAngle(
    makeGaugeImage(180, { cx: 112, cy: 74, radius: 60, needleDeg: 120 }),
    112, 74, 60 * TIP_INNER_RATIO, 60 * OUTER_RADIUS_RATIO,
  );
  assert.ok(Math.abs(wrapDelta(120, translatedNeedle.angleDeg)) <= 8, `translated needle ${translatedNeedle.angleDeg}`);
  const bothTracker = createAngleTracker();
  bothTracker.push(restingNeedle.angleDeg);
  const bothMeta = { quality: translatedNeedle.quality, likeness: translatedNeedle.likeness };
  assert.ok(bothMeta.quality >= 0.18 && bothMeta.likeness >= 0.4, `translated evidence q ${bothMeta.quality} like ${bothMeta.likeness}`);
  assert.equal(bothTracker.push(translatedNeedle.angleDeg, { ...bothMeta, poseSnap: true }).accepted, false);
  assert.equal(bothTracker.push(translatedNeedle.angleDeg, bothMeta).accepted, false);
  assert.equal(bothTracker.push(translatedNeedle.angleDeg, bothMeta).accepted, false);
  const bothLocked = bothTracker.push(translatedNeedle.angleDeg, bothMeta);
  assert.equal(bothLocked.accepted, true);
  assert.ok(Math.abs(wrapDelta(translatedNeedle.angleDeg, bothLocked.angle)) <= 2, `move plus needle ${bothLocked.angle}`);

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
    const needle = detectNeedleAngle(image, pose.cx, pose.cy, pose.radius * TIP_INNER_RATIO, pose.radius * OUTER_RADIUS_RATIO);
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

  assert.equal(DIAGNOSTIC_WINDOW_MS, 120_000);
  const wideHistory = createDiagnosticHistory();
  wideHistory.push({ t: 0, pressure: 1 });
  wideHistory.push({ t: 90_000, pressure: 2 });
  wideHistory.push({ t: 120_000, pressure: 3 });
  assert.equal(wideHistory.length, 3);
  wideHistory.push({ t: 120_001, pressure: 4 });
  const wideTrace = wideHistory.snapshot();
  assert.equal(wideTrace.length, 3);
  assert.equal(wideTrace[0].t, 90_000);
  assert.equal(wideTrace[2].t, 120_001);
  assert.equal(wideTrace[2].pressure, 4);

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
    assert.equal(reading.gauge.trackMode, 'locked');
    assert.equal(reading.gauge.reacquireHits, 0);
    assert.equal(reading.gauge.reacquireAccepted, false);
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

  const motionTracker = createGaugeTracker();
  const motionStill = makeGaugeImage(200, { cx: 90, cy: 88, radius: 42, needleDeg: 47, rotationDeg: 0 });
  motionTracker.seed({ cx: 90, cy: 88, radius: 42 });
  let settledMotion = null;
  for (let i = 0; i < 6; i += 1) settledMotion = analyzeGaugeImage(motionStill, motionTracker);
  const falseSpin = makeGaugeImage(200, { cx: 90, cy: 88, radius: 42, needleDeg: 47, rotationDeg: 15 });
  const falseRead = analyzeGaugeImage(falseSpin, motionTracker);
  assert.ok(Math.abs(wrapDelta(settledMotion.gauge.rotationDeg, falseRead.gauge.rotationDeg)) < 1.5, `false spin applied ${falseRead.gauge.rotationDeg}`);
  assert.ok(Math.abs(wrapDelta(settledMotion.relativeAngleDeg, falseRead.relativeAngleDeg)) < 4, `false spin moved relative ${settledMotion.relativeAngleDeg} -> ${falseRead.relativeAngleDeg}`);
  assert.equal(falseRead.gauge.posePending, true);
  assert.ok(falseRead.gauge.poseRejectReason === 'rotation-unconfirmed' || falseRead.gauge.poseRejectReason === 'pose-inconsistent', falseRead.gauge.poseRejectReason);
  assert.equal(falseRead.gauge.held, true);
  const falseAgain = analyzeGaugeImage(falseSpin, motionTracker);
  assert.ok(Math.abs(wrapDelta(settledMotion.gauge.rotationDeg, falseAgain.gauge.rotationDeg)) < 1.5, `repeated false spin applied ${falseAgain.gauge.rotationDeg}`);
  const yanked = makeGaugeImage(200, { cx: 90, cy: 88, radius: 42, needleDeg: 97, rotationDeg: 0 });
  const yankRead = analyzeGaugeImage(yanked, motionTracker);
  assert.ok(Math.abs(wrapDelta(settledMotion.gauge.rotationDeg, yankRead.gauge.rotationDeg)) < 2, `needle moved the gauge to ${yankRead.gauge.rotationDeg}`);
  assert.ok(Math.hypot(yankRead.gauge.cx - settledMotion.gauge.cx, yankRead.gauge.cy - settledMotion.gauge.cy) < 2, 'needle moved the gauge centre');
  assert.equal(yankRead.gauge.trackMode, 'locked');
  assert.equal(yankRead.gauge.reacquireAccepted, false);
  const realSpin = makeGaugeImage(200, { cx: 90, cy: 88, radius: 42, needleDeg: 59, rotationDeg: 12 });
  let realRead = null;
  for (let i = 0; i < 3; i += 1) realRead = analyzeGaugeImage(realSpin, motionTracker);
  assert.ok(Math.abs(wrapDelta(12, realRead.gauge.rotationDeg)) <= 6, `real spin stayed at ${realRead.gauge.rotationDeg}`);
  assert.ok(Math.abs(wrapDelta(47, realRead.relativeAngleDeg)) <= 8, `real spin relative ${realRead.relativeAngleDeg}`);
  for (let i = 0; i < 3; i += 1) settledMotion = analyzeGaugeImage(motionStill, motionTracker);
  const incoherent = makeGaugeImage(200, { cx: 108, cy: 76, radius: 42, needleDeg: 47, rotationDeg: 15 });
  const incoherentRead = analyzeGaugeImage(incoherent, motionTracker);
  const incoherentShift = Math.hypot(incoherentRead.gauge.cx - settledMotion.gauge.cx, incoherentRead.gauge.cy - settledMotion.gauge.cy);
  assert.ok(incoherentShift < 2, `incoherent pose moved the centre ${incoherentShift.toFixed(1)} px`);
  assert.ok(Math.abs(wrapDelta(settledMotion.gauge.rotationDeg, incoherentRead.gauge.rotationDeg)) < 1.5, `incoherent pose rotated to ${incoherentRead.gauge.rotationDeg}`);
  assert.ok(incoherentRead.gauge.poseRejectReason === 'pose-inconsistent' || incoherentRead.gauge.poseRejectReason === 'dial-unrecognized' || incoherentRead.gauge.poseRejectReason === 'rotation-unconfirmed', incoherentRead.gauge.poseRejectReason);
  let followed = null;
  const movedGauge = makeGaugeImage(200, { cx: 108, cy: 76, radius: 42, needleDeg: 47, rotationDeg: 0 });
  for (let i = 0; i < 4; i += 1) followed = analyzeGaugeImage(movedGauge, motionTracker);
  const motionFollow = Math.hypot(followed.gauge.cx - 108, followed.gauge.cy - 76);
  assert.ok(motionFollow <= 6, `coherent move was not followed ${motionFollow.toFixed(1)}`);
  assert.ok(Math.abs(wrapDelta(47, followed.relativeAngleDeg)) <= 8, `coherent move relative ${followed.relativeAngleDeg}`);
  let stepped = followed;
  for (let step = 1; step <= 6; step += 1) {
    const frame = makeGaugeImage(200, { cx: 108 + step * 5, cy: 76 - step * 2, radius: 42, needleDeg: 47, rotationDeg: 0 });
    stepped = analyzeGaugeImage(frame, motionTracker);
    assert.ok(Math.abs(wrapDelta(47, stepped.relativeAngleDeg)) <= 10, `step ${step} relative ${stepped.relativeAngleDeg}`);
  }
  const stepFollow = Math.hypot(stepped.gauge.cx - (108 + 30), stepped.gauge.cy - (76 - 12));
  assert.ok(stepFollow <= 8, `continuous move stopped at ${stepped.gauge.cx.toFixed(1)},${stepped.gauge.cy.toFixed(1)}`);

  const farTracker = createGaugeTracker();
  const farHome = makeGaugeImage(280, { cx: 90, cy: 140, radius: 32, needleDeg: 47, rotationDeg: 0 });
  farTracker.seed({ cx: 90, cy: 140, radius: 32 });
  let farSettled = null;
  for (let i = 0; i < 6; i += 1) farSettled = analyzeGaugeImage(farHome, farTracker);
  const farJump = 32 * 1.6;
  const farAway = makeGaugeImage(280, { cx: 90 + farJump, cy: 140, radius: 32, needleDeg: 47, rotationDeg: 0 });
  const farFirst = analyzeGaugeImage(farAway, farTracker);
  const farFirstShift = Math.hypot(farFirst.gauge.cx - farSettled.gauge.cx, farFirst.gauge.cy - farSettled.gauge.cy);
  assert.ok(farFirstShift < 4, `a distant gauge was accepted on one frame (${farFirstShift.toFixed(1)} px)`);
  assert.equal(farFirst.gauge.reacquireAccepted, false);
  const farReads = [farFirst];
  let farRecovered = farFirst;
  for (let i = 0; i < 14; i += 1) {
    farRecovered = analyzeGaugeImage(farAway, farTracker);
    farReads.push(farRecovered);
  }
  const farError = Math.hypot(farRecovered.gauge.cx - (90 + farJump), farRecovered.gauge.cy - 140);
  assert.ok(farError <= 8, `large translation was not reacquired (${farRecovered.gauge.cx.toFixed(1)}, ${farRecovered.gauge.cy.toFixed(1)})`);
  assert.ok(Math.abs(wrapDelta(47, farRecovered.relativeAngleDeg)) <= 8, `reacquire changed relative ${farRecovered.relativeAngleDeg}`);
  assert.ok(farReads.some((reading) => reading.gauge.trackMode === 'searching'), 'large translation never entered search');
  assert.ok(farReads.some((reading) => reading.gauge.reacquireAccepted), 'large translation was not confirmed');
  assert.ok(farReads.some((reading) => reading.gauge.held), 'pressure pose was not held while the gauge was lost');

  const blipTracker = createGaugeTracker();
  blipTracker.seed({ cx: 90, cy: 140, radius: 32 });
  for (let i = 0; i < 4; i += 1) analyzeGaugeImage(farHome, blipTracker);
  analyzeGaugeImage(farAway, blipTracker);
  let blipBack = null;
  for (let i = 0; i < 3; i += 1) blipBack = analyzeGaugeImage(farHome, blipTracker);
  const blipShift = Math.hypot(blipBack.gauge.cx - 90, blipBack.gauge.cy - 140);
  assert.ok(blipShift <= 8, `one distant frame moved the pose to ${blipBack.gauge.cx.toFixed(1)}, ${blipBack.gauge.cy.toFixed(1)}`);
  assert.equal(blipBack.gauge.reacquireAccepted, false);

  const rigidTracker = createGaugeTracker();
  rigidTracker.seed({ cx: 90, cy: 140, radius: 32 });
  for (let i = 0; i < 6; i += 1) analyzeGaugeImage(farHome, rigidTracker);
  const rigidAway = makeGaugeImage(280, { cx: 90 + farJump, cy: 140, radius: 32, needleDeg: 65, rotationDeg: 18 });
  let rigidRead = null;
  for (let i = 0; i < 16; i += 1) rigidRead = analyzeGaugeImage(rigidAway, rigidTracker);
  const rigidError = Math.hypot(rigidRead.gauge.cx - (90 + farJump), rigidRead.gauge.cy - 140);
  assert.ok(rigidError <= 8, `rotated gauge was not reacquired (${rigidRead.gauge.cx.toFixed(1)}, ${rigidRead.gauge.cy.toFixed(1)})`);
  assert.ok(Math.abs(wrapDelta(18, rigidRead.gauge.rotationDeg)) <= 8, `reacquire rotation ${rigidRead.gauge.rotationDeg}`);
  assert.ok(Math.abs(wrapDelta(47, rigidRead.relativeAngleDeg)) <= 10, `rigid reacquire relative ${rigidRead.relativeAngleDeg}`);

  const midTracker = createGaugeTracker();
  midTracker.seed({ cx: 90, cy: 140, radius: 32 });
  for (let i = 0; i < 6; i += 1) analyzeGaugeImage(farHome, midTracker);
  const midAway = makeGaugeImage(280, {
    cx: 90 + farJump, cy: 140, radius: 32, needleDeg: 87, rotationDeg: 40,
  });
  let midRead = null;
  const midReads = [];
  for (let i = 0; i < 16; i += 1) {
    midRead = analyzeGaugeImage(midAway, midTracker);
    midReads.push(midRead);
  }
  const midError = Math.hypot(midRead.gauge.cx - (90 + farJump), midRead.gauge.cy - 140);
  assert.ok(midError <= 8, `in-range rotation was not reacquired (${midRead.gauge.cx.toFixed(1)}, ${midRead.gauge.cy.toFixed(1)})`);
  assert.ok(Math.abs(wrapDelta(40, midRead.gauge.rotationDeg)) <= 8, `in-range reacquire rotation ${midRead.gauge.rotationDeg}`);
  assert.ok(midReads.some((reading) => reading.gauge.reacquireAccepted), 'in-range rotation was not confirmed');

  const quarterTracker = createGaugeTracker();
  quarterTracker.seed({ cx: 90, cy: 140, radius: 32 });
  for (let i = 0; i < 6; i += 1) analyzeGaugeImage(farHome, quarterTracker);
  const quarterAway = makeGaugeImage(280, {
    cx: 90 + farJump, cy: 140, radius: 32, needleDeg: 137, rotationDeg: 90,
  });
  const quarterReads = [];
  for (let i = 0; i < 16; i += 1) quarterReads.push(analyzeGaugeImage(quarterAway, quarterTracker));
  const quarterLast = quarterReads[quarterReads.length - 1];
  assert.ok(
    quarterReads.every((reading) => Math.abs(wrapDelta(0, reading.gauge.rotationDeg)) < 60),
    `quarter-turn reacquire rotated to ${quarterLast.gauge.rotationDeg}`,
  );
  assert.ok(
    quarterReads.every((reading) => reading.gauge.reacquireAccepted === false),
    'quarter-turn past the rotation window was accepted',
  );
  assert.ok(
    Math.hypot(quarterLast.gauge.cx - 90, quarterLast.gauge.cy - 140) <= 8,
    `quarter-turn moved the centre to ${quarterLast.gauge.cx.toFixed(1)}, ${quarterLast.gauge.cy.toFixed(1)}`,
  );

  const decoyTracker = createGaugeTracker();
  decoyTracker.seed({ cx: 90, cy: 140, radius: 32 });
  for (let i = 0; i < 6; i += 1) analyzeGaugeImage(farHome, decoyTracker);
  const decoy = makeGaugeImage(280, {
    cx: 90 + farJump, cy: 140, radius: 32, needleDeg: 47, rotationDeg: 0, markings: false,
  });
  const decoyReads = [];
  let decoyRead = null;
  for (let i = 0; i < 12; i += 1) {
    decoyRead = analyzeGaugeImage(decoy, decoyTracker);
    decoyReads.push(decoyRead);
  }
  const decoyShift = Math.hypot(decoyRead.gauge.cx - 90, decoyRead.gauge.cy - 140);
  assert.ok(decoyShift <= 8, `a distant unmarked circle moved the pose by ${decoyShift.toFixed(1)} px`);
  assert.ok(decoyReads.every((reading) => reading.gauge.reacquireAccepted === false), 'false candidate was accepted');
  assert.ok(
    decoyReads.some((reading) => reading.gauge.reacquireRejectReason === 'reacquire-dial' || reading.gauge.reacquireRejectReason === 'reacquire-none' || reading.gauge.reacquireRejectReason === 'reacquire-weak'),
    `false candidate reason ${decoyRead.gauge.reacquireRejectReason}`,
  );

  const aliasTracker = createGaugeTracker();
  const aliasHome = makeGaugeImage(280, { cx: 90, cy: 140, radius: 32, needleDeg: 47, rotationDeg: 0 });
  aliasTracker.seed({ cx: 90, cy: 140, radius: 32 });
  let aliasSettled = null;
  for (let i = 0; i < 6; i += 1) aliasSettled = analyzeGaugeImage(aliasHome, aliasTracker);
  const aliasJump = makeGaugeImage(280, {
    cx: 90 + farJump,
    cy: 140,
    radius: 32,
    needleDeg: 47,
    rotationDeg: 0,
    occlude: { start: 180, span: 100, value: 40 },
  });
  const aliasReads = [];
  for (let i = 0; i < 16; i += 1) aliasReads.push(analyzeGaugeImage(aliasJump, aliasTracker));
  const aliasLast = aliasReads[aliasReads.length - 1];
  assert.ok(
    aliasReads.every((reading) => reading.gauge.reacquireAccepted === false),
    'an occluded tick alias was accepted',
  );
  assert.ok(
    aliasReads.every((reading) => reading.gauge.reacquireHits < 3),
    'three agreeing ambiguous observations confirmed a pose',
  );
  assert.ok(
    aliasReads.some((reading) => reading.gauge.reacquireRejectReason === 'reacquire-ambiguous'),
    `occluded dial was not marked ambiguous (${aliasLast.gauge.reacquireRejectReason})`,
  );
  const aliasProposal = aliasReads.find((reading) => reading.gauge.reacquireRejectReason === 'reacquire-ambiguous');
  assert.ok(
    Math.abs(wrapDelta(0, aliasProposal.gauge.reacquireRotation)) > 25,
    `expected a large false proposal, got ${aliasProposal.gauge.reacquireRotation}`,
  );
  assert.ok(
    Math.abs(wrapDelta(0, aliasLast.gauge.rotationDeg)) < 8,
    `occluded dial walked the rotation to ${aliasLast.gauge.rotationDeg}`,
  );
  assert.equal(aliasLast.gauge.held, true, 'occluded dial stopped holding the last pose');
  assert.equal(aliasLast.gauge.reacquireAccepted, false);
  assert.ok(
    Math.hypot(aliasLast.gauge.cx - aliasSettled.gauge.cx, aliasLast.gauge.cy - aliasSettled.gauge.cy) <= 8,
    `occluded dial moved the centre to ${aliasLast.gauge.cx.toFixed(1)}, ${aliasLast.gauge.cy.toFixed(1)}`,
  );

  const partialTracker = createGaugeTracker();
  const partialHome = makeGaugeImage(280, { cx: 90, cy: 140, radius: 32, needleDeg: 47, rotationDeg: 0 });
  partialTracker.seed({ cx: 90, cy: 140, radius: 32 });
  for (let i = 0; i < 6; i += 1) analyzeGaugeImage(partialHome, partialTracker);
  const partial = makeGaugeImage(280, {
    cx: 90 + farJump,
    cy: 140,
    radius: 32,
    needleDeg: 47,
    rotationDeg: 0,
    occlude: { start: 180, span: 60, value: 40 },
  });
  const partialReads = [];
  for (let i = 0; i < 12; i += 1) partialReads.push(analyzeGaugeImage(partial, partialTracker));
  const partialLast = partialReads[partialReads.length - 1];
  assert.ok(
    partialReads.every((reading) => reading.gauge.reacquireAccepted === false),
    'a sharp but non-unique tick alias was accepted',
  );
  assert.ok(
    partialReads.every((reading) => reading.gauge.reacquireHits < 3),
    'three repeats of a non-unique alias confirmed it',
  );
  assert.ok(
    partialReads.some((reading) => reading.gauge.reacquireRejectReason === 'reacquire-ambiguous'),
    `partial occlusion was not marked ambiguous (${partialLast.gauge.reacquireRejectReason})`,
  );
  const partialProposal = partialReads.find((reading) => (
    reading.gauge.reacquireRejectReason === 'reacquire-ambiguous'
    && Math.abs(wrapDelta(0, reading.gauge.reacquireRotation)) > 25
  ));
  assert.ok(partialProposal, 'partial occlusion did not propose a large alias');
  assert.ok(
    Math.abs(wrapDelta(0, partialLast.gauge.rotationDeg)) < 8,
    `partial occlusion walked the rotation to ${partialLast.gauge.rotationDeg}`,
  );

  const splitTracker = createGaugeTracker();
  const markedHome = makeGaugeImage(280, {
    cx: 90, cy: 140, radius: 32, needleDeg: 47, rotationDeg: 0, faceMark: true,
  });
  splitTracker.seed({ cx: 90, cy: 140, radius: 32 });
  let markedSettled = null;
  for (let i = 0; i < 6; i += 1) markedSettled = analyzeGaugeImage(markedHome, splitTracker);
  const split = makeGaugeImage(280, {
    cx: 90 + farJump,
    cy: 140,
    radius: 32,
    needleDeg: 47,
    rotationDeg: 0,
    faceMark: true,
    tickRotationDeg: 35,
    faceRotationDeg: 0,
  });
  const splitReads = [];
  for (let i = 0; i < 8; i += 1) splitReads.push(analyzeGaugeImage(split, splitTracker));
  const splitLast = splitReads[splitReads.length - 1];
  assert.ok(
    splitReads.every((reading) => reading.gauge.reacquireAccepted === false),
    'a large rim rotation was accepted while the white face disagreed',
  );
  assert.ok(
    splitReads.every((reading) => reading.gauge.reacquireHits < 3),
    'three agreeing rim observations overrode the white face',
  );
  assert.ok(
    splitReads.some((reading) => reading.gauge.reacquireRejectReason === 'reacquire-ambiguous'),
    `face disagreement reason ${splitLast.gauge.reacquireRejectReason}`,
  );
  assert.ok(
    Math.abs(wrapDelta(markedSettled.gauge.rotationDeg, splitLast.gauge.rotationDeg)) < 8,
    `face disagreement rotated to ${splitLast.gauge.rotationDeg}`,
  );
  assert.equal(splitLast.gauge.held, true, 'face disagreement stopped holding the last pose');
  assert.ok(
    Math.hypot(splitLast.gauge.cx - markedSettled.gauge.cx, splitLast.gauge.cy - markedSettled.gauge.cy) <= 8,
    `face disagreement moved the centre to ${splitLast.gauge.cx.toFixed(1)}, ${splitLast.gauge.cy.toFixed(1)}`,
  );

  const agreeTracker = createGaugeTracker();
  agreeTracker.seed({ cx: 90, cy: 140, radius: 32 });
  for (let i = 0; i < 6; i += 1) analyzeGaugeImage(markedHome, agreeTracker);
  const agreed = makeGaugeImage(280, {
    cx: 90 + farJump,
    cy: 140,
    radius: 32,
    needleDeg: 82,
    rotationDeg: 35,
    faceMark: true,
  });
  let agreedRead = null;
  const agreedReads = [];
  for (let i = 0; i < 16; i += 1) {
    agreedRead = analyzeGaugeImage(agreed, agreeTracker);
    agreedReads.push(agreedRead);
  }
  assert.ok(
    agreedReads.some((reading) => reading.gauge.reacquireAccepted),
    'a large rotation agreed by the rim and the white face was not reacquired',
  );
  assert.ok(
    Math.abs(wrapDelta(35, agreedRead.gauge.rotationDeg)) <= 8,
    `agreed rotation stayed at ${agreedRead.gauge.rotationDeg}`,
  );
  assert.ok(
    Math.abs(wrapDelta(47, agreedRead.relativeAngleDeg)) <= 10,
    `agreed rotation relative ${agreedRead.relativeAngleDeg}`,
  );

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
  assert.equal(typeof stillReads[0].gauge.rawRadius, 'number');

  const when = new Date(2026, 5, 15, 14, 30, 5);
  const reportSamples = [
    { t: 1000, tracking: 'CALIBRATING', rawAngle: 10, relativeAngle: 10, smoothedAngle: null, pressure: null, rawPressure: null, pressureMeasured: false, needleVisible: false, gaugeHeld: false, flipHeld: false, weakNeedle: false, angleAccepted: false, gaugeX: 100, gaugeY: 200, rawGaugeX: 101, rawGaugeY: 202, gaugeRotation: 0, rawRotation: 1, gaugeRadius: 40, rawGaugeRadius: 41, quality: 0.2, gaugeConfidence: 0.5, orientationConfidence: 0.4 },
    { t: 1200, tracking: 'TRACKING', rawAngle: 350, relativeAngle: 350, smoothedAngle: 350, pressure: 0, rawPressure: 0, pressureMeasured: true, needleVisible: true, gaugeHeld: false, flipHeld: false, weakNeedle: false, angleAccepted: true, gaugeX: 100, gaugeY: 200, rawGaugeX: 103, rawGaugeY: 200, gaugeRotation: 0, rawRotation: 1, gaugeRadius: 40, rawGaugeRadius: 41, quality: 0.5, gaugeConfidence: 0.6, orientationConfidence: 0.7 },
    { t: 1500, tracking: 'LOST', rawAngle: 10, relativeAngle: 10, smoothedAngle: 350, pressure: 0, rawPressure: null, pressureMeasured: false, needleVisible: false, gaugeHeld: false, flipHeld: false, weakNeedle: true, angleAccepted: false, gaugeX: 100, gaugeY: 200, rawGaugeX: 103, rawGaugeY: 206, gaugeRotation: 0, rawRotation: 1, gaugeRadius: 40, rawGaugeRadius: 41, quality: 0.05, gaugeConfidence: 0.4, orientationConfidence: 0.3 },
    { t: 1800, tracking: 'TRACKING', rawAngle: 12, relativeAngle: 20, smoothedAngle: 12, pressure: 0.4, rawPressure: 2.4, pressureMeasured: true, needleVisible: true, gaugeHeld: false, flipHeld: false, weakNeedle: false, angleAccepted: true, gaugeX: 108, gaugeY: 200, rawGaugeX: 103, rawGaugeY: 206, gaugeRotation: 9, rawRotation: 1, gaugeRadius: 40, rawGaugeRadius: 41, quality: 0.55, gaugeConfidence: 0.7, orientationConfidence: 0.8 },
  ];
  const report = buildDiagnosticReport(reportSamples, {
    timestamp: when,
    cameraWidth: 1280,
    cameraHeight: 720,
    calibrationStatus: 'calibrated',
  });
  assert.ok(report.startsWith('FLAIR PRESSURE LAB — DIAGNOSTIC REPORT'));
  assert.ok(report.includes(`Timestamp: ${formatLocalTimestamp(when)}`));
  assert.ok(report.includes('Camera resolution: 1280×720'));
  assert.ok(report.includes('Calibration status: calibrated'));
  assert.ok(report.includes('Physical movement is user-confirmed externally.'));
  assert.ok(report.includes('buffer 120s'));
  assert.ok(report.includes('Smoothed pressure:'));
  assert.ok(report.includes('Held pressure values:'));
  assert.ok(report.includes('Last accepted centre: 108.0, 200.0 px'));
  assert.ok(report.includes('Largest accepted centre displacement: 8.00 px'));
  assert.ok(report.includes('Last accepted rotation: 9.00°'));
  assert.ok(report.includes('Largest accepted rotation change: 9.00°'));
  assert.ok(report.includes('Last accepted radius: 40.00 px'));
  assert.ok(report.includes('SEARCHING:\n  N/A (track mode was not recorded)'));
  assert.ok(report.includes('Valid pressure samples: 2'));
  assert.ok(report.includes('Held-pressure samples: 1'));
  assert.ok(report.includes('First: 0.000 bar'));
  assert.ok(report.includes('Last: 2.400 bar'));
  assert.ok(report.includes('Standard deviation: 1.697 bar'));
  const screenPart = report.split('Accepted/raw relative angle:')[0];
  assert.ok(screenPart.includes('Mean: 5.50°'), screenPart);
  assert.ok(report.includes('Samples with valid needle: 2'));
  assert.ok(report.includes('Detection rate: 50.0%'));
  assert.ok(report.includes('Valid → invalid transitions: 1'));
  assert.ok(report.includes('Invalid → valid transitions: 2'));
  assert.ok(report.includes('Hidden samples while LOST: 1'));
  assert.ok(report.includes('Needle score below 0.08: 1'));
  assert.ok(report.includes('TRACKING → LOST: 1'));
  assert.ok(report.includes('LOST → TRACKING: 1'));
  assert.ok(report.includes('CALIBRATING → TRACKING: 1'));
  assert.ok(report.includes('00.20  Calibration complete'));
  assert.ok(report.includes('00.50  Needle became invalid'));
  assert.ok(report.includes('00.80  Needle valid again'));
  assert.ok(report.includes('Accepted relative angle changed 30.0°'));
  assert.ok(report.includes('Applied centre moved 8.0 px'));
  assert.ok(report.includes('Applied rotation changed 9.0°'));
  assert.ok(report.includes('Measured pressure entered the 2 bar range (2.40 bar)'));
  assert.ok(report.includes('Needle raw angle SD: 10.38'));
  assert.ok(report.includes('Gauge applied centre SD: 4.00'));
  assert.ok(report.includes('TRACKING %: 50.0%'));
  assert.ok(report.includes('LOST %: 25.0%'));
  assert.ok(report.includes('Needle valid→invalid transitions: 1'));
  assert.ok(report.includes('N/A (candidate fields were not recorded)'));
  const candidateReport = buildDiagnosticReport([
    { t: 1000, tracking: 'TRACKING', rawAngle: 10, relativeAngle: 10, smoothedAngle: 10, pressure: 1, candidateAngle: 10, candidateScore: 4, secondCandidateAngle: 53, secondCandidateScore: 1, candidateDelta: 0, candidateMargin: 0.75, candidateLikeness: 0.8, quality: 0.75 },
    { t: 1125, tracking: 'TRACKING', rawAngle: 12, relativeAngle: 12, smoothedAngle: 11, pressure: 1, candidateAngle: 55, candidateScore: 3, secondCandidateAngle: 12, secondCandidateScore: 2.5, candidateDelta: 44, candidateMargin: 0.16, candidateLikeness: 0.7, quality: 0.16 },
  ], { timestamp: when, calibrationStatus: 'calibrated' });
  assert.ok(candidateReport.includes('Best candidate angle:'));
  assert.ok(candidateReport.includes('Second-best candidate score:'));
  assert.ok(candidateReport.includes('Candidate-to-accepted |delta|:'));
  assert.ok(candidateReport.includes('Candidate margin:'));
  assert.ok(candidateReport.includes('Candidate likeness:'));
  assert.ok(candidateReport.includes('Best-to-second separation mode: 45° on 2 of 2 frames (100.0%), binned to 5°.'));
  assert.ok(candidateReport.includes('Candidate-to-accepted delta mean: 22.00'));
  assert.ok(candidateReport.includes('Needle decisions: N/A (needle decision was not recorded)'));
  const heldReport = buildDiagnosticReport([
    { t: 1000, tracking: 'TRACKING', rawAngle: 10, relativeAngle: 10, smoothedAngle: 10, pressure: 0.2, rawPressure: 0.2, pressureMeasured: true, angleAccepted: true, quality: 0.8, candidateLikeness: 0.8, candidateMargin: 0.7, candidateJump: 0, needleDecision: 'accepted', confirmationHits: 0, poseAge: 12 },
    { t: 1125, tracking: 'UNCERTAIN', rawAngle: 70, relativeAngle: 70, smoothedAngle: 10, pressure: 0.2, rawPressure: null, pressureMeasured: false, angleAccepted: false, quality: 0.5, candidateLikeness: 0.22, candidateMargin: 0.1, candidateJump: 60, needleDecision: 'jump-ambiguous', confirmationHits: 0, poseAge: 13 },
  ], { timestamp: when, calibrationStatus: 'calibrated' });
  assert.ok(heldReport.includes('Needle decisions:'));
  assert.ok(heldReport.includes('jump-ambiguous: 1'));
  assert.ok(heldReport.includes('Held needle candidate +60.0° (jump-ambiguous)'));
  assert.ok(heldReport.includes('likeness 0.22'));
  assert.ok(heldReport.includes('Candidate jump from the last accepted angle:'));
  const poseReport = buildDiagnosticReport([
    { t: 1000, tracking: 'TRACKING', rawAngle: 10, relativeAngle: 10, smoothedAngle: 10, pressure: 1, gaugeX: 100, gaugeY: 100, rawGaugeX: 100, rawGaugeY: 100, gaugeRotation: 0, rawRotation: 0, gaugeRadius: 40, poseQuality: 0.9, poseRejectReason: null, posePending: false, poseDeltaPx: 0, poseDeltaRot: 0 },
    { t: 1125, tracking: 'UNCERTAIN', rawAngle: 10, relativeAngle: 10, smoothedAngle: 10, pressure: 1, gaugeX: 100, gaugeY: 100, rawGaugeX: 112, rawGaugeY: 100, gaugeRotation: 0, rawRotation: 16, gaugeRadius: 40, poseQuality: 0.4, poseRejectReason: 'rotation-unconfirmed', posePending: true, poseDeltaPx: 0, poseDeltaRot: 0 },
  ], { timestamp: when, calibrationStatus: 'calibrated' });
  assert.ok(poseReport.includes('POSE DECISIONS'));
  assert.ok(poseReport.includes('rotation-unconfirmed: 1'));
  assert.ok(poseReport.includes('Pending confirmation: 1 of 2 samples (50.0%)'));
  assert.ok(poseReport.includes('Pose rejected (rotation-unconfirmed)'));
  assert.ok(poseReport.includes('raw rotation 16.0° from applied'));
  assert.ok(poseReport.includes('Pose rejections: 1 (50.0%)'));
  assert.ok(poseReport.includes('Pose pending: 1 (50.0%)'));
  assert.ok(poseReport.includes('N/A (reacquisition was not recorded)'));
  const reacquireReport = buildDiagnosticReport([
    { t: 1000, tracking: 'TRACKING', rawAngle: 10, relativeAngle: 10, smoothedAngle: 10, pressure: 1, gaugeX: 90, gaugeY: 140, gaugeRadius: 32, trackMode: 'locked', searchFraction: 0.46, reacquireHits: 0, reacquireRejectReason: null, reacquireAccepted: false },
    { t: 1125, tracking: 'UNCERTAIN', rawAngle: 10, relativeAngle: 10, smoothedAngle: 10, pressure: 1, gaugeX: 90, gaugeY: 140, gaugeRadius: 32, trackMode: 'searching', searchFraction: 0.9, reacquireCx: 140, reacquireCy: 140, reacquireRadius: 32, reacquireRotation: 0, reacquireQuality: 0.2, reacquireHits: 0, reacquireRejectReason: 'reacquire-dial', reacquireAccepted: false },
    { t: 1250, tracking: 'UNCERTAIN', rawAngle: 10, relativeAngle: 10, smoothedAngle: 10, pressure: 1, gaugeX: 90, gaugeY: 140, gaugeRadius: 32, trackMode: 'searching', searchFraction: 1.25, reacquireCx: 141, reacquireCy: 140, reacquireRadius: 32, reacquireRotation: 2, reacquireQuality: 0.72, reacquireHits: 1, reacquireRejectReason: 'reacquire-pending', reacquireAccepted: false },
    { t: 1500, tracking: 'TRACKING', rawAngle: 12, relativeAngle: 12, smoothedAngle: 12, pressure: 1, gaugeX: 142, gaugeY: 140, gaugeRadius: 32, trackMode: 'locked', searchFraction: 1.6, reacquireCx: 142, reacquireCy: 140, reacquireRadius: 32, reacquireRotation: 2, reacquireQuality: 0.8, reacquireHits: 3, reacquireRejectReason: null, reacquireAccepted: true },
  ], { timestamp: when, calibrationStatus: 'calibrated' });
  assert.ok(reacquireReport.includes('REACQUISITION'));
  assert.ok(reacquireReport.includes('Searching samples: 2'));
  assert.ok(reacquireReport.includes('Search window while searching: min 0.90× / max 1.25× radius'));
  assert.ok(reacquireReport.includes('reacquire-dial: 1'));
  assert.ok(reacquireReport.includes('reacquire-pending: 1'));
  assert.ok(reacquireReport.includes('Reacquisition accepted: 1'));
  assert.ok(reacquireReport.includes('Confirming frames max: 3'));
  assert.ok(reacquireReport.includes('Reacquisition started'));
  assert.ok(reacquireReport.includes('Reacquisition candidate rejected (reacquire-dial)'));
  assert.ok(reacquireReport.includes('Reacquisition candidate pending confirmation'));
  assert.ok(reacquireReport.includes('Reacquisition accepted; centre moved 52.0 px'));
  assert.ok(reacquireReport.includes('Candidate centre X:'));
  assert.ok(reacquireReport.includes('Candidate centre Y:'));
  assert.ok(reacquireReport.includes('Candidate radius:'));
  assert.ok(reacquireReport.includes('Candidate rotation:'));
  assert.ok(reacquireReport.includes('Candidate rotation delta from last accepted pose:'));
  assert.ok(reacquireReport.includes('Accepted reacquisition |rotation delta| greater than 30°: N/A'));
  assert.ok(reacquireReport.includes('SEARCHING:\n  Samples: 2'));
  assert.ok(reacquireReport.includes('Largest accepted centre displacement: 52.00 px'));
  const rotationReport = buildDiagnosticReport([
    { t: 1000, tracking: 'TRACKING', rawAngle: 10, relativeAngle: 10, smoothedAngle: 10, pressure: 0, gaugeX: 10, gaugeY: 20, gaugeRotation: 10, gaugeRadius: 30, trackMode: 'locked', reacquireAccepted: false },
    { t: 2000, tracking: 'TRACKING', rawAngle: 10, relativeAngle: 10, smoothedAngle: 10, pressure: 0, gaugeX: 22, gaugeY: 20, gaugeRotation: 50, gaugeRadius: 30, trackMode: 'locked', searchFraction: 1.25, reacquireCx: 22, reacquireCy: 20, reacquireRadius: 31, reacquireRotation: 50, reacquireQuality: 0.7, reacquireHits: 3, reacquireAccepted: true },
    { t: 3000, tracking: 'TRACKING', rawAngle: 10, relativeAngle: 10, smoothedAngle: 10, pressure: 0, gaugeX: 24, gaugeY: 20, gaugeRotation: 70, gaugeRadius: 30, trackMode: 'locked', searchFraction: 0.9, reacquireCx: 24, reacquireCy: 20, reacquireRadius: 30, reacquireRotation: 70, reacquireQuality: 0.8, reacquireHits: 3, reacquireAccepted: true },
  ], { timestamp: when, calibrationStatus: 'calibrated' });
  assert.ok(rotationReport.includes('Accepted reacquisition |rotation delta| greater than 30°: 1'));
  assert.ok(rotationReport.includes('rotation Δ 40.0° from last accepted'));
  assert.ok(rotationReport.includes('Largest accepted rotation change: 40.00°'));
  assert.ok(rotationReport.includes('Largest accepted centre displacement: 12.00 px'));
  assert.ok(rotationReport.includes('Reacquisition accepted: 2'));
  const bare = buildDiagnosticReport([{ t: 5, tracking: 'TRACKING', rawAngle: 1, relativeAngle: 1, smoothedAngle: 1, pressure: 1 }], {
    timestamp: when,
    calibrationStatus: 'not calibrated',
  });
  assert.ok(bare.includes('Valid pressure samples: N/A'));
  assert.ok(bare.includes('Pose quality: N/A (pose quality was not recorded)'));
  assert.ok(bare.includes('Pending confirmation: N/A (pose pending was not recorded)'));
  assert.ok(bare.includes('Raw:\n  N/A (raw radius was not recorded)'));
  assert.ok(bare.includes('Camera resolution: N/A'));
  const blankReport = buildDiagnosticReport([], { timestamp: when, calibrationStatus: 'not calibrated' });
  assert.ok(blankReport.includes('No diagnostic samples in memory.'));
}

function blankFrame(size, value = 226) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return { data, width: size, height: size };
}

function paintRadial(image, cx, cy, angleDeg, r0, r1, halfWidth, value) {
  const { data, width, height } = image;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (let r = r0; r <= r1; r += 0.45) {
    for (let t = -halfWidth; t <= halfWidth; t += 0.45) {
      const x = Math.round(cx + r * cos - t * sin);
      const y = Math.round(cy + r * sin + t * cos);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const index = (y * width + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
    }
  }
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
  markings = true,
  gain = 1,
  bias = 0,
  shade = 0,
  noise = 0,
  seed = 1,
  occlude = null,
  faceMark = false,
  tickRotationDeg = null,
  faceRotationDeg = null,
  drawNeedle = true,
  sleeveEdge = null,
  sleeveChord = null,
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
      const tickRotation = tickRotationDeg ?? rotationDeg;
      const faceRotation = faceRotationDeg ?? rotationDeg;
      let value = 190;
      if (dist < radius - 2.4) value = 226;
      if (Math.abs(dist - radius) <= 2.2) value = 22;
      if (markings && dist > radius * 0.73 && dist < radius * 0.92 && dist < radius - 3.2) {
        let ang = (Math.atan2(dy, dx) * 180) / Math.PI - tickRotation;
        ang = ((ang % 360) + 360) % 360;
        const minor = ang % 30;
        const minorDist = Math.min(minor, 30 - minor);
        const major = ang % 90;
        const majorDist = Math.min(major, 90 - major);
        if (majorDist < 6) value = 16;
        else if (minorDist < 3.2) value = 32;
        if (angDist(ang, 200) < 16 && dist > radius * 0.76) value = 12;
      }
      if (faceMark && dist > radius * 0.42 && dist < radius * 0.58) {
        let faceAng = (Math.atan2(dy, dx) * 180) / Math.PI - faceRotation;
        faceAng = ((faceAng % 360) + 360) % 360;
        if (angDist(faceAng, 130) < 12) value = 14;
      }
      const along = dx * needleCos + dy * needleSin;
      const across = Math.abs(-dx * needleSin + dy * needleCos);
      if (drawNeedle !== false && along > radius * 0.16 && along < radius * 0.84 && across <= 1.6) value = 6;
      if (sleeveEdge && dist < radius - 2.4) {
        const edge = (sleeveEdge.angleDeg * Math.PI) / 180;
        const alongEdge = dx * Math.cos(edge) + dy * Math.sin(edge);
        const acrossEdge = -dx * Math.sin(edge) + dy * Math.cos(edge);
        if (alongEdge > radius * 0.1 && acrossEdge > 1) value = Math.min(value, sleeveEdge.value ?? 42);
      }
      if (sleeveChord && dist < radius - 2.4) {
        const edge = (sleeveChord.angleDeg * Math.PI) / 180;
        const signed = -dx * Math.sin(edge) + dy * Math.cos(edge);
        if (signed > (sleeveChord.offset ?? radius * 0.45)) value = Math.min(value, sleeveChord.value ?? 42);
      }
      if (occlude) {
        let screen = (Math.atan2(dy, dx) * 180) / Math.PI;
        screen = ((screen % 360) + 360) % 360;
        const start = ((occlude.start % 360) + 360) % 360;
        let rel = screen - start;
        if (rel < 0) rel += 360;
        const covered = rel <= occlude.span
          && dist < (occlude.radius ?? radius * 1.15)
          && dist > (occlude.inner ?? 0);
        if (covered) value = occlude.value ?? 40;
      }
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
