import { describe, expect, it } from 'vitest';
import { buildFlairCanonicalDialProfile } from './canonicalDial.js';
import { discoverGaugeInFrame, matchGaugeRotation, scoreRim } from './gaugeTrack.js';
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

describe('pressure CV units', () => {
  it('discovers an off-centre gauge circle', () => {
    const frame = syntheticGauge(200, 280, { cx: 140, cy: 90, radius: 42 });
    const found = discoverGaugeInFrame(frame);
    expect(found?.ok).toBe(true);
    expect(Math.hypot(found.cx - 140, found.cy - 90)).toBeLessThan(15);
    expect(Math.abs(found.radius - 42)).toBeLessThan(10);
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

  it('maps relative needle angle to bar after rest calibration', () => {
    const session = { zeroAngleDeg: 40, sweepDeg: 270, minBar: 0, maxBar: 12, clockwise: true };
    expect(angleToBar(40, session)).toBeCloseTo(0, 5);
    expect(angleToBar(40 + 45, session)).toBeCloseTo(2, 0.5);
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

  it('scores a circular rim', () => {
    const frame = syntheticGauge(160, 160, { cx: 80, cy: 80, radius: 36 });
    const edges = prepareEdges(frame, { contrastRadius: 3 }).edges;
    expect(scoreRim(edges, 160, 160, 80, 80, 36)).toBeGreaterThan(0.4);
    expect(scoreRim(edges, 160, 160, 20, 20, 36)).toBeLessThan(0.2);
  });
});
