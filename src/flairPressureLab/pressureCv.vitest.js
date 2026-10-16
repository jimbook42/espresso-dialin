import { afterEach, describe, expect, it } from 'vitest';
import { resetOpenCvForTests, setOpenCvForTests } from './opencvRuntime.js';
import { buildFlairCanonicalDialProfile } from './canonicalDial.js';
import {
  CANONICAL_ZERO_BAR_ANGLE_DEG,
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
import { prepareEdges } from './framePrep.js';
import { assessFrameQuality, createReadingBridge, laplacianVariance } from './frameQuality.js';
import { angleToBar } from './gaugeConfig.js';

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
    expect(angleToBar(CANONICAL_ZERO_BAR_ANGLE_DEG + 45, FLAIR_STATELESS_SESSION)).toBeCloseTo(2, 0.5);
  });

  it('reads bar from needle minus registered scale rotation (no first-frame zero)', () => {
    const dialRotationDeg = 32;
    const needleImageDeg = CANONICAL_ZERO_BAR_ANGLE_DEG + dialRotationDeg;
    const relativeNeedle = ((needleImageDeg - dialRotationDeg) % 360 + 360) % 360;
    expect(angleToBar(relativeNeedle, FLAIR_STATELESS_SESSION)).toBeCloseTo(0, 0.5);
    expect(angleToBar(relativeNeedle + 90, FLAIR_STATELESS_SESSION)).toBeCloseTo(4, 0.5);
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

  it('scores a circular rim', () => {
    const frame = syntheticGauge(160, 160, { cx: 80, cy: 80, radius: 36 });
    const edges = prepareEdges(frame, { contrastRadius: 3 }).edges;
    expect(scoreRim(edges, 160, 160, 80, 80, 36)).toBeGreaterThan(0.4);
    expect(scoreRim(edges, 160, 160, 20, 20, 36)).toBeLessThan(0.2);
  });
});
