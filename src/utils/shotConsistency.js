import { PRESSURE_CURVE_GAP_MS } from '../flairPressureLab/pressureCurveFilter.js';
import { SCALE_FLOW_MAX_SAMPLE_GAP_S } from '../scales/flowMetrics.js';
import { buildComparisonProfile, savedShotMeasurements } from './shotProfile.js';
import { shotTasteRating } from './shotRatings.js';

export const CONSISTENCY_MIN_SHOTS = 3;
export const RATING_COMPARISON_MIN_SHOTS = 5;
export const SHOT_CONSISTENCY_METRICS = [
  { key: 'durationS', label: 'Extraction time', unit: 's', digits: 1 },
  { key: 'doseG', label: 'Dose', unit: 'g', digits: 1 },
  { key: 'yieldG', label: 'Yield', unit: 'g', digits: 1 },
  { key: 'ratio', label: 'Brew ratio', unit: '', digits: 2 },
  { key: 'pressure', label: 'Peak extraction pressure', unit: 'bar', digits: 1, sensor: true },
  { key: 'flow', label: 'Average extraction flow', unit: 'g/s', digits: 2, sensor: true },
];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function extractionSamples(points, duration, tolerance) {
  const withinExtraction = points.filter(({ tS }) => tS >= 0 && tS <= duration);
  if (withinExtraction.length < 3 || withinExtraction[0].tS > tolerance
    || duration - withinExtraction.at(-1).tS > tolerance
    || withinExtraction.slice(1).some(({ breakBefore }) => breakBefore)) return [];
  return withinExtraction;
}

function sensorMeasurements(shot) {
  const timing = shot.shotProfileTiming;
  const mayUsePressure = timing?.pressureSource === 'camera';
  const mayUseFlow = timing?.scaleSource === 'web-bluetooth' && timing.scaleInterrupted === false;
  const duration = (timing?.extractionEndMs - timing?.extractionStartMs) / 1000;
  if ((!mayUsePressure && !mayUseFlow) || timing?.version !== 1 || !Number.isFinite(duration) || duration <= 0
    || !Number.isFinite(timing.extractionStartMs) || !Number.isFinite(timing.extractionEndMs)
    || !Number.isFinite(timing.clockDriftMs) || Math.abs(timing.clockDriftMs) > 250) return {};

  const profile = buildComparisonProfile(shot);
  const values = {};
  if (mayUsePressure) {
    const pressure = extractionSamples(profile.pressure, duration, PRESSURE_CURVE_GAP_MS / 1000);
    if (pressure.length) values.pressure = pressure.reduce((max, { bar }) => Math.max(max, bar), 0);
  }
  if (mayUseFlow && Number.isFinite(timing.scaleOriginMs)) {
    const weight = extractionSamples(profile.weight, duration, SCALE_FLOW_MAX_SAMPLE_GAP_S);
    if (weight.length) {
      const first = weight[0];
      const last = weight.at(-1);
      const flow = (last.weightG - first.weightG) / (last.tS - first.tS);
      if (Number.isFinite(flow) && flow >= 0) values.flow = flow;
    }
  }
  return values;
}

export function summarizeShotConsistency(shots) {
  const entries = shots.map((shot) => {
    const measurements = savedShotMeasurements(shot);
    // A zero time or yield is ambiguous in older CSV imports, which turn blank cells into zero.
    const values = { ...measurements, ...sensorMeasurements(shot) };
    if (!(values.durationS > 0)) values.durationS = null;
    if (!(values.yieldG > 0)) {
      values.yieldG = null;
      values.ratio = null;
    }
    return { rating: shotTasteRating(shot), timestamp: Date.parse(shot.timestamp), values, shot };
  });
  const rated = entries.filter(({ rating }) => rating !== null);
  const distribution = [1, 2, 3, 4, 5].map((stars) => rated.filter(({ rating }) => rating === stars).length);
  const recent = rated.filter(({ timestamp }) => Number.isFinite(timestamp))
    .sort((a, b) => a.timestamp - b.timestamp).slice(-5)
    .map(({ rating, timestamp }) => ({ rating, timestamp }));

  const metrics = SHOT_CONSISTENCY_METRICS.map((metric) => {
    const comparable = entries.filter(({ values }) => Number.isFinite(values[metric.key]));
    const count = comparable.length;
    const recorded = metric.sensor
      ? entries.filter(({ shot }) => (metric.key === 'pressure' ? shot.labPressureCurve : shot.scaleFlowCurve)?.length).length
      : count;
    const values = comparable.map((entry) => entry.values[metric.key]);
    let stats = null;
    if (count >= CONSISTENCY_MIN_SHOTS) {
      const center = median(values);
      const min = values.reduce((a, b) => Math.min(a, b));
      const max = values.reduce((a, b) => Math.max(a, b));
      stats = { median: center, min, max, variation: median(values.map((value) => Math.abs(value - center))) };
    }

    const pairs = comparable.filter(({ rating }) => rating !== null);
    let groups = [];
    if (pairs.length >= RATING_COMPARISON_MIN_SHOTS && new Set(pairs.map(({ rating }) => rating)).size > 1) {
      groups = distribution.flatMap((_, index) => {
        const stars = index + 1;
        const group = pairs.filter(({ rating }) => rating === stars).map((entry) => entry.values[metric.key]);
        return group.length ? [{ stars, count: group.length, median: median(group) }] : [];
      });
    }
    return { ...metric, count, missing: shots.length - recorded, unsupported: recorded - count, stats, groups };
  });

  return { total: shots.length, ratedCount: rated.length, distribution, recent, metrics };
}
