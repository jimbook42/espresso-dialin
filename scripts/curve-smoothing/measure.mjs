import { readFileSync, writeFileSync } from 'node:fs';
import { EXAM_IDS } from '../needle-reader/examLive.mjs';
import { quantile } from '../needle-reader/metrics.mjs';
import { rollingDisplayBar as oldDisplay, pressureChartPointsForSavedCurve as oldSaved } from '../needle-reader/out/baseline-display.mjs';
import { createPressureCurveFilter } from '../../src/flairPressureLab/pressureCurveFilter.js';
import { pressureChartPointsForDisplay, pressureChartPointsForSavedCurve } from '../../src/flairPressureLab/pressureDisplaySmoothing.js';

// Observational analysis of single, saved exam runs; no reader/scoring changes.
const out = new URL('../needle-reader/out/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, out)));
const baseline = read('curve-baseline-observed.json');
const candidate = read('exam-observed.json');
const med = a => a.length ? quantile(a, .5) : null;
const rms = a => a.length ? Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length) : null;
function displays(series, old = false) {
  const filter = createPressureCurveFilter();
  const samples = [];
  let last = null;
  return series.frames.map(f => {
    const o = f.output;
    if (o.fresh) samples.push({ tS: f.timeS, bar: o.bar });
    if (old) return o.held ? o.bar : o.fresh ? oldDisplay(samples, f.timeS) : null;
    if (o.fresh) last = filter.step(o.bar, o.measuredAtMs, f.read.needleTrackingReset === true);
    else { filter.reset(); if (!o.held) last = null; }
    if ('displayBar' in o && o.displayBar !== last) throw new Error('Publisher display differs from analysis');
    return last;
  });
}
function masks(frames) {
  return frames.map((f, i) => {
    // Fixed baseline eligibility, not chosen from smoothed output. The full
    // nine-frame window must be fresh, change <=.35 bar end-to-end, range <=.75.
    const w = frames.slice(i - 4, i + 5);
    return i >= 4 && w.length === 9 && w.every(x => x.output.fresh)
      && Math.abs(w.at(-1).output.bar - w[0].output.bar) <= .35
      && Math.max(...w.map(x => x.output.bar)) - Math.min(...w.map(x => x.output.bar)) <= .75;
  });
}
function wobble(values, frames, mask) {
  const deltas = [], second = [];
  let reversals = 0;
  for (let i = 1; i < frames.length; i++) {
    if (!mask[i] || !mask[i - 1] || !frames[i].output.fresh || !frames[i - 1].output.fresh) continue;
    const d = values[i] - values[i - 1];
    deltas.push(Math.abs(d));
    if (i > 1 && mask[i - 2] && frames[i - 2].output.fresh) {
      const p = values[i - 1] - values[i - 2];
      if (p * d < 0 && Math.abs(p) > .1 && Math.abs(d) > .1) reversals++;
      second.push(d - p);
    }
  }
  return { n: deltas.length, medianAbsDelta: med(deltas), reversals, secondRms: rms(second), deltas, second };
}
function lag(frames, values) {
  const checks = [];
  let start = 0;
  const finish = end => {
    if (end - start < 2 || frames[end].output.bar - frames[start].output.bar < .5) return;
    for (const fraction of [.25, .5, .75]) {
      const threshold = frames[start].output.bar + fraction * (frames[end].output.bar - frames[start].output.bar);
      const raw = frames.findIndex((f, i) => i >= start && i <= end && f.output.bar >= threshold);
      const shown = frames.findIndex((f, i) => i >= start && i <= end + 1 && f.output.fresh && values[i] >= threshold);
      if (raw >= 0 && shown >= 0) checks.push({ startS: frames[start].timeS, threshold, lagMs: (frames[shown].timeS - frames[raw].timeS) * 1000 });
    }
  };
  for (let i = 1; i < frames.length; i++) {
    if (!frames[i].output.fresh || !frames[i - 1].output.fresh || frames[i].output.bar < frames[i - 1].output.bar) {
      finish(i - 1); start = i;
    }
  }
  finish(frames.length - 1);
  return { n: checks.length, medianMs: med(checks.map(c => c.lagMs)), maxMs: checks.length ? Math.max(...checks.map(c => c.lagMs)) : null, checks };
}
const aggregate = Object.fromEntries(['raw', 'filtered', 'oldDisplay'].map(k => [k, { deltas: [], second: [], reversals: 0 }]));
const clips = baseline.map((s, i) => {
  const after = candidate[i];
  if (s.frames.length !== after.frames.length) throw new Error('Frame count changed');
  for (let j = 0; j < s.frames.length; j++) {
    const a = s.frames[j].output, b = after.frames[j].output;
    if (['bar','fresh','held','reason','measuredAtMs'].some(k => a[k] !== b[k])) throw new Error('Raw publication changed');
  }
  const frames = s.frames, mask = masks(frames), raw = frames.map(f => f.output.bar);
  const old = displays(s, true), filtered = displays(after);
  for (const [key, values] of Object.entries({raw, filtered, oldDisplay: old})) {
    const w = wobble(values, frames, mask);
    aggregate[key].deltas.push(...w.deltas);
    aggregate[key].second.push(...w.second);
    aggregate[key].reversals += w.reversals;
  }
  const fresh = frames.filter(f => f.output.fresh).map(f => ({ tS: f.timeS, bar: f.output.bar }));
  const oldHistory = oldSaved(fresh), newHistory = pressureChartPointsForSavedCurve(fresh);
  // Align by sample index; smoothing comparisons never shift times.
  const align = points => { let j = 0; return frames.map(f => f.output.fresh ? points[j++].bar : null); };
  const all = frames.map(f => f.output.fresh);
  const cause = { freshTriples: 0, trackedTriples: 0, trackedSecondSq: 0, independentTriples: 0, independentSecondSq: 0,
    heldToFresh: 0, heldToFreshAbsDelta: [] };
  for (let j = 1; j < frames.length; j++) {
    if (frames[j - 1].output.held && frames[j].output.fresh) {
      cause.heldToFresh++; cause.heldToFreshAbsDelta.push(Math.abs(raw[j] - raw[j - 1]));
    }
    if (j < 2 || !frames.slice(j - 2, j + 1).every(f => f.output.fresh)) continue;
    cause.freshTriples++;
    const tracked = frames.slice(j - 2, j + 1).some(f => /track/.test(f.read.pointerSource ?? ''));
    const key = tracked ? 'tracked' : 'independent';
    cause[key + 'Triples']++;
    cause[key + 'SecondSq'] += (raw[j] - 2 * raw[j - 1] + raw[j - 2]) ** 2;
  }
  const shrink = m => { const { deltas, second, ...summary } = m; return summary; };
  return { clip: EXAM_IDS[i] ?? ['20261024_124006-hand', '20261025_130022-hand'][i - 10],
    raw: shrink(wobble(raw, frames, mask)), filtered: shrink(wobble(filtered, frames, mask)),
    oldDisplay: shrink(wobble(old, frames, mask)),
    oldHistory: shrink(wobble(align(oldHistory), frames, mask)), newHistory: shrink(wobble(align(newHistory), frames, mask)),
    allFreshRaw: shrink(wobble(raw, frames, all)), allFreshFiltered: shrink(wobble(filtered, frames, all)),
    lag: lag(frames, filtered), cause };
});
const totals = Object.fromEntries(Object.entries(aggregate).map(([k, w]) => [k, {
  n: w.deltas.length, medianAbsDelta: med(w.deltas), secondRms: rms(w.second), reversals: w.reversals,
}]));

// Use the frozen evaluator's coordinate/truth results, without changing its
// labels or scoring. This separate table evaluates the actual display output.
const batchReport = JSON.parse(readFileSync(new URL('../../docs/label-analysis-2026-11-02.json', import.meta.url)));
const extraBefore = read('curve-baseline-batch.json'), extraAfter = read('batch-replayed.json');
const named = (exam, extra) => [...exam.slice(0, 10).map((s, i) => ({...s, clip:EXAM_IDS[i]})), ...extra];
const beforeSeries = named(baseline, extraBefore), afterSeries = named(candidate, extraAfter);
let checkedRawFrames = 0, checkedChartFrames = 0, checkedDisplayFrames = 0;
for (const [i, series] of afterSeries.entries()) {
  const before = beforeSeries[i];
  if (series.clip !== before.clip || series.frames.length !== before.frames.length
    || JSON.stringify(series.calibration) !== JSON.stringify(before.calibration)) throw new Error('Replay/calibration changed');
  const shown = displays(series);
  const samples = series.frames.filter(f => f.output.fresh).map(f => ({
    tS: f.timeS, bar: f.output.bar, reset: f.read.needleTrackingReset === true,
  }));
  const chart = pressureChartPointsForDisplay(samples);
  // The persisted curve contains only tS/bar; verify that missing-fresh
  // timestamps preserve the same boundaries without in-memory reset metadata.
  const saved = pressureChartPointsForSavedCurve(samples.map(({tS, bar}) => ({tS, bar})));
  let freshIndex = 0;
  for (let j = 0; j < series.frames.length; j++) {
    const frame = series.frames[j], previous = before.frames[j];
    if (frame.timeS !== previous.timeS || ['bar','fresh','held','reason','measuredAtMs'].some(k => frame.output[k] !== previous.output[k])) throw new Error('Raw batch publication changed');
    checkedRawFrames++;
    if (!('displayBar' in frame.output)) throw new Error('Missing observed displayBar; use the observational preloaders');
    checkedDisplayFrames++;
    frame.analysisDisplay = shown[j];
    if (frame.output.fresh) {
      if (Math.abs(chart[freshIndex].bar - shown[j]) > 1e-12
        || saved[freshIndex].bar !== chart[freshIndex].bar) throw new Error('Live/History filter mismatch');
      freshIndex++; checkedChartFrames++;
    }
  }
  const oldShown = displays(before, true);
  before.frames.forEach((f, j) => { f.analysisDisplay = oldShown[j]; });
}
const errors = rows => {
  const e = rows.filter(r => r != null).map(Math.abs);
  return { n: e.length, median: med(e), overOne: e.filter(v => v > 1).length, worst: e.length ? Math.max(...e) : null };
};
const batchRows = batchReport.rows.filter(r => !r.repeatOf).map(row => {
  const snap = all => {
    const s = all.find(s => s.clip === row.clip);
    const f = s.frames.reduce((best, f) => !best || Math.abs(f.timeS-row.t) < Math.abs(best.timeS-row.t) ? f : best, null);
    if (Math.abs(f.timeS-row.t) > .08) throw new Error('No nearby label frame');
    return f;
  };
  const before = snap(beforeSeries), after = snap(afterSeries);
  const error = f => f.analysisDisplay == null ? null : f.analysisDisplay-row.labelBar;
  return { id:row.id, clip:row.clip, timeS:row.t, truth:row.labelBar,
    rawError:row.error, beforeDisplay:before.analysisDisplay, afterDisplay:after.analysisDisplay,
    beforeError:error(before), afterError:error(after) };
});
const batchDisplay = { raw:errors(batchRows.map(r => r.rawError)), before:errors(batchRows.map(r => r.beforeError)),
  after:errors(batchRows.map(r => r.afterError)), rows:batchRows };
const result = { methodology: 'Fixed baseline 9-fresh-frame steady windows: endpoint delta <=0.35 bar, range <=0.75; adjacent eligible fresh frames only. Reversal: consecutive opposite deltas both >0.1 bar. Lag: 25/50/75% crossings of every monotonic fresh rise >=0.5 bar, 8Hz timing; never bridge gaps.',
  checkedRawFrames, checkedDisplayFrames, checkedChartFrames, batchDisplay, totals, clips };
writeFileSync(new URL('curve-metrics.json', out), JSON.stringify(result, null, 2));
console.log(JSON.stringify(clips.map(({clip, raw, filtered, oldDisplay, lag}) => ({clip, raw, filtered, oldDisplay, lag: {n:lag.n,medianMs:lag.medianMs,maxMs:lag.maxMs}})), null, 2));
