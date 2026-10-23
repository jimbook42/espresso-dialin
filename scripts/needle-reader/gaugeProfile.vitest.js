import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  angleToValue,
  buildFlair58Profile,
  fitAnchorsFromLabels,
  parseGaugeProfile,
} from '../../src/flairPressureLab/gaugeProfile.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LABELS = path.join(ROOT, 'scripts/pressure-label/fixtures/labels-2026-10-22.json');
const PROFILE_PATH = path.join(ROOT, 'profiles/flair58-v1.json');

function labels() {
  const raw = JSON.parse(readFileSync(LABELS, 'utf8'));
  return Object.values(raw.frames);
}

describe('flair58 gauge profile', () => {
  const fit = fitAnchorsFromLabels(labels());
  const profile = parseGaugeProfile(JSON.parse(readFileSync(PROFILE_PATH, 'utf8')));

  it('fits 0 bar to the rest needle and reports leave-one-clip-out spread', () => {
    expect(fit.pinOffsetDeg).toBeCloseTo(5.802, 2);
    expect(fit.anchor5Deg).toBeCloseTo(74.061, 2);
    expect(fit.anchor10Deg).toBeCloseTo(161.757, 2);
    expect(fit.n).toBe(34);
    expect(fit.nRest).toBe(10);
    expect(fit.spread.pinOffsetDeg.spread).toBeLessThan(0.5);
    expect(fit.spread.anchor5Deg.spread).toBeLessThan(1);
    expect(fit.spread.anchor10Deg.spread).toBeLessThan(2);
    expect(fit.leaveOneClipOut).toHaveLength(10);
  });

  it('stores that fit and keeps needle geometry configurable', () => {
    expect(profile.id).toBe('flair58-v1');
    expect(profile.scale.anchors.map((anchor) => anchor.value)).toEqual([0, 5, 10]);
    expect(profile.scale.anchors[1].deg).toBeCloseTo(fit.anchor5Deg, 3);
    expect(profile.scale.anchors[2].deg).toBeCloseTo(fit.anchor10Deg, 3);
    expect(profile.rest.pinOffsetDeg).toBeCloseTo(fit.pinOffsetDeg, 3);
    expect(profile.needle).toMatchObject({
      width: expect.any(Number),
      length: expect.any(Number),
      tailRatio: expect.any(Number),
      shade: expect.any(Number),
      softness: expect.any(Number),
      hub: expect.any(Number),
    });
    expect(profile.rectify.mode).toBe('cartesian');
    expect(JSON.parse(JSON.stringify(buildFlair58Profile(fit))).scale.anchors).toEqual(profile.scale.anchors);
  });

  it('maps crop angle to bar and rejects a profile that hard-codes the needle', () => {
    expect(angleToValue(0, profile)).toBe(0);
    expect(angleToValue(profile.scale.anchors[1].deg, profile)).toBe(5);
    expect(angleToValue(profile.scale.anchors[2].deg, profile)).toBe(10);
    const mid = profile.scale.anchors[1].deg / 2;
    expect(angleToValue(mid, profile)).toBeCloseTo(2.5, 5);
    expect(angleToValue(-4, profile)).toBe(0);
    expect(angleToValue(200, profile)).toBe(10);
    const broken = structuredClone(profile);
    delete broken.needle.softness;
    expect(() => parseGaugeProfile(broken)).toThrow(/softness/);
  });

  it('agrees with the Python loader', () => {
    const probe = spawnSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'scripts/needle-reader'))})
from gauge_profile import load_gauge_profile, angle_to_value
profile = load_gauge_profile(${JSON.stringify(PROFILE_PATH)})
deg = profile["scale"]["anchors"][1]["deg"] / 2
print(json.dumps({"mid": angle_to_value(deg, profile), "ten": angle_to_value(profile["scale"]["anchors"][2]["deg"], profile)}))
`], { encoding: 'utf8' });
    expect(probe.status).toBe(0);
    const got = JSON.parse(probe.stdout);
    expect(got.ten).toBe(10);
    expect(got.mid).toBeCloseTo(2.5, 5);
  });
});
