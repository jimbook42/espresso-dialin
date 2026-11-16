import { PRESSURE_CURVE_GAP_MS } from '../flairPressureLab/pressureCurveFilter.js';
import { buildComparisonProfile, extractionTiming, recordedShotTiming } from './shotProfile.js';

const PRESSURE_GAP_S = PRESSURE_CURVE_GAP_MS / 1000;
const TIME_EPSILON_S = 1e-9;
const BAND_WIDTH_BAR = 2;
const bandStart = (bar) => Math.floor(bar / BAND_WIDTH_BAR) * BAND_WIDTH_BAR;

function pressureSummary(pressure, durationS) {
  if (!pressure.length) return { observedPeakBar: null, averageBar: null, timeToPeakS: null };
  const peak = pressure.reduce((max, sample) => sample.bar > max.bar ? sample : max);
  const first = pressure[0];
  const last = pressure.at(-1);
  const complete = pressure.length >= 3 && first.tS <= PRESSURE_GAP_S + TIME_EPSILON_S
    && durationS - last.tS <= PRESSURE_GAP_S + TIME_EPSILON_S
    && !pressure.slice(1).some(({ breakBefore }) => breakBefore);
  const area = complete ? pressure.slice(1).reduce((sum, point, i) => {
    const previous = pressure[i];
    return sum + (point.bar + previous.bar) / 2 * (point.tS - previous.tS);
  }, 0) : null;
  return {
    observedPeakBar: peak.bar,
    averageBar: complete ? area / (last.tS - first.tS) : null,
    timeToPeakS: complete ? Math.max(0, peak.tS) : null,
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
  const flow = durationS != null && !profile.scaleTimingApproximate
    && profile.sources.scale && timing.scaleInterrupted === false ? profile.flow : [];
  return {
    durationS,
    pressure,
    flow,
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
            : !flow.length ? 'No usable flow intervals inside extraction' : null,
  };
}
