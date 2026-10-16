import { afterEach, describe, expect, it } from 'vitest';
import { resetOpenCvForTests, setOpenCvForTests } from './opencvRuntime.js';
import {
  buildFlairCanonicalDialProfile,
  CANONICAL_ZERO_BAR_ANGLE_DEG,
  FLAIR_CANONICAL_DIAL_PROFILE,
  FLAIR_STATELESS_SESSION,
} from './canonicalDial.js';
import {
  MIN_DISCOVERY_RADIUS_FRACTION,
  MAX_DISCOVERY_RADIUS_FRACTION,
  REDISCOVER_EVERY_FRAMES,
  chooseDiscoveryUpdate,
  combineDialFaceScore,
  shouldBridgeNeedle,
  createGaugeTracker,
  discoverGaugeInFrame,
  discoveredVerifies,
  gaugeAllowsConfidentReading,
  REGISTRATION_PERIOD_MARGIN_MIN,
  mapCanvasDiscoveryToVideo,
  selectDiscoveryCandidate,
  matchGaugeRotation,
  registerDialRotationFromProfile,
  scoreDialFaceInterior,
  scoreDiscoveryCandidate,
  scoreRim,
} from './gaugeTrack.js';
import { grayscale, prepareEdges } from './framePrep.js';
import {
  assessFrameQuality,
  BLUR_SHARPNESS_MIN,
  GLARE_FRACTION_MAX,
  createReadingBridge,
  laplacianVariance,
} from './frameQuality.js';
import { angleToBar, wrap360, wrapDelta } from './gaugeConfig.js';
import { createAngleTracker } from './smoothPressure.js';
import { measureDialColorBands, registerDialFromColorBands } from './colorRegistration.js';
import { createRestAnchor } from './restAnchor.js';
import { HUB_CONNECTION_MIN, detectNeedleAngle, hubConnection, selectPointerEnd } from './needleFromFrame.js';
import {
  BAND_INNER_FRACTION,
  BAND_OUTER_FRACTION,
  DARK_BAND_INNER_FRACTION,
  DARK_BAND_OUTER_FRACTION,
  ESPRESSO_SECTOR,
  STOP_SECTOR,
  barToDialAngle,
} from './dialFaceTemplate.js';

function syntheticGauge(width, height, { cx, cy, radius, needleDeg = 40 }) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const d = Math.hypot(x - cx, y - cy);
      const rim = Math.abs(d - radius) < 2.5;
      const face = d < radius * 0.92;
      const v = rim ? 20 : face ? 235 : 8;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  if (needleDeg != null) {
    const rad = (needleDeg * Math.PI) / 180;
    for (let r = radius * 0.2; r < radius * 0.85; r += 0.6) {
      const x = Math.round(cx + r * Math.cos(rad));
      const y = Math.round(cy + r * Math.sin(rad));
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const o = (y * width + x) * 4;
      data[o] = 15;
      data[o + 1] = 15;
      data[o + 2] = 15;
    }
  }
  return { data, width, height };
}

/** Replay-like layout: real dial ~240,355 face r45; clutter arc left at ~190,355 r75. */
function syntheticFlairReplayFrame() {
  const width = 406;
  const height = 720;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 18;
    data[i + 1] = 18;
    data[i + 2] = 20;
    data[i + 3] = 255;
  }
  const paintDisc = (cx, cy, faceR, bezelR, { redBand = false, ticks = false } = {}) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const d = Math.hypot(x - cx, y - cy);
        const o = (y * width + x) * 4;
        if (d > bezelR + 2) continue;
        if (d >= faceR * 0.88 && d <= bezelR + 1.5) {
          data[o] = 22;
          data[o + 1] = 22;
          data[o + 2] = 24;
        } else if (d < faceR * 0.92) {
          let v = 238;
          if (redBand) {
            const deg = ((Math.atan2(y - cy, x - cx) * 180) / Math.PI + 360) % 360;
            if (deg >= 220 && deg <= 270) {
              v = 40;
              data[o] = 200;
              data[o + 1] = 35;
              data[o + 2] = 30;
              continue;
            }
          }
          data[o] = v;
          data[o + 1] = v;
          data[o + 2] = v;
        }
        if (ticks && d >= faceR * 0.94 && d <= bezelR) {
          const deg = ((Math.atan2(y - cy, x - cx) * 180) / Math.PI + 360) % 360;
          if (deg % 30 < 4) {
            data[o] = 12;
            data[o + 1] = 12;
            data[o + 2] = 12;
          }
        }
      }
    }
  };
  paintDisc(190, 355, 62, 75, { ticks: false });
  paintDisc(240, 355, 45, 55, { redBand: true, ticks: true });
  return { data, width, height };
}

function mockOpenCvForCircles(circlesInScaledSpace) {
  class Mat {
    constructor() {
      this.cols = 0;
    }
    delete() {}
    floatAt(_row, col) {
      const i = Math.floor(col / 3);
      const part = col % 3;
      const [cx, cy, r] = circlesInScaledSpace[i];
      if (part === 0) return cx;
      if (part === 1) return cy;
      return r;
    }
  }
  return {
    Mat,
    matFromImageData: () => new Mat(),
    cvtColor: () => {},
    GaussianBlur: () => {},
    HoughCircles(_gray, circles) {
      circles.cols = circlesInScaledSpace.length;
    },
    HOUGH_GRADIENT: 3,
    COLOR_RGBA2GRAY: 0,
    BORDER_DEFAULT: 0,
    Size: class Size {},
  };
}

describe('pressure CV units', () => {
  afterEach(() => {
    resetOpenCvForTests();
  });

  it('discovers via OpenCV HoughCircles when runtime is loaded', () => {
    const frame = syntheticGauge(200, 280, { cx: 140, cy: 90, radius: 42 });
    setOpenCvForTests(mockOpenCvForCircles([[140, 90, 42 * 1.02]]));
    const found = discoverGaugeInFrame(frame);
    expect(found?.ok).toBe(true);
    expect(found?.source).toBe('opencv-hough');
    expect(Math.hypot(found.cx - 140, found.cy - 90)).toBeLessThan(12);
  });

  it('discovers an off-centre gauge circle', () => {
    const frame = syntheticGauge(200, 280, { cx: 140, cy: 90, radius: 42 });
    const found = discoverGaugeInFrame(frame);
    expect(found?.ok).toBe(true);
    expect(Math.hypot(found.cx - 140, found.cy - 90)).toBeLessThan(26);
    expect(Math.abs(found.radius - 42)).toBeLessThan(22);
  });

  it('returns null on blank frames (no centre default)', () => {
    const blank = syntheticGauge(406, 720, { cx: -999, cy: -999, radius: 50, needleDeg: null });
    for (let y = 0; y < blank.height; y += 1) {
      for (let x = 0; x < blank.width; x += 1) {
        const o = (y * blank.width + x) * 4;
        blank.data[o] = 12;
        blank.data[o + 1] = 12;
        blank.data[o + 2] = 12;
      }
    }
    expect(discoverGaugeInFrame(blank)).toBeNull();
  });

  it('discovers dial below legacy 0.12 minDim floor (replay-sized ~0.11)', () => {
    const frame = syntheticGauge(406, 720, { cx: 280, cy: 400, radius: 45 });
    const found = discoverGaugeInFrame(frame);
    expect(found?.ok).toBe(true);
    expect(Math.hypot(found.cx - 280, found.cy - 400)).toBeLessThan(18);
    expect(Math.abs(found.radius - 45)).toBeLessThan(12);
  });

  it('registers dial rotation between two profiles of the same gauge', () => {
    const home = syntheticGauge(180, 180, { cx: 90, cy: 90, radius: 40, needleDeg: 50 });
    const turned = syntheticGauge(180, 180, { cx: 90, cy: 90, radius: 40, needleDeg: 80 });
    const profileOf = (frame) => {
      const edges = prepareEdges(frame, { contrastRadius: 3 }).edges;
      const profile = new Float32Array(72);
      for (let i = 0; i < 72; i += 1) {
        const ang = (i / 72) * Math.PI * 2;
        const x = Math.round(90 + 34 * Math.cos(ang));
        const y = Math.round(90 + 34 * Math.sin(ang));
        profile[i] = edges.mag[y * 180 + x];
      }
      return profile;
    };
    const ref = profileOf(home);
    const cur = profileOf(turned);
    const match = matchGaugeRotation(ref, cur, { maxShiftDeg: 60, previousDeg: 0, needleDeg: 50, alsoNeedleDeg: 80 });
    expect(match.confidence).toBeGreaterThan(0.2);
    expect(buildFlairCanonicalDialProfile().length).toBe(72);
  });

  it('maps relative needle angle to bar with stateless canonical zero', () => {
    expect(angleToBar(CANONICAL_ZERO_BAR_ANGLE_DEG, FLAIR_STATELESS_SESSION)).toBeCloseTo(0, 5);
    const five = barToDialAngle(5);
    expect(angleToBar(five, FLAIR_STATELESS_SESSION)).toBeCloseTo(5, 1);
  });

  it('reads bar from needle minus registered scale rotation (no first-frame zero)', () => {
    const dialRotationDeg = 32;
    const needleImageDeg = CANONICAL_ZERO_BAR_ANGLE_DEG + dialRotationDeg;
    const relativeNeedle = ((needleImageDeg - dialRotationDeg) % 360 + 360) % 360;
    expect(angleToBar(relativeNeedle, FLAIR_STATELESS_SESSION)).toBeCloseTo(0, 0.5);
    const halfSweep = FLAIR_STATELESS_SESSION.sweepDeg / 2;
    expect(angleToBar(wrap360(relativeNeedle + halfSweep), FLAIR_STATELESS_SESSION)).toBeCloseTo(5, 1);
  });

  it('prefers the real Flair dial over a left-side clutter arc (406×720)', () => {
    const frame = syntheticFlairReplayFrame();
    expect(scoreDialFaceInterior(frame.data, frame.width, frame.height, 240, 355, 45))
      .toBeGreaterThan(scoreDialFaceInterior(frame.data, frame.width, frame.height, 190, 355, 62));
    const found = discoverGaugeInFrame(frame);
    expect(found?.ok).toBe(true);
    expect(Math.hypot(found.cx - 240, found.cy - 355)).toBeLessThan(20);
    expect(Math.abs(found.radius - 45)).toBeLessThan(20);
  });

  it('registers a printed scale only when the arc and the ticks agree', () => {
    const bins = FLAIR_CANONICAL_DIAL_PROFILE.length;
    const shift = Math.round(100 / (360 / bins));
    const turned = new Float32Array(bins);
    for (let i = 0; i < bins; i += 1) turned[i] = FLAIR_CANONICAL_DIAL_PROFILE[(i - shift + bins) % bins];
    const reg = registerDialRotationFromProfile(turned, null, 0);
    expect(reg.ok).toBe(true);
    expect(reg.rotationDeg).toBeCloseTo(100, 0);
    const blob = new Float32Array(bins);
    for (let i = 0; i < bins; i += 1) {
      const deg = (i / bins) * 360;
      blob[i] = deg >= 180 && deg <= 260 ? 1 : 0.1;
    }
    expect(registerDialRotationFromProfile(blob, null, 0).ok).toBe(false);
  });

  it('registers dial rotation from a measured profile', () => {
    const frame = syntheticGauge(180, 180, { cx: 90, cy: 90, radius: 40, needleDeg: 50 });
    const edges = prepareEdges(frame, { contrastRadius: 3 }).edges;
    const profile = new Float32Array(72);
    for (let i = 0; i < 72; i += 1) {
      const ang = (i / 72) * Math.PI * 2;
      const x = Math.round(90 + 34 * Math.cos(ang));
      const y = Math.round(90 + 34 * Math.sin(ang));
      profile[i] = edges.mag[y * 180 + x];
    }
    const reg = registerDialRotationFromProfile(profile, 50);
    expect(reg.confidence).toBeGreaterThan(0.05);
  });

  it('flags blur and bridges short gaps', () => {
    const gray = new Float32Array(120 * 120).fill(128);
    expect(laplacianVariance(gray, 120, 120, 60, 60, 30)).toBeLessThan(5);
    const flat = new Uint8ClampedArray(120 * 120 * 4);
    for (let i = 0; i < flat.length; i += 4) {
      flat[i] = 200;
      flat[i + 1] = 200;
      flat[i + 2] = 200;
      flat[i + 3] = 255;
    }
    const quality = assessFrameQuality(flat, 120, 120, 60, 60, 30);
    expect(quality.ok).toBe(false);
    expect(quality.flags).toContain('blur');
    const bridge = createReadingBridge(200);
    const first = bridge.publish(1.2, true, 1000);
    const held = bridge.publish(null, false, 1100);
    expect(held.bridged).toBe(true);
    expect(held.value).toBe(1.2);
    expect(first.qualityOk).toBe(true);
  });

  it('rejects a confident bar when scale registration is ambiguous', () => {
    expect(gaugeAllowsConfidentReading({
      dialRegistered: true,
      confidence: 0.6,
      dialFaceScore: 0.5,
      needleLikeness: 0.7,
      periodMargin: REGISTRATION_PERIOD_MARGIN_MIN - 0.03,
    })).toBe(false);
    expect(gaugeAllowsConfidentReading({
      dialRegistered: true,
      confidence: 0.6,
      dialFaceScore: 0.5,
      needleLikeness: 0.7,
      periodMargin: REGISTRATION_PERIOD_MARGIN_MIN,
    })).toBe(true);
  });

  it('rejects confident readings when dial-face verification is weak', () => {
    expect(gaugeAllowsConfidentReading({
      dialRegistered: true,
      confidence: 0.55,
      dialFaceScore: 0.12,
      needleLikeness: 0.9,
    })).toBe(false);
    expect(gaugeAllowsConfidentReading({
      dialRegistered: true,
      confidence: 0.55,
      dialFaceScore: 0.4,
      needleLikeness: 0.35,
    })).toBe(false);
  });

  it('does not accept a tiny clutter circle as a dial discovery', () => {
    const frame = syntheticFlairReplayFrame();
    const scored = scoreDiscoveryCandidate({
      edges: prepareEdges(frame, { contrastRadius: 3 }).edges,
      data: frame.data,
      width: frame.width,
      height: frame.height,
      cx: 80,
      cy: 380,
      faceRadius: 12,
      scaledMin: Math.min(frame.width, frame.height),
    });
    expect(scored.face).toBeLessThan(0.3);
    const found = discoverGaugeInFrame(frame);
    if (found?.ok) {
      expect(found.dialFaceScore ?? 0).toBeGreaterThanOrEqual(0.3);
      expect(Math.hypot(found.cx - 240, found.cy - 355)).toBeLessThan(25);
    }
  });

  it('maps processing-canvas discovery into video pixels', () => {
    const mapped = mapCanvasDiscoveryToVideo(
      { cx: 160, cy: 244, radius: 34, ok: true, dialFaceScore: 0.4 },
      { canvasWidth: 280, canvasHeight: 497 },
      406,
      720,
    );
    expect(mapped.cx).toBeCloseTo(160 * (406 / 280), 5);
    expect(mapped.cy).toBeCloseTo(244 * (720 / 497), 5);
    expect(mapped.radius).toBeCloseTo(34 * (406 / 280), 5);
    expect(mapped.ok).toBe(true);
    const identity = mapCanvasDiscoveryToVideo(
      { cx: 232, cy: 355, radius: 51, ok: true },
      { canvasWidth: 406, canvasHeight: 720 },
      406,
      720,
    );
    expect(identity.cx).toBeCloseTo(232, 5);
    expect(identity.cy).toBeCloseTo(355, 5);
    expect(identity.radius).toBeCloseTo(51, 5);
  });

  it('does not loosen the canonical gate to accept a dominant circle', () => {
    const strong = {
      cx: 40, cy: 50, radius: 30, rank: 18, ok: false, face: 0.5, canonical: 0.2, rim: 40,
    };
    const weak = {
      cx: 90, cy: 20, radius: 12, rank: 13, ok: true, face: 0.5, canonical: 0.4, rim: 20,
    };
    expect(selectDiscoveryCandidate([weak, strong])).toBeNull();
    expect(selectDiscoveryCandidate([
      weak,
      { ...strong, rank: weak.rank + 1 },
    ])).toBeNull();
    expect(selectDiscoveryCandidate([
      { ...strong, ok: true, canonical: 0.4 },
      weak,
    ])?.cx).toBe(40);
    expect(selectDiscoveryCandidate([weak])).toEqual(expect.objectContaining({ cx: 90, ok: true }));
  });

  it('re-detects when the face fails, the pose jumps, or the interval elapses', () => {
    const dial = {
      ok: true, cx: 240, cy: 355, radius: 50, dialFaceScore: 0.5, canonicalScore: 0.4, confidence: 0.6,
    };
    const weaker = {
      ok: true, cx: 80, cy: 320, radius: 18, dialFaceScore: 0.32, canonicalScore: 0.3, confidence: 0.1,
    };
    expect(discoveredVerifies(dial)).toBe(true);
    expect(chooseDiscoveryUpdate({ hasPose: false, discovered: dial }).action).toBe('replace');
    expect(chooseDiscoveryUpdate({ hasPose: false, discovered: weaker }).action).toBe('replace');
    expect(chooseDiscoveryUpdate({ hasPose: false, discovered: null }).action).toBe('drop');
    expect(chooseDiscoveryUpdate({
      hasPose: true,
      faceScore: 0.1,
      discovered: dial,
    })).toMatchObject({ action: 'replace', reason: 'face-failed' });
    expect(chooseDiscoveryUpdate({
      hasPose: true,
      faceScore: 0.1,
      discovered: null,
    })).toMatchObject({ action: 'drop', reason: 'face-failed' });
    expect(chooseDiscoveryUpdate({
      hasPose: true,
      faceScore: 0.55,
      canonical: 0.4,
      confidence: 0.5,
      discovered: weaker,
    })).toMatchObject({ action: 'hold', reason: 'current-better' });
    expect(chooseDiscoveryUpdate({
      hasPose: true,
      faceScore: 0.32,
      canonical: 0.3,
      confidence: 0.2,
      discovered: dial,
    })).toMatchObject({ action: 'replace', reason: 'better' });
    expect(chooseDiscoveryUpdate({
      hasPose: true,
      faceScore: 0.42,
      canonical: 0.28,
      confidence: 0.48,
      pose: { cx: 237, cy: 347, radius: 56 },
      discovered: {
        ok: true, cx: 366, cy: 204, radius: 26, dialFaceScore: 0.42, canonicalScore: 0.5, confidence: 0.6,
      },
    })).toMatchObject({ action: 'hold', reason: 'current-better' });
    const farBetter = {
      ok: true, cx: 80, cy: 200, radius: 55, dialFaceScore: 0.72, canonicalScore: 0.55, confidence: 0.7,
    };
    expect(chooseDiscoveryUpdate({
      hasPose: true,
      faceScore: 0.42,
      canonical: 0.28,
      confidence: 0.48,
      pose: { cx: 237, cy: 347, radius: 56 },
      discovered: farBetter,
      printedFace: false,
    })).toMatchObject({ action: 'replace', reason: 'better-far' });
    expect(chooseDiscoveryUpdate({
      hasPose: true,
      faceScore: 0.42,
      canonical: 0.28,
      confidence: 0.48,
      pose: { cx: 237, cy: 347, radius: 56 },
      discovered: farBetter,
      printedFace: true,
    })).toMatchObject({ action: 'hold', reason: 'current-better' });

    const tracker = createGaugeTracker();
    tracker.seed({ cx: 240, cy: 355, radius: 50 });
    expect(tracker.needsRediscovery()).toBe(false);
    tracker.noteTrackedFrame({ faceScore: 0.2, poseJumpPx: 0, radius: 50 });
    expect(tracker.needsRediscovery()).toBe(true);
    tracker.seed({ cx: 240, cy: 355, radius: 50 });
    tracker.noteTrackedFrame({ faceScore: 0.6, poseJumpPx: 40, radius: 50 });
    expect(tracker.needsRediscovery()).toBe(true);
    tracker.seed({ cx: 240, cy: 355, radius: 50 });
    for (let i = 0; i < REDISCOVER_EVERY_FRAMES; i += 1) {
      tracker.noteTrackedFrame({ faceScore: 0.6, poseJumpPx: 0, radius: 50 });
    }
    expect(tracker.needsRediscovery()).toBe(true);
    tracker.reset();
    expect(tracker.getPose()).toBeNull();
    expect(tracker.needsRediscovery()).toBe(true);
  });

  it('bridges the needle on the locked frames between full reads', () => {
    const steady = {
      reusePrior: true,
      hasBridge: true,
      discovering: false,
      held: false,
      poseDeltaPx: 1,
      radius: 50,
    };
    expect(shouldBridgeNeedle({ ...steady, framesSinceDiscovery: 0 })).toBe(false);
    expect(shouldBridgeNeedle({ ...steady, framesSinceDiscovery: 1 })).toBe(true);
    expect(shouldBridgeNeedle({ ...steady, framesSinceDiscovery: 2 })).toBe(true);
    expect(shouldBridgeNeedle({ ...steady, framesSinceDiscovery: 3 })).toBe(false);
    expect(shouldBridgeNeedle({ ...steady, framesSinceDiscovery: 1, discovering: true })).toBe(false);
    expect(shouldBridgeNeedle({ ...steady, framesSinceDiscovery: 1, poseDeltaPx: 20 })).toBe(false);
    expect(shouldBridgeNeedle({ ...steady, framesSinceDiscovery: 1, hasBridge: false })).toBe(false);
  });

  it('lets tick energy carry a dark face the same way discovery does', () => {
    const dark = combineDialFaceScore(0.29, 3.2, 52, 406);
    expect(dark).toBeGreaterThanOrEqual(0.3);
    expect(dark).toBeLessThanOrEqual(0.42);
    expect(combineDialFaceScore(0, 0, 52, 406)).toBe(0);
    const small = combineDialFaceScore(0, 3.2, 12, 406);
    expect(small).toBeLessThan(dark);
  });

  it('keeps the generic discovery radius band at 3%–50% of the short side', () => {
    expect(MIN_DISCOVERY_RADIUS_FRACTION).toBeLessThanOrEqual(0.03);
    expect(MAX_DISCOVERY_RADIUS_FRACTION).toBeGreaterThanOrEqual(0.5);
    expect(MAX_DISCOVERY_RADIUS_FRACTION).toBeLessThanOrEqual(0.55);
  });

  function inPrintedSector(deg, start, end) {
    const width = wrap360(end - start);
    return wrap360(deg - start) <= width;
  }

  function syntheticPrintedDial({
    size,
    cx,
    cy,
    radius,
    rotationDeg,
    gain = 1,
    bias = 0,
    shadow = 0,
    needleBar = 0,
    needleHalfDeg = 5,
  }) {
    const data = new Uint8ClampedArray(size * size * 4);
    const pointer = wrap360(barToDialAngle(needleBar) + rotationDeg);
    const tail = wrap360(pointer + 180);
    const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.hypot(dx, dy);
        const imageDeg = wrap360((Math.atan2(dy, dx) * 180) / Math.PI);
        const dialDeg = wrap360(imageDeg - rotationDeg);
        let r = 24;
        let g = 24;
        let b = 24;
        if (dist < radius * 0.92) {
          r = 214;
          g = 214;
          b = 214;
          const rf = dist / radius;
          if (rf >= BAND_INNER_FRACTION && rf <= BAND_OUTER_FRACTION
            && inPrintedSector(dialDeg, ESPRESSO_SECTOR.startDeg, ESPRESSO_SECTOR.endDeg)) {
            r = 186;
            g = 42;
            b = 48;
          } else if (rf >= DARK_BAND_INNER_FRACTION && rf <= DARK_BAND_OUTER_FRACTION
            && inPrintedSector(dialDeg, STOP_SECTOR.startDeg, STOP_SECTOR.endDeg)) {
            r = 22;
            g = 22;
            b = 22;
          }
          const fromPointer = Math.abs(wrapDelta(pointer, imageDeg));
          const fromTail = Math.abs(wrapDelta(tail, imageDeg));
          if (fromPointer < needleHalfDeg && dist > radius * 0.14 && dist < radius * 0.84) {
            r = 12;
            g = 12;
            b = 12;
          } else if (fromTail < 6 && dist > radius * 0.14 && dist < radius * 0.34) {
            r = 16;
            g = 16;
            b = 16;
          }
        }
        const shade = 1 - shadow * (x / size);
        const o = (y * size + x) * 4;
        data[o] = clampByte(r * gain * shade + bias);
        data[o + 1] = clampByte(g * gain * shade + bias);
        data[o + 2] = clampByte(b * gain * shade + bias);
        data[o + 3] = 255;
      }
    }
    return { data, width: size, height: size };
  }

  it('registers the printed red and stop bands at several rotations and lights', () => {
    const lights = [
      { gain: 1, bias: 0, shadow: 0 },
      { gain: 0.45, bias: 10, shadow: 0 },
      { gain: 1, bias: 0, shadow: 0.5 },
    ];
    for (const rotationDeg of [0, 35, 100, 200]) {
      for (const radius of [34, 60]) {
        for (const light of lights) {
          const frame = syntheticPrintedDial({
            size: 160,
            cx: 78,
            cy: 84,
            radius,
            rotationDeg,
            ...light,
          });
          const needle = wrap360(CANONICAL_ZERO_BAR_ANGLE_DEG + rotationDeg);
          const reg = registerDialFromColorBands(measureDialColorBands(frame, 78, 84, radius, needle));
          expect(reg.ok, `rotation ${rotationDeg} r ${radius}`).toBe(true);
          expect(Math.abs(wrapDelta(reg.rotationDeg, rotationDeg))).toBeLessThanOrEqual(10);
          const relative = wrap360(needle - reg.rotationDeg);
          expect(Math.abs(angleToBar(relative, FLAIR_STATELESS_SESSION))).toBeLessThan(0.5);
        }
      }
    }
    const blank = new Uint8ClampedArray(120 * 120 * 4);
    for (let i = 0; i < blank.length; i += 4) {
      blank[i] = blank[i + 1] = blank[i + 2] = 200;
      blank[i + 3] = 255;
    }
    expect(registerDialFromColorBands(measureDialColorBands(
      { data: blank, width: 120, height: 120 },
      60,
      60,
      40,
      null,
    )).ok).toBe(false);
  });

  it('reads the measured zero and five on a dial built from the template', () => {
    for (const bar of [0, 5]) {
      const rotationDeg = 40;
      const frame = syntheticPrintedDial({
        size: 180,
        cx: 90,
        cy: 88,
        radius: 62,
        rotationDeg,
        needleBar: bar,
        needleHalfDeg: 1.6,
      });
      const needle = wrap360(barToDialAngle(bar) + rotationDeg);
      const reg = registerDialFromColorBands(measureDialColorBands(frame, 90, 88, 62, needle));
      expect(reg.ok, `bar ${bar}`).toBe(true);
      const found = detectNeedleAngle(frame, 90, 88, 62 * 0.24, 62 * 0.86);
      const relative = wrap360(found.angleDeg - reg.rotationDeg);
      const reading = angleToBar(relative, FLAIR_STATELESS_SESSION);
      const slack = bar === 0 ? 0.1 : 0.2;
      const unclamped = (wrapDelta(relative, barToDialAngle(bar)) / FLAIR_STATELESS_SESSION.sweepDeg)
        * FLAIR_STATELESS_SESSION.maxBar;
      expect(Math.abs(reading - bar), `bar ${bar} read ${reading}`).toBeLessThanOrEqual(slack);
      expect(Math.abs(unclamped), `bar ${bar} unclamped ${unclamped}`).toBeLessThanOrEqual(slack);
    }
  });

  it('picks the long pointer rather than the short tail', () => {
    const rotationDeg = 20;
    const frame = syntheticPrintedDial({
      size: 180,
      cx: 90,
      cy: 90,
      radius: 58,
      rotationDeg,
    });
    const found = detectNeedleAngle(frame, 90, 90, 58 * 0.24, 58 * 0.86);
    const pointer = wrap360(CANONICAL_ZERO_BAR_ANGLE_DEG + rotationDeg);
    expect(Math.abs(wrapDelta(found.angleDeg, pointer))).toBeLessThan(12);
    expect(found.needleEnd).toBe('long');
    const hinted = detectNeedleAngle(frame, 90, 90, 58 * 0.24, 58 * 0.86, null, pointer);
    expect(Math.abs(wrapDelta(hinted.angleDeg, pointer))).toBeLessThan(6);
    expect(hinted.needleEnd).toBe('long');
  });

  it('rejects a face streak that does not reach the pivot', () => {
    const rotationDeg = 15;
    const frame = syntheticPrintedDial({
      size: 180,
      cx: 90,
      cy: 90,
      radius: 70,
      rotationDeg,
      needleHalfDeg: 1.6,
    });
    const pointer = wrap360(barToDialAngle(0) + rotationDeg);
    const streak = wrap360(pointer + 22);
    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const dx = x - 90;
        const dy = y - 90;
        const dist = Math.hypot(dx, dy);
        const imageDeg = wrap360((Math.atan2(dy, dx) * 180) / Math.PI);
        if (Math.abs(wrapDelta(streak, imageDeg)) < 1.4 && dist > 70 * 0.36 && dist < 70 * 0.9) {
          const o = (y * frame.width + x) * 4;
          frame.data[o] = 0;
          frame.data[o + 1] = 0;
          frame.data[o + 2] = 0;
        }
      }
    }
    const raw = grayscale(frame.data, frame.width, frame.height);
    const inner = 70 * 0.24;
    expect(hubConnection(raw, frame.width, frame.height, 90, 90, streak, inner)).toBeLessThan(0.5);
    expect(hubConnection(raw, frame.width, frame.height, 90, 90, pointer, inner)).toBeGreaterThanOrEqual(0.5);
    const found = detectNeedleAngle(frame, 90, 90, inner, 70 * 0.86);
    const onStreak = Math.abs(wrapDelta(found.angleDeg, streak)) < 8;
    if (onStreak) {
      expect(found.hub).toBeLessThan(HUB_CONNECTION_MIN);
    } else {
      expect(Math.abs(wrapDelta(found.angleDeg, pointer))).toBeLessThan(8);
      expect(found.hub).toBeGreaterThanOrEqual(HUB_CONNECTION_MIN);
    }
  });

  it('does not let a pivot-missing ray drag the smoothed needle', () => {
    const tracker = createAngleTracker({ alpha: 0.45 });
    const seeded = tracker.push(47, { hub: 0.67, quality: 0.4, likeness: 0.6 });
    expect(seeded.accepted).toBe(true);
    const streak = tracker.push(62, { hub: 0.0, quality: 0.5, likeness: 0.6 });
    expect(streak.accepted).toBe(false);
    expect(streak.heldReason).toBe('hub');
    expect(streak.angle).toBe(47);
    const next = tracker.push(54, { hub: 0.67, quality: 0.4, likeness: 0.6 });
    expect(next.accepted).toBe(true);
    expect(Math.abs(wrapDelta(next.angle, 47 + 0.45 * wrapDelta(47, 54)))).toBeLessThan(0.01);
  });

  it('keeps the long end when noise past the tail outruns the tip', () => {
    const n = 32;
    const leaderSamples = new Float32Array(n);
    const leaderProbe = new Float32Array(n);
    const tailSamples = new Float32Array(n);
    const tailProbe = new Float32Array(n);
    for (let i = 0; i < 26; i += 1) {
      leaderSamples[i] = 8;
      leaderProbe[i] = i < 10 ? 6 : 2;
    }
    for (let i = 0; i < 8; i += 1) {
      tailSamples[i] = 9;
      tailProbe[i] = 5;
    }
    for (let i = 28; i < n; i += 1) {
      tailSamples[i] = 12;
      tailProbe[i] = 3;
    }
    const choice = selectPointerEnd(
      { samples: leaderSamples, probeAt: leaderProbe },
      { samples: tailSamples, probeAt: tailProbe },
    );
    expect(choice.oppositeEnd).toBeLessThan(choice.leaderEnd);
    expect(choice.takeOpposite).toBe(false);
    expect(choice.needleEnd).toBe('long');

    const flipped = selectPointerEnd(
      { samples: tailSamples, probeAt: tailProbe },
      { samples: leaderSamples, probeAt: leaderProbe },
    );
    expect(flipped.takeOpposite).toBe(true);
    expect(flipped.needleEnd).toBe('long');
  });

  it('confirms rest zero only after a still half-second on the printed zero', () => {
    const anchor = createRestAnchor();
    expect(anchor.push({ timeMs: 0, angleDeg: CANONICAL_ZERO_BAR_ANGLE_DEG, usable: true })).toBe('pending');
    expect(anchor.push({ timeMs: 200, angleDeg: CANONICAL_ZERO_BAR_ANGLE_DEG + 2, usable: true })).toBe('pending');
    expect(anchor.push({ timeMs: 500, angleDeg: CANONICAL_ZERO_BAR_ANGLE_DEG - 1, usable: true })).toBe('confirmed');
    const paced = createRestAnchor();
    for (const timeMs of [0, 133, 266, 400]) {
      expect(paced.push({ timeMs, angleDeg: CANONICAL_ZERO_BAR_ANGLE_DEG + 1, usable: true })).toBe('pending');
    }
    expect(paced.push({ timeMs: 533, angleDeg: CANONICAL_ZERO_BAR_ANGLE_DEG + 2, usable: true })).toBe('confirmed');
    const conflict = createRestAnchor();
    conflict.push({ timeMs: 0, angleDeg: 140, usable: true });
    conflict.push({ timeMs: 250, angleDeg: 142, usable: true });
    expect(conflict.push({ timeMs: 500, angleDeg: 141, usable: true })).toBe('conflict');
    const zero = CANONICAL_ZERO_BAR_ANGLE_DEG;
    expect(conflict.push({ timeMs: 800, angleDeg: zero, usable: true })).toBe('pending');
    conflict.push({ timeMs: 1000, angleDeg: zero + 1, usable: true });
    expect(conflict.push({ timeMs: 1400, angleDeg: zero - 1, usable: true })).toBe('confirmed');
    expect(gaugeAllowsConfidentReading({
      dialRegistered: true,
      confidence: 0.6,
      dialFaceScore: 0.5,
      needleLikeness: 0.7,
      periodMargin: 0.2,
      restAnchor: 'pending',
    })).toBe(false);
    expect(gaugeAllowsConfidentReading({
      dialRegistered: true,
      confidence: 0.6,
      dialFaceScore: 0.5,
      needleLikeness: 0.7,
      periodMargin: 0.2,
      restAnchor: 'conflict',
    })).toBe(false);
    expect(gaugeAllowsConfidentReading({
      dialRegistered: true,
      confidence: 0.6,
      dialFaceScore: 0.5,
      needleLikeness: 0.7,
      periodMargin: 0.2,
      restAnchor: 'confirmed',
    })).toBe(true);
  });

  it('flags a defocused face and keeps a sharp face', () => {
    const sharp = new Uint8ClampedArray(90 * 90 * 4);
    const soft = new Uint8ClampedArray(90 * 90 * 4);
    for (let y = 0; y < 90; y += 1) {
      for (let x = 0; x < 90; x += 1) {
        const o = (y * 90 + x) * 4;
        const v = ((x + y) % 2) * 255;
        sharp[o] = sharp[o + 1] = sharp[o + 2] = v;
        sharp[o + 3] = 255;
        soft[o] = soft[o + 1] = soft[o + 2] = 140;
        soft[o + 3] = 255;
      }
    }
    const sharpQ = assessFrameQuality(sharp, 90, 90, 45, 45, 30);
    const softQ = assessFrameQuality(soft, 90, 90, 45, 45, 30);
    expect(sharpQ.sharpness).toBeGreaterThan(BLUR_SHARPNESS_MIN);
    expect(sharpQ.flags).not.toContain('blur');
    expect(softQ.flags).toContain('blur');
  });

  function paintStripes(size, radius, lo, hi, smooth) {
    const data = new Uint8ClampedArray(size * size * 4);
    const cx = (size - 1) / 2;
    const cy = cx;
    const tone = (x) => {
      if (!smooth) return (x % 2) === 0 ? hi : lo;
      return lo + ((hi - lo) * x) / Math.max(1, size - 1);
    };
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const o = (y * size + x) * 4;
        const v = tone(x);
        data[o] = data[o + 1] = data[o + 2] = v;
        data[o + 3] = 255;
      }
    }
    return { data, cx, cy, radius };
  }

  it('flags blur from contrast-normalised sharpness at two sizes and two gains', () => {
    const sharpVals = [];
    for (const size of [80, 160]) {
      for (const gain of [1, 0.4]) {
        const lo = 30 * gain;
        const hi = 180 * gain;
        const crisp = paintStripes(size, size * 0.34, lo, hi, false);
        const soft = paintStripes(size, size * 0.34, lo, hi, true);
        const crispQ = assessFrameQuality(crisp.data, size, size, crisp.cx, crisp.cy, crisp.radius);
        const softQ = assessFrameQuality(soft.data, size, size, soft.cx, soft.cy, soft.radius);
        expect(crispQ.flags, `sharp ${size} g${gain}`).not.toContain('blur');
        expect(softQ.flags, `soft ${size} g${gain}`).toContain('blur');
        expect(crispQ.sharpness).toBeGreaterThan(BLUR_SHARPNESS_MIN);
        expect(softQ.sharpness).toBeLessThan(BLUR_SHARPNESS_MIN);
        sharpVals.push(crispQ.sharpness);
      }
    }
    const low = Math.min(...sharpVals);
    const high = Math.max(...sharpVals);
    expect(high / low).toBeLessThan(1.25);
  });

  it('flags a specular patch on the face and ignores a single bright pixel', () => {
    for (const radius of [36, 72]) {
      const size = radius * 3;
      const cx = size / 2;
      const cy = size / 2;
      const data = new Uint8ClampedArray(size * size * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = data[i + 1] = data[i + 2] = 70;
        data[i + 3] = 255;
      }
      const speck = assessFrameQuality(data, size, size, cx, cy, radius);
      const sx = Math.round(cx + radius * 0.2);
      const sy = Math.round(cy);
      const o = (sy * size + sx) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      const one = assessFrameQuality(data, size, size, cx, cy, radius);
      const patchR = Math.max(3, radius * 0.12);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          if (Math.hypot(x - cx, y - cy) > patchR) continue;
          const p = (y * size + x) * 4;
          data[p] = data[p + 1] = data[p + 2] = 255;
        }
      }
      const patch = assessFrameQuality(data, size, size, cx, cy, radius);
      expect(speck.flags).not.toContain('glare');
      expect(one.glare).toBeLessThanOrEqual(GLARE_FRACTION_MAX);
      expect(one.flags).not.toContain('glare');
      expect(patch.flags).toContain('glare');
      expect(patch.glare).toBeGreaterThan(GLARE_FRACTION_MAX);
    }
  });

  it('scores a circular rim', () => {
    const frame = syntheticGauge(160, 160, { cx: 80, cy: 80, radius: 36 });
    const edges = prepareEdges(frame, { contrastRadius: 3 }).edges;
    expect(scoreRim(edges, 160, 160, 80, 80, 36)).toBeGreaterThan(0.4);
    expect(scoreRim(edges, 160, 160, 20, 20, 36)).toBeLessThan(0.2);
  });
});
