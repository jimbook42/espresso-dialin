import { isStandalonePressureShot } from '../flairPressureLab/standalonePressureShot.js';
import { PRESSURE_CURVE_GAP_MS } from '../flairPressureLab/pressureCurveFilter.js';
import { pressureChartPointsForDisplay } from '../flairPressureLab/pressureDisplaySmoothing.js';
import { instantaneousFlowGs, SCALE_FLOW_MAX_SAMPLE_GAP_S } from '../scales/flowMetrics.js';
import { plottedFlowFromWeights, SAVED_SMOOTH_FLOW_WINDOW_S } from '../scales/displayFlow.js';

const PRESSURE_GAP_S = PRESSURE_CURVE_GAP_MS / 1000;
const INTERRUPTED_PRESSURE_S = 1;
const MAX_CLOCK_DRIFT_MS = 250;
const TIME_EPSILON_S = 1e-9;

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

export function formatSavedDose(doseG) {
  if (doseG == null) return 'Not recorded';
  return `${Number.isInteger(doseG) ? doseG.toFixed(1) : doseG} g`;
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
    const breakBefore = Boolean(previous && (broken || tS - previous.tS > maxGapS + TIME_EPSILON_S
      || sample.breakBefore || sample.reset));
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

function averageScaleFlow(weights, startS, endS) {
  let seconds = 0;
  let grams = 0;
  let previous;
  for (const point of weights) {
    if (point.tS < startS || point.tS > endS) continue;
    if (!point.breakBefore && Number.isFinite(instantaneousFlowGs(previous, point))) {
      seconds += point.tS - previous.tS;
      grams += point.weightG - previous.weightG;
    }
    previous = point;
  }
  const average = grams / seconds;
  return Number.isFinite(average) && average >= 0 ? average : null;
}

const peak = (points, key) => points.reduce((max, point) =>
  max == null ? point[key] : Math.max(max, point[key]), null);
const toSeconds = (ms) => Number.isFinite(ms) ? ms / 1000 : null;
const validPressure = (bar) => Number.isFinite(bar) && bar >= 0 && bar <= 16;
const stableClock = (timing) =>
  Number.isFinite(timing?.clockDriftMs) && Math.abs(timing.clockDriftMs) <= MAX_CLOCK_DRIFT_MS;

function plotSavedFlow(weights, startS, endS, smoothFlow) {
  return plottedFlowFromWeights(Array.isArray(weights) ? weights : [], startS, endS,
    smoothFlow ? SAVED_SMOOTH_FLOW_WINDOW_S : 0);
}

export function recordedShotTiming(shot) {
  return shot.shotProfileTiming?.version === 1 ? shot.shotProfileTiming : null;
}

export function extractionTiming(timing) {
  if (!stableClock(timing) || !Number.isFinite(timing.extractionStartMs)) return null;
  const duration = (timing.extractionEndMs - timing.extractionStartMs) / 1000;
  return {
    startMs: timing.extractionStartMs,
    durationS: Number.isFinite(timing.extractionEndMs) && Number.isFinite(duration) && duration > 0 ? duration : null,
  };
}

export function physicalShotSources(timing) {
  return {
    pressure: timing?.pressureSource === 'camera',
    scale: timing?.scaleSource === 'web-bluetooth' || timing?.scaleSource === 'native-ble',
  };
}

export function hasPhysicalShotChart(shot) {
  const sources = physicalShotSources(recordedShotTiming(shot));
  return Boolean((sources.pressure && shot.labPressureCurve?.length) || (sources.scale && shot.scaleFlowCurve?.length));
}

export function buildShotProfile(shot, { physicalOnly = false, smoothFlow = false } = {}) {
  const timing = recordedShotTiming(shot);
  const sources = physicalShotSources(timing);
  const pressureOriginS = toSeconds(timing?.pressureOriginMs);
  const scaleOriginS = toSeconds(timing?.scaleOriginMs);
  const legacyPreS = timing ? null : legacyPreInfusionS(shot);
  const extraction = extractionTiming(timing);
  const pressureLocal = !physicalOnly || sources.pressure
    ? readCurve(shot.labPressureCurve, 'bar', validPressure, PRESSURE_GAP_S) : [];
  const weightLocal = !physicalOnly || sources.scale
    ? readCurve(shot.scaleFlowCurve, 'weightG', Number.isFinite, SCALE_FLOW_MAX_SAMPLE_GAP_S) : [];
  const aligned = Boolean(extraction && (pressureLocal.length || weightLocal.length)
    && (!pressureLocal.length || pressureOriginS != null) && (!weightLocal.length || scaleOriginS != null));
  const pressureTime = (tS) => tS + (aligned ? pressureOriginS : 0);
  const weightTime = (tS) => tS + (aligned ? scaleOriginS : 0);
  const pressure = shift(pressureLocal, pressureTime);
  const weight = shift(weightLocal, weightTime);
  const extractionStartS = aligned ? toSeconds(timing?.extractionStartMs) : null;
  const extractionEndS = aligned && extraction.durationS != null ? toSeconds(timing.extractionEndMs) : null;
  const stopS = aligned ? toSeconds(timing?.stopMs) : null;
  const settlementEndS = aligned ? toSeconds(timing?.settlementEndMs) : null;
  const flowStartS = extractionStartS == null ? -Infinity : extractionStartS - scaleOriginS;
  const flowEndS = extractionEndS == null ? Infinity : extractionEndS - scaleOriginS;
  const displayWeights = !physicalOnly || sources.scale ? shot.scaleFlowCurve : null;
  const flow = shift(plotSavedFlow(displayWeights, flowStartS, flowEndS, smoothFlow), weightTime);
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
    averageFlowGs: averageScaleFlow(weightLocal, flowStartS, flowEndS),
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
    approximate: !aligned && Boolean(pressure.length || weight.length),
    extractionStartS,
    extractionEndS,
    stopS,
    settlementEndS,
    legacyPreS,
    minTimeS: Math.min(0, pressure[0]?.tS ?? 0, weight[0]?.tS ?? 0),
    maxTimeS: Math.max(1, pressure.at(-1)?.tS ?? 0, weight.at(-1)?.tS ?? 0, extractionEndS ?? 0, stopS ?? 0, settlementEndS ?? 0),
  };
}

export function buildComparisonProfile(shot) {
  const timing = recordedShotTiming(shot);
  const extraction = extractionTiming(timing);
  const startMs = extraction?.startMs;
  const pressureLocal = readCurve(shot.labPressureCurve, 'bar', validPressure, PRESSURE_GAP_S);
  const pressureAligned = startMs != null && Number.isFinite(timing.pressureOriginMs);
  const pressure = pressureAligned ? shift(pressureLocal, (tS) => tS + (timing.pressureOriginMs - startMs) / 1000) : [];
  const scaleAligned = startMs != null && Number.isFinite(timing.scaleOriginMs);
  const scaleOffsetS = scaleAligned ? (timing.scaleOriginMs - startMs) / 1000 : 0;
  // Saving retains the original scale session on disconnect without appending reconnect observations.
  const scaleDisconnected = timing?.scaleInterrupted === true;
  const weight = shift(readCurve(shot.scaleFlowCurve, 'weightG', Number.isFinite, SCALE_FLOW_MAX_SAMPLE_GAP_S),
    (tS) => tS + scaleOffsetS);
  const flow = scaleFlowIntervals(weight, scaleAligned ? extraction.durationS ?? Infinity : Infinity);
  return {
    ...savedShotMeasurements(shot),
    pressure,
    recordingPressure: pressureAligned ? [] : pressureLocal,
    weight,
    flow,
    sources: physicalShotSources(timing),
    scaleDisconnected,
    scaleTimingApproximate: weight.length > 0 && !scaleAligned,
    pressureTimingUnavailable: pressureLocal.length > 0 && !pressureAligned,
  };
}

export function buildExtractionFlowPlot(shot, smoothFlow) {
  const timing = recordedShotTiming(shot);
  const extraction = extractionTiming(timing);
  const aligned = extraction != null && Number.isFinite(timing.scaleOriginMs);
  const offset = aligned ? (timing.scaleOriginMs - extraction.startMs) / 1000 : 0;
  return shift(plotSavedFlow(shot.scaleFlowCurve, aligned ? -offset : -Infinity,
    aligned ? (extraction.durationS ?? Infinity) - offset : Infinity, smoothFlow), (tS) => tS + offset);
}

function scaleFlowIntervals(weight, endS) {
  const flow = [];
  let breakBefore = true;
  for (let i = 1; i < weight.length; i += 1) {
    const previous = weight[i - 1];
    const sample = weight[i];
    const flowGs = instantaneousFlowGs(previous, sample);
    if (sample.breakBefore || previous.tS < -TIME_EPSILON_S || sample.tS > endS + TIME_EPSILON_S || !Number.isFinite(flowGs)) {
      breakBefore = true;
      continue;
    }
    flow.push({ fromTS: previous.tS, tS: sample.tS, flowGs, breakBefore });
    breakBefore = false;
  }
  return flow;
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
