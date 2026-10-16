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

function flagSet(frame) {
  return String(frame.flags || '').split('|');
}

/** A repeated bar. It is not a measurement and is left out of the scores. */
export function isReadingHeld(frame) {
  return flagSet(frame).includes('reading-held');
}

export function isValidReading(frame) {
  return frame.gaugeFound === true
    && finite(frame.bar)
    && !isReadingHeld(frame)
    && (frame.tracking === 'TRACKING' || frame.tracking === 'UNCERTAIN');
}

function scoredBar(frame) {
  return finite(frame.bar) && !isReadingHeld(frame);
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
    .filter((f) => scoredBar(f))
    .map((f) => Math.abs(f.bar - expected));
  const meanAbsErr = errors.length ? errors.reduce((s, e) => s + e, 0) / errors.length : null;
  const maxAbsErr = errors.length ? Math.max(...errors) : null;

  const withinTol = frames.filter((f) => scoredBar(f) && Math.abs(f.bar - expected) <= tolerance);
  const withinTolerancePct = n ? (withinTol.length / n) * 100 : 0;

  const lowConf = frames.filter((f) => f.gaugeFound && (!finite(f.confidence) || f.confidence < NEEDLE_TRACK_QUALITY));
  const lowConfidencePct = n ? (lowConf.length / n) * 100 : 0;

  const confidentWrong = frames.filter(
    (f) => isHighConfidence(f) && scoredBar(f) && Math.abs(f.bar - expected) > tolerance,
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
  const bars = frames.filter((f) => scoredBar(f)).map((f) => f.bar);
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

  const conflict = frames.map((f) => f.conflictDeg).filter(finite).sort((a, b) => a - b);
  const conflictDegMedian = percentile(conflict, 50);
  const conflictDegMax = conflict.length ? conflict[conflict.length - 1] : null;
  const hasFlag = (frame, name) => flagSet(frame).includes(name);
  const blurPct = n ? (frames.filter((f) => hasFlag(f, 'blur')).length / n) * 100 : 0;
  const glarePct = n ? (frames.filter((f) => hasFlag(f, 'glare')).length / n) * 100 : 0;
  const glareHintPreShot = frames.filter((f) => hasFlag(f, 'glare-hint') && !hasFlag(f, 'shot')).length;
  const glareHintDuringShot = frames.filter((f) => hasFlag(f, 'glare-hint') && hasFlag(f, 'shot')).length;
  const moveCloserPreShot = frames.filter((f) => hasFlag(f, 'move-closer') && !hasFlag(f, 'shot')).length;
  const moveCloserDuringShot = frames.filter((f) => hasFlag(f, 'move-closer') && hasFlag(f, 'shot')).length;
  const gapPct = n ? (frames.filter((f) => hasFlag(f, 'reading-gap')).length / n) * 100 : 0;
  let maxHoldMs = 0;
  for (const frame of frames) {
    if (finite(frame.holdMs)) maxHoldMs = Math.max(maxHoldMs, frame.holdMs);
  }

  let centreAtTruePct = null;
  if (clip.scoringCentre && withGauge.length) {
    const { x, y, tolerancePx } = clip.scoringCentre;
    const tol = tolerancePx ?? 45;
    const atTrue = withGauge.filter(
      (f) => finite(f.centreX) && finite(f.centreY)
        && Math.hypot(f.centreX - x, f.centreY - y) <= tol,
    );
    centreAtTruePct = (atTrue.length / withGauge.length) * 100;
  }

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
    centreAtTruePct,
    barRange,
    processMsMedian,
    processMsP95,
    conflictDegMedian,
    conflictDegMax,
    blurPct,
    glarePct,
    glareHintPreShot,
    glareHintDuringShot,
    moveCloserPreShot,
    moveCloserDuringShot,
    gapPct,
    maxHoldS: maxHoldMs / 1000,
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

/**
 * Two consecutive replays of the same clip. Pair frames by time.
 * A small bar and centre tolerance is the determinism budget: the fake
 * camera can present one frame early, and that must not look like a new run.
 */
export function compareReplayRuns(leftFrames, rightFrames, {
  barTol = 0.08,
  centreTol = 3,
  timeTolS = 0.2,
} = {}) {
  const used = new Set();
  let matched = 0;
  let barMismatch = 0;
  let centreMismatch = 0;
  let maxBarDelta = 0;
  for (const frame of leftFrames) {
    let best = -1;
    let bestDt = Infinity;
    for (let i = 0; i < rightFrames.length; i += 1) {
      if (used.has(i)) continue;
      const dt = Math.abs((frame.timeS ?? 0) - (rightFrames[i].timeS ?? 0));
      if (dt < bestDt) {
        bestDt = dt;
        best = i;
      }
    }
    if (best < 0 || bestDt > timeTolS) continue;
    used.add(best);
    matched += 1;
    const other = rightFrames[best];
    const leftBar = finite(frame.bar);
    const rightBar = finite(other.bar);
    if (leftBar || rightBar) {
      if (!leftBar || !rightBar) barMismatch += 1;
      else {
        const delta = Math.abs(frame.bar - other.bar);
        maxBarDelta = Math.max(maxBarDelta, delta);
        if (delta > barTol) barMismatch += 1;
      }
    }
    if (finite(frame.centreX) && finite(other.centreX) && finite(frame.centreY) && finite(other.centreY)) {
      const dist = Math.hypot(frame.centreX - other.centreX, frame.centreY - other.centreY);
      if (dist > centreTol) centreMismatch += 1;
    }
  }
  const frameDelta = Math.abs(leftFrames.length - rightFrames.length);
  const barRate = matched ? barMismatch / matched : 1;
  const centreRate = matched ? centreMismatch / matched : 1;
  const identical = frameDelta <= 2 && barRate <= 0.02 && maxBarDelta <= 0.15 && centreRate <= 0.02;
  return {
    left: leftFrames.length,
    right: rightFrames.length,
    matched,
    barMismatch,
    centreMismatch,
    maxBarDelta,
    frameDelta,
    identical,
  };
}
