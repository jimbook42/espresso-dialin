import { isStandalonePressureShot } from '../flairPressureLab/standalonePressureShot.js';
import { PRESSURE_CURVE_GAP_MS } from '../flairPressureLab/pressureCurveFilter.js';
import { labPressureCurvePlotTimeS, pressureChartPointsForDisplay } from '../flairPressureLab/pressureDisplaySmoothing.js';
import { flowRateSeriesFromWeightCurve, SCALE_FLOW_MAX_SAMPLE_GAP_S } from '../scales/flowMetrics.js';

const PRESSURE_GAP_S = PRESSURE_CURVE_GAP_MS / 1000;
const INTERRUPTED_PRESSURE_S = 1;
const MAX_CLOCK_DRIFT_MS = 250;

export function savedShotMeasurements(shot) {
  const { actualTimeS, actualDoseG, actualYieldG } = shot;
  const durationS = Number.isFinite(actualTimeS) && actualTimeS >= 0 ? actualTimeS : null;
  const doseG = Number.isFinite(actualDoseG) && actualDoseG > 0 ? actualDoseG : null;
  const unobservedYield = shot.shotProfileTiming?.version === 1
    && shot.shotProfileTiming.yieldSource === 'unobserved-scale';
  const yieldG = !unobservedYield && Number.isFinite(actualYieldG) && actualYieldG >= 0 ? actualYieldG : null;
  const ratio = doseG != null && yieldG != null ? yieldG / doseG : null;
  return { durationS, doseG, yieldG, ratio: Number.isFinite(ratio) ? ratio : null };
}

function readCurve(curve, key, validValue, maxGapS) {
  const points = [];
  let broken = false;
  for (const sample of Array.isArray(curve) ? curve : []) {
    const tS = sample?.tS;
    const previous = points.at(-1);
    if (!Number.isFinite(tS) || tS < 0 || !validValue(sample[key]) || sample.confident === false
      || (previous && tS <= previous.tS)) {
      broken = true;
      continue;
    }
    const breakBefore = Boolean(previous && (broken || tS - previous.tS > maxGapS));
    points.push({ tS, [key]: sample[key], breakBefore });
    broken = false;
  }
  return points;
}

function legacyPreInfusionS(shot) {
  if (isStandalonePressureShot(shot) || typeof shot.notes !== 'string') return null;
  // Only the prefix historically emitted by the save form.
  const match = /^Pre-infusion: (\d+(?:\.\d+)?)s\.(?: |$)/.exec(shot.notes);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : null;
}

function shift(points, shiftTime) {
  return points.map((point) => ({ ...point, tS: shiftTime(point.tS) }));
}

function scaleFlow(weights, startS, endS) {
  const runs = [];
  let seconds = 0;
  let grams = 0;
  let run = [];
  for (const point of weights) {
    if (point.tS < startS || point.tS > endS) continue;
    const previous = point.breakBefore ? null : run.at(-1);
    const change = point.weightG - previous?.weightG;
    if (!previous || !Number.isFinite(change / (point.tS - previous.tS))) {
      run = [point];
      runs.push(run);
      continue;
    }
    seconds += point.tS - previous.tS;
    grams += change;
    run.push(point);
  }
  const points = runs.flatMap((segment) => flowRateSeriesFromWeightCurve(segment, undefined, SCALE_FLOW_MAX_SAMPLE_GAP_S)
    .map((point, index) => ({ ...point, breakBefore: index === 0 })));
  const average = grams / seconds;
  return { points, average: Number.isFinite(average) && average >= 0 ? average : null };
}

const peak = (points, key) => points.reduce((max, point) =>
  max == null ? point[key] : Math.max(max, point[key]), null);
const toSeconds = (ms) => Number.isFinite(ms) ? ms / 1000 : null;

export function buildShotProfile(shot) {
  const timing = shot.shotProfileTiming?.version === 1 ? shot.shotProfileTiming : null;
  const pressureOriginS = toSeconds(timing?.pressureOriginMs);
  const scaleOriginS = toSeconds(timing?.scaleOriginMs);
  const legacyPreS = timing ? null : legacyPreInfusionS(shot);
  const clockStable = Number.isFinite(timing?.clockDriftMs) && Math.abs(timing.clockDriftMs) <= MAX_CLOCK_DRIFT_MS;
  const pressureLocal = readCurve(shot.labPressureCurve, 'bar', (bar) => Number.isFinite(bar) && bar >= 0 && bar <= 16, PRESSURE_GAP_S);
  const weightLocal = readCurve(shot.scaleFlowCurve, 'weightG', Number.isFinite, SCALE_FLOW_MAX_SAMPLE_GAP_S);
  const pressureTime = pressureOriginS != null ? (tS) => tS + pressureOriginS
    : isStandalonePressureShot(shot) ? (tS) => tS : labPressureCurvePlotTimeS;
  const weightTime = (tS) => tS + (scaleOriginS ?? legacyPreS ?? 0);
  const pressure = shift(pressureLocal, pressureTime);
  const weight = shift(weightLocal, weightTime);
  const measuredPressure = pressure.length > 0 && pressureOriginS != null;
  const measuredScale = weight.length > 0 && scaleOriginS != null;
  const aligned = clockStable && (!pressure.length || measuredPressure) && (!weight.length || measuredScale);
  const extractionStartS = aligned ? toSeconds(timing?.extractionStartMs) : null;
  const extractionEndS = aligned ? toSeconds(timing?.extractionEndMs) : null;
  const stopS = aligned ? toSeconds(timing?.stopMs) : null;
  const settlementEndS = aligned ? toSeconds(timing?.settlementEndMs) : null;
  // Calculate in the original scale clock, including gap and EMA decisions.
  const { points, average } = scaleFlow(weightLocal, extractionStartS == null ? -Infinity : extractionStartS - scaleOriginS,
    extractionEndS == null ? Infinity : extractionEndS - scaleOriginS);
  const flow = shift(points, weightTime);
  const measures = savedShotMeasurements(shot);

  const pressureInterrupted = pressureLocal.some((point, index) =>
    point.tS - pressureLocal[index - 1]?.tS >= INTERRUPTED_PRESSURE_S)
    || (stopS != null && pressure.length > 0 && stopS - pressure.at(-1).tS >= INTERRUPTED_PRESSURE_S);
  const scaleInterrupted = timing?.scaleInterrupted === true || weight.some((point) => point.breakBefore)
    || (extractionEndS != null && weight.length > 0 && extractionEndS - weight.at(-1).tS > SCALE_FLOW_MAX_SAMPLE_GAP_S);
  return {
    ...measures,
    yieldSource: measures.yieldG != null ? timing?.yieldSource ?? null : null,
    peakPressureBar: peak(pressure, 'bar'),
    averageFlowGs: average,
    peakFlowGs: peak(flow, 'flowGs'),
    finalWeightG: weight.at(-1)?.weightG ?? null,
    pressure,
    displayPressure: shift(pressureChartPointsForDisplay(pressureLocal.map((point) => ({
      ...point, reset: point.breakBefore,
    }))).map((point, index) => ({ ...point, breakBefore: pressureLocal[index].breakBefore })), pressureTime),
    weight,
    flow,
    pressureInterrupted,
    scaleInterrupted,
    aligned,
    approximate: !aligned && Boolean(pressure.length && weight.length || legacyPreS != null
      || pressure.length && !isStandalonePressureShot(shot) || timing),
    extractionStartS,
    extractionEndS,
    stopS,
    settlementEndS,
    legacyPreS,
    minTimeS: Math.min(0, pressure[0]?.tS ?? 0, weight[0]?.tS ?? 0),
    maxTimeS: Math.max(1, pressure.at(-1)?.tS ?? 0, weight.at(-1)?.tS ?? 0, stopS ?? 0, settlementEndS ?? 0),
  };
}

/** Last observation at or before the cursor, only inside a contiguous run. */
export function observationAtTime(points, tS) {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (points[mid].tS <= tS + 1e-9) low = mid + 1;
    else high = mid;
  }
  const previous = points[low - 1];
  const next = points[low];
  if (!previous || (Math.abs(previous.tS - tS) > 1e-9 && (!next || next.breakBefore))) return null;
  return previous;
}
