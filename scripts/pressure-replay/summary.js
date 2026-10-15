import { NEEDLE_TRACK_QUALITY } from '../../src/flairPressureLab/gaugeConfig.js';

function finite(value) {
  return value != null && !Number.isNaN(value);
}

function sampleSd(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function maxAbsJump(values) {
  let max = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (!finite(values[i]) || !finite(values[i - 1])) continue;
    max = Math.max(max, Math.abs(values[i] - values[i - 1]));
  }
  return max;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function isHighConfidence(frame) {
  return finite(frame.confidence) && frame.confidence >= NEEDLE_TRACK_QUALITY;
}

export function isValidReading(frame) {
  return frame.gaugeFound === true
    && finite(frame.bar)
    && (frame.tracking === 'TRACKING' || frame.tracking === 'UNCERTAIN');
}

export function isNoReading(frame) {
  return frame.gaugeFound !== true || !finite(frame.bar) || frame.tracking === 'LOST' || frame.tracking === 'CALIBRATING';
}

/**
 * @param {object[]} frames — harness rows (not CV internals)
 * @param {{ expectedBar: number, expectedPeakBar?: number|null, tolerance: number }} clip
 */
export function summarizeClipFrames(frames, clip) {
  const n = frames.length;
  const expected = clip.expectedBar;
  const tolerance = clip.tolerance ?? 0.5;

  const withGauge = frames.filter((f) => f.gaugeFound === true);
  const gaugeTrackedPct = n ? (withGauge.length / n) * 100 : 0;

  const errors = frames
    .filter((f) => finite(f.bar))
    .map((f) => Math.abs(f.bar - expected));
  const meanAbsErr = errors.length ? errors.reduce((s, e) => s + e, 0) / errors.length : null;
  const maxAbsErr = errors.length ? Math.max(...errors) : null;

  const withinTol = frames.filter((f) => finite(f.bar) && Math.abs(f.bar - expected) <= tolerance);
  const withinTolerancePct = n ? (withinTol.length / n) * 100 : 0;

  const lowConf = frames.filter((f) => f.gaugeFound && (!finite(f.confidence) || f.confidence < NEEDLE_TRACK_QUALITY));
  const lowConfidencePct = n ? (lowConf.length / n) * 100 : 0;

  const confidentWrong = frames.filter(
    (f) => isHighConfidence(f) && finite(f.bar) && Math.abs(f.bar - expected) > tolerance,
  );
  const confidentButWrongPct = n ? (confidentWrong.length / n) * 100 : 0;

  const firstValid = frames.find(isValidReading);
  const timeToFirstValidReadingS = firstValid?.timeS ?? null;

  const noReadingCount = frames.filter(isNoReading).length;
  const noReadingRatePct = n ? (noReadingCount / n) * 100 : 0;

  const confidentBars = frames.filter((f) => isHighConfidence(f) && finite(f.bar)).map((f) => f.bar);
  const barStabilityStd = sampleSd(confidentBars);
  const barStabilityMaxJump = maxAbsJump(confidentBars);

  const detected = frames.filter((f) => f.gaugeFound === true && finite(f.centreX) && finite(f.centreY));
  const centreX = detected.map((f) => f.centreX);
  const centreY = detected.map((f) => f.centreY);
  const bars = frames.filter((f) => finite(f.bar)).map((f) => f.bar);
  const centreRange = detected.length
    ? {
      minX: Math.min(...centreX),
      maxX: Math.max(...centreX),
      minY: Math.min(...centreY),
      maxY: Math.max(...centreY),
    }
    : null;
  const barRange = bars.length
    ? { min: Math.min(...bars), max: Math.max(...bars) }
    : null;

  const processMs = frames.map((f) => f.processMs).filter(finite).sort((a, b) => a - b);
  const processMsMedian = percentile(processMs, 50);
  const processMsP95 = percentile(processMs, 95);

  const passGaugeTracked = gaugeTrackedPct >= 80;
  const passTolerance = withinTolerancePct >= 80;
  const passConfidentWrong = confidentButWrongPct <= 5;

  return {
    frames: n,
    gaugeTrackedPct,
    meanAbsError: meanAbsErr,
    maxAbsError: maxAbsErr,
    withinTolerancePct,
    lowConfidencePct,
    confidentButWrongPct,
    timeToFirstValidReadingS,
    noReadingRatePct,
    barStabilityStdDev: barStabilityStd,
    barStabilityMaxJump,
    centreRange,
    barRange,
    processMsMedian,
    processMsP95,
    pass: {
      gaugeTracked: passGaugeTracked,
      withinTolerance: passTolerance,
      confidentButWrong: passConfidentWrong,
      overall: passGaugeTracked && passTolerance && passConfidentWrong,
    },
    expectedBar: expected,
    tolerance,
  };
}
