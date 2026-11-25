import { PRESSURE_CURVE_GAP_MS } from '../flairPressureLab/pressureCurveFilter.js';
import { plottedFlowFromWeights } from '../scales/displayFlow.js';
import { buildComparisonProfile, extractionTiming, recordedShotTiming } from './shotProfile.js';

const PRESSURE_GAP_S = PRESSURE_CURVE_GAP_MS / 1000;
const TIME_EPSILON_S = 1e-9;
const BAND_WIDTH_BAR = 2;
const MIN_OBSERVED_FRACTION = 0.5;
const MIN_EXTRACTION_FRACTION = 0.9;
const bandStart = (bar) => Math.floor(bar / BAND_WIDTH_BAR) * BAND_WIDTH_BAR;

function pressureSummary(pressure, durationS) {
  const peak = pressure.reduce((max, sample) => !max || sample.bar > max.bar ? sample : max, null);
  let observedS = 0;
  let area = 0;
  let intervals = 0;
  const gaps = [];
  for (let i = 1; i < pressure.length; i += 1) {
    const point = pressure[i];
    const previous = pressure[i - 1];
    if (point.breakBefore) {
      gaps.push({ fromTS: previous.tS, toTS: point.tS });
      continue;
    }
    const span = point.tS - previous.tS;
    observedS += span;
    area += (point.bar + previous.bar) / 2 * span;
    intervals += 1;
  }
  const observedFraction = peak ? Math.min(1, observedS / durationS) : null;
  const startMissingS = peak ? Math.max(0, pressure[0].tS) : null;
  const endMissingS = peak ? Math.max(0, durationS - pressure.at(-1).tS) : null;
  // Keep the existing boundary tolerance for a representative extraction average.
  // It estimates the extraction from observed data and never fills either edge.
  const complete = gaps.length === 0 && observedFraction >= MIN_EXTRACTION_FRACTION - TIME_EPSILON_S
    && startMissingS <= PRESSURE_GAP_S + TIME_EPSILON_S && endMissingS <= PRESSURE_GAP_S + TIME_EPSILON_S;
  const averageBar = intervals >= 2 && observedFraction >= MIN_OBSERVED_FRACTION - TIME_EPSILON_S
    ? area / observedS : null;
  return {
    observedPeakBar: peak?.bar ?? null,
    averageBar,
    fullExtractionAverageBar: complete ? averageBar : null,
    timeToPeakS: peak ? Math.max(0, peak.tS) : null,
    pressureCoverage: peak ? {
      observedS, observedFraction, intervals, interruptions: gaps.length, gaps, startMissingS, endMissingS,
      peakMayBeMissed: gaps.length > 0 || observedFraction < 1 - TIME_EPSILON_S,
      averageUnavailableReason: intervals < 2 ? 'Fewer than two continuous pressure intervals'
        : averageBar == null ? 'Less than half of extraction observed' : null,
    } : null,
  };
}

function pressureBands(pressure, flow) {
  const bands = new Map();
  let left = 0;
  for (const interval of flow) {
    // Require continuous pressure observations to bracket the entire weight interval within one band.
    while (pressure[left + 1]?.tS <= interval.fromTS + TIME_EPSILON_S) left += 1;
    if (!pressure[left] || pressure[left].tS > interval.fromTS + TIME_EPSILON_S) continue;
    const minBar = bandStart(pressure[left].bar);
    let right = left;
    while (pressure[right].tS < interval.tS - TIME_EPSILON_S) {
      const next = pressure[right + 1];
      if (!next || next.breakBefore || bandStart(next.bar) !== minBar) break;
      right += 1;
    }
    if (pressure[right].tS < interval.tS - TIME_EPSILON_S) continue;
    const band = bands.get(minBar) ?? { minBar, maxBar: minBar + BAND_WIDTH_BAR, seconds: 0, grams: 0, count: 0 };
    const seconds = interval.tS - interval.fromTS;
    band.seconds += seconds;
    band.grams += interval.flowGs * seconds;
    band.count += 1;
    bands.set(minBar, band);
  }
  return [...bands.values()].filter(({ count }) => count >= 2)
    .sort((a, b) => a.minBar - b.minBar)
    .map(({ grams, ...band }) => ({ ...band, averageFlowGs: grams / band.seconds }));
}

export function buildPressureFlowAnalytics(shot) {
  const timing = recordedShotTiming(shot);
  const extraction = extractionTiming(timing);
  const durationS = extraction?.durationS ?? null;
  const profile = buildComparisonProfile(shot);
  const pressure = durationS != null && profile.sources.pressure
    ? profile.pressure.filter(({ tS }) => tS >= -TIME_EPSILON_S && tS <= durationS + TIME_EPSILON_S) : [];
  const usableScale = durationS != null && Number.isFinite(timing.scaleOriginMs)
    && profile.sources.scale && timing.scaleInterrupted === false;
  const flow = usableScale ? profile.flow : [];
  // Use the same elapsed-time estimator as compact History. Paired bands retain
  // their original, unsmoothed net mass / observed duration definition.
  const displayFlow = usableScale && Array.isArray(shot.scaleFlowCurve) ? plottedFlowFromWeights(shot.scaleFlowCurve,
    (extraction.startMs - timing.scaleOriginMs) / 1000, (timing.extractionEndMs - timing.scaleOriginMs) / 1000)
    .map((point) => ({ ...point, tS: point.tS + (timing.scaleOriginMs - extraction.startMs) / 1000 })) : [];
  return {
    durationS,
    pressure,
    flow,
    displayFlow,
    bands: pressureBands(pressure, flow),
    ...pressureSummary(pressure, durationS),
    preinfusionS: durationS != null && extraction.startMs > 0 ? extraction.startMs / 1000 : null,
    pressureStatus: !shot.labPressureCurve?.length ? 'No pressure recording'
      : durationS == null || profile.pressureTimingUnavailable ? 'Pressure extraction timing is uncertain'
        : !profile.sources.pressure ? 'Camera pressure source unverified'
          : !pressure.length ? 'No pressure samples inside extraction' : null,
    flowStatus: !shot.scaleFlowCurve?.length ? 'No scale recording'
      : profile.scaleDisconnected ? 'Scale disconnected during recording'
        : durationS == null || profile.scaleTimingApproximate ? 'Scale extraction timing is uncertain'
          : !profile.sources.scale || timing.scaleInterrupted !== false ? 'Continuous Bluetooth scale source unverified'
            : !flow.length && !displayFlow.length ? 'No usable flow intervals inside extraction' : null,
  };
}
