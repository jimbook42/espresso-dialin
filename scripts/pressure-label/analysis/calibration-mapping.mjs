/** Read-only anchor diagnosis. Run after the unchanged exam and batch analysis.
 * No replay, calibration, label or scoring inputs are modified.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXAM_IDS, CLIPS_DIR } from '../../needle-reader/examLive.mjs';
import { barFromTapAnchors, pointAngle, pointDist } from '../../../src/flairPressureLab/tapCalibrate.js';
import { inverseDialAngle } from '../../../src/flairPressureLab/dialRegistration.js';
import { wrapDelta } from '../../../src/flairPressureLab/gaugeConfig.js';

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const observed = read('../../needle-reader/out/exam-observed.json');
const labels = read('../fixtures/batch-2026-11-02/labels-orig.json').frames;
const analysis = read('../../../docs/label-analysis-2026-11-02.json');
const point = a => ({ x: a[0], y: a[1] });
const clips = ['20261018_094055', '20261017_134943'];
const result = clips.map(clip => {
  const series = observed[EXAM_IDS.indexOf(clip)], cal = series.calibration;
  const sidecar = JSON.parse(readFileSync(path.join(CLIPS_DIR, clip + '.json'))).tapCalibration;
  for (const [saved, applied] of [['centre', 'hub'], ['five', 'five'], ['ten', 'ten']]) {
    if (pointDist(sidecar.anchors[saved], cal[applied]) > 1e-9) {
      throw new Error(`${clip}: calibration changed stored ${saved}; investigate before interpreting residuals`);
    }
  }
  const project = (p, r) => {
    const m = r.poseMatrix ?? [1, 0, 0, 1];
    const scale = r.radius / cal.radius / Math.sqrt(m[0] * m[3] - m[1] * m[2]);
    const x = p.x - cal.hub.x, y = p.y - cal.hub.y;
    return { x: r.hub.x + scale * (m[0] * x + m[1] * y),
      y: r.hub.y + scale * (m[2] * x + m[3] * y) };
  };
  const rows = Object.entries(labels).filter(([id, l]) => l.clip === clip && (clip.endsWith('094055') || id === 'b013')).map(([id, l]) => {
    const frame = series.frames.reduce((a, b) => Math.abs(a.timeS - l.t) <= Math.abs(b.timeS - l.t) ? a : b);
    if (Math.abs(frame.timeS - l.t) > .08) throw new Error(`No nearby sample for ${id}`);
    const r = frame.read, hand = Object.fromEntries(Object.entries(l.orig).map(([k, v]) => [k, point(v)]));
    const projected = { hub: r.hub, five: project(cal.five, r), ten: project(cal.ten, r) };
    for (const k of ['five', 'ten']) {
      if (Math.abs(wrapDelta(r[k + 'Deg'], pointAngle(projected.hub, projected[k]))) > 1e-7) {
        throw new Error(`${id}: reconstructed ${k} ray differs from reader transform`);
      }
    }
    const ha = p => pointAngle(hand.hub, p);
    // Above five these counterfactuals need no zero. Below five use the report's
    // leave-one-clip-out rest convention, never a fitted zero.
    const offset = analysis.clipZero.find(z => z.clip === clip)?.locoRestOffsetDeg;
    const map = (hub, five, ten) => barFromTapAnchors(pointAngle(hub, hand.tip),
      offset == null ? null : (pointAngle(hub, hand.zero) + offset + 360) % 360,
      pointAngle(hub, five), pointAngle(hub, ten));
    const truth = map(hand.hub, hand.five, hand.ten);
    const isolated = p => p == null || truth == null ? null : p - truth;
    return { id, labelTimeS: l.t, sampleTimeS: frame.timeS, lost: r.lost,
      state: frame.output.bar == null ? 'gap' : frame.output.held ? 'held' : 'fresh',
      bar: frame.output.bar, matrix: r.poseMatrix, registration: r.registration,
      hand, projected,
      anchors: Object.fromEntries(['hub', 'five', 'ten'].map(k => [k, {
        px: pointDist(projected[k], hand[k]),
        // A hub has no intrinsic direction: report its induced needle-ray error.
        degrees: k === 'hub' ? wrapDelta(ha(hand.tip), pointAngle(projected.hub, hand.tip))
          : wrapDelta(ha(hand[k]), ha(projected[k])),
        rayDegrees: k === 'hub' ? null : wrapDelta(ha(hand[k]), pointAngle(projected.hub, projected[k])),
      }])),
      truth, isolatedBarError: {
        hub: isolated(map(projected.hub, hand.five, hand.ten)),
        five: isolated(map(hand.hub, projected.five, hand.ten)),
        ten: isolated(map(hand.hub, hand.five, projected.ten)),
      },
      labelledTipInReaderScale: barFromTapAnchors(
        inverseDialAngle(pointAngle(r.hub, hand.tip), r.poseMatrix),
        cal.zeroAngleDeg, cal.fiveAngleDeg, cal.tenAngleDeg),
      currentFrameAngularMapping: barFromTapAnchors(pointAngle(r.hub, hand.tip),
        r.zeroDeg, r.fiveDeg, r.tenDeg),
      // Test the implementation against explicit inverse-vector geometry.
      referenceNeedle: inverseDialAngle(r.needleDeg, r.poseMatrix),
      readerZeroMinusHandPin: wrapDelta(ha(hand.zero), r.zeroDeg),
    };
  });
  const nearCalibration = Object.entries(labels).filter(([, l]) => l.clip === clip)
    .sort((a, b) => Math.abs(a[1].t - sidecar.atSec) - Math.abs(b[1].t - sidecar.atSec))[0];
  const [id, l] = nearCalibration;
  const hp = Object.fromEntries(Object.entries(l.orig).map(([k, v]) => [k, point(v)]));
  const comparable = Math.abs(l.t - sidecar.atSec) <= .08;
  const initialResiduals = !comparable ? null : Object.fromEntries(['hub', 'five', 'ten'].map(k => {
    const stored = sidecar.anchors[k === 'hub' ? 'centre' : k];
    return [k, { px: pointDist(stored, hp[k]),
      degrees: k === 'hub' ? wrapDelta(pointAngle(hp.hub, hp.tip), pointAngle(stored, hp.tip))
        : wrapDelta(pointAngle(hp.hub, hp[k]), pointAngle(sidecar.anchors.centre, stored)) }];
  }));
  const poseSamples = (clip.endsWith('094055') ? [sidecar.atSec, 19, 22, 40] : [sidecar.atSec, 48.5]).map(t => {
    const f = series.frames.reduce((a, b) => Math.abs(a.timeS - t) <= Math.abs(b.timeS - t) ? a : b);
    return { timeS: f.timeS, hub: f.read.hub, radius: f.read.radius,
      matrix: f.read.poseMatrix, lost: f.read.lost, registration: f.read.registration };
  });
  return { clip, atSec: sidecar.atSec, stored: sidecar.anchors, calibration: cal,
    nearCalibration: { id, labelTimeS: l.t, timeDifferenceS: l.t - sidecar.atSec, comparable, initialResiduals }, poseSamples, rows };
});
writeFileSync(new URL('../../needle-reader/out/calibration-mapping.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
