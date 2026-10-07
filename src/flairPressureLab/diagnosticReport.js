/**
 * Plain-text snapshot of the in-memory lab trace.
 * Reads recorded samples only. Does not change detection, tracking, or pressure.
 */
import { DIAGNOSTIC_WINDOW_MS } from './diagnosticHistory.js';
import {
  EXTRACTION_START_BAR,
  FLAIR_58_SCALE,
  NEEDLE_AGREE_DEG,
  NEEDLE_LOST_QUALITY,
  NEEDLE_TRACK_QUALITY,
  REST_MAX_SPREAD_DEG,
  wrap360,
  wrapDelta,
} from './gaugeConfig.js';

const LOST_SCORE = NEEDLE_LOST_QUALITY;
const UNCERTAIN_SCORE = NEEDLE_TRACK_QUALITY;
const JITTER_UNCERTAIN_DEG = NEEDLE_AGREE_DEG;
const CENTRE_EVENT_FRACTION = 0.1;
const ROTATION_EVENT_DEG = 8;
const PRESSURE_NEAR_ZERO_BAR = 0.5;

function finite(value) {
  return value != null && !Number.isNaN(value);
}

function nums(values) {
  return values.filter(finite);
}

function sampleSd(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function linearStats(values) {
  const data = nums(values);
  if (!data.length) return { n: 0, min: null, max: null, mean: null, sd: null };
  const mean = data.reduce((sum, value) => sum + value, 0) / data.length;
  return {
    n: data.length,
    min: Math.min(...data),
    max: Math.max(...data),
    mean,
    sd: sampleSd(data),
  };
}

function circularStats(values) {
  const data = nums(values);
  if (!data.length) return { n: 0, min: null, max: null, mean: null, sd: null };
  const base = data[0];
  const deltas = data.map((value) => wrapDelta(base, value));
  const meanDelta = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  return {
    n: data.length,
    min: Math.min(...data),
    max: Math.max(...data),
    mean: wrap360(base + meanDelta),
    sd: sampleSd(deltas),
  };
}

function fmt(value, digits) {
  if (!finite(value)) return 'N/A';
  return Number(value).toFixed(digits);
}

function fmtPct(count, total) {
  if (!total) return 'N/A';
  return `${((count / total) * 100).toFixed(1)}%`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function formatLocalTimestamp(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function clockOffset(start, time) {
  const seconds = Math.max(0, (time - start) / 1000);
  const whole = Math.floor(seconds);
  const frac = Math.round((seconds - whole) * 100);
  const adjusted = frac === 100 ? whole + 1 : whole;
  const fraction = frac === 100 ? 0 : frac;
  return `${pad2(adjusted)}.${pad2(fraction)}`;
}

function hasKey(samples, key) {
  return samples.some((sample) => Object.prototype.hasOwnProperty.call(sample, key));
}

function overlayVisible(sample) {
  if (Object.prototype.hasOwnProperty.call(sample, 'needleVisible')) return sample.needleVisible === true;
  if (sample.smoothedAngle == null) return false;
  return sample.tracking === 'TRACKING' || sample.tracking === 'UNCERTAIN';
}

function statBlock(stats, digits, suffix = '') {
  return [
    `  Samples: ${stats.n}`,
    `  Min: ${fmt(stats.min, digits)}${suffix}`,
    `  Max: ${fmt(stats.max, digits)}${suffix}`,
    `  Mean: ${fmt(stats.mean, digits)}${suffix}`,
    `  Standard deviation: ${fmt(stats.sd, digits)}${suffix}`,
  ].join('\n');
}

function deltaLine(values, digits, unit) {
  const stats = linearStats(values);
  if (!stats.n) return `N/A (${unit}, no consecutive pairs)`;
  return `${fmt(stats.min, digits)} / ${fmt(stats.max, digits)} / ${fmt(stats.mean, digits)} / ${fmt(stats.sd, digits)} ${unit} (${stats.n} steps)`;
}

function frameDeltas(samples, pick, circular = false) {
  const deltas = [];
  for (let i = 1; i < samples.length; i += 1) {
    const previous = pick(samples[i - 1]);
    const current = pick(samples[i]);
    if (!finite(previous) || !finite(current)) continue;
    deltas.push(circular ? wrapDelta(previous, current) : current - previous);
  }
  return deltas;
}

function gapMs(samples, predicate) {
  let ms = 0;
  for (let i = 0; i < samples.length - 1; i += 1) {
    if (!predicate(samples[i])) continue;
    const gap = samples[i + 1].t - samples[i].t;
    if (gap > 0) ms += gap;
  }
  return ms;
}

function longestRunMs(samples, predicate) {
  let best = 0;
  let index = 0;
  while (index < samples.length) {
    if (!predicate(samples[index])) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < samples.length && predicate(samples[end + 1])) end += 1;
    const stop = end + 1 < samples.length ? samples[end + 1].t : samples[end].t;
    best = Math.max(best, stop - samples[index].t);
    index = end + 1;
  }
  return best;
}

function countTransition(samples, from, to, pick) {
  let count = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (pick(samples[i - 1]) === from && pick(samples[i]) === to) count += 1;
  }
  return count;
}

function countFlag(samples, key) {
  if (!hasKey(samples, key)) return null;
  return samples.filter((sample) => sample[key] === true).length;
}

function separationMode(rows) {
  if (!hasKey(rows, 'candidateAngle') || !hasKey(rows, 'secondCandidateAngle')) return null;
  const bins = new Map();
  let total = 0;
  rows.forEach((sample) => {
    if (!finite(sample.candidateAngle) || !finite(sample.secondCandidateAngle)) return;
    const separation = Math.abs(wrapDelta(sample.candidateAngle, sample.secondCandidateAngle));
    const bin = Math.round(separation / 5) * 5;
    bins.set(bin, (bins.get(bin) || 0) + 1);
    total += 1;
  });
  if (!total) return null;
  let mode = null;
  let count = 0;
  bins.forEach((hits, bin) => {
    if (hits > count) {
      count = hits;
      mode = bin;
    }
  });
  return { mode, count, total };
}

function lastFinite(samples, pick) {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const value = pick(samples[index]);
    if (finite(value)) return value;
  }
  return null;
}

function appliedCentreSteps(samples) {
  const steps = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!finite(previous.gaugeX) || !finite(previous.gaugeY) || !finite(current.gaugeX) || !finite(current.gaugeY)) continue;
    steps.push(Math.hypot(current.gaugeX - previous.gaugeX, current.gaugeY - previous.gaugeY));
  }
  return steps;
}

/**
 * Signed rotation from the previous applied pose to this frame's reacquisition candidate.
 * The accepted frame already stores the new rotation, so the baseline is the prior sample.
 */
function reacquireRotationDeltas(samples) {
  const deltas = new Array(samples.length).fill(null);
  let previousApplied = null;
  samples.forEach((sample, index) => {
    const baseline = previousApplied != null
      ? previousApplied
      : (sample.reacquireAccepted === true ? null : sample.gaugeRotation);
    if (finite(sample.reacquireRotation) && finite(baseline)) {
      deltas[index] = wrapDelta(baseline, sample.reacquireRotation);
    }
    if (finite(sample.gaugeRotation)) previousApplied = sample.gaugeRotation;
  });
  return deltas;
}

function centreSpread(samples, pickX, pickY) {
  const xs = [];
  const ys = [];
  samples.forEach((sample) => {
    const x = pickX(sample);
    const y = pickY(sample);
    if (!finite(x) || !finite(y)) return;
    xs.push(x);
    ys.push(y);
  });
  const xSd = sampleSd(xs);
  const ySd = sampleSd(ys);
  if (xSd == null || ySd == null) return null;
  return Math.hypot(xSd, ySd);
}

/** @param {object[]} samples @param {{ timestamp?: Date, cameraWidth?: number, cameraHeight?: number, calibrationStatus?: string }} context */
export function buildDiagnosticReport(samples, context = {}) {
  const rows = Array.isArray(samples) ? samples : [];
  const timestamp = context.timestamp instanceof Date ? context.timestamp : new Date();
  const width = context.cameraWidth;
  const height = context.cameraHeight;
  const resolution = finite(width) && finite(height) ? `${width}×${height}` : 'N/A';
  const calibration = context.calibrationStatus || 'N/A';
  const lines = [];
  const push = (line = '') => lines.push(line);

  push('FLAIR PRESSURE LAB — DIAGNOSTIC REPORT');
  push(`Timestamp: ${formatLocalTimestamp(timestamp)}`);
  if (!rows.length) {
    push('Window: N/A (no samples)');
  } else {
    const span = rows[rows.length - 1].t - rows[0].t;
    push(`Window: ${formatLocalTimestamp(new Date(rows[0].t))} → ${formatLocalTimestamp(new Date(rows[rows.length - 1].t))} (${(span / 1000).toFixed(2)}s between first and last sample, ${rows.length} samples, buffer ${DIAGNOSTIC_WINDOW_MS / 1000}s)`);
  }
  push(`Camera resolution: ${resolution}`);
  push(`Calibration status: ${calibration}`);
  push(`Build: ${context.buildId || 'N/A'}`);
  const scaleMin = finite(context.minBar) ? context.minBar : FLAIR_58_SCALE.minBar;
  const scaleMax = finite(context.maxBar) ? context.maxBar : FLAIR_58_SCALE.maxBar;
  const scaleSweep = finite(context.sweepDeg) ? context.sweepDeg : FLAIR_58_SCALE.sweepDeg;
  push(`Pressure scale: ${scaleMin}-${scaleMax} bar over ${scaleSweep}° (provisional, not physically validated)`);
  push('');
  push('PHYSICAL TEST CONTEXT');
  push('Physical movement is user-confirmed externally.');
  push('');

  if (hasKey(rows, 'uncertaintyReason')) {
    const lastReason = [...rows].reverse().find((sample) => sample.uncertaintyReason)?.uncertaintyReason;
    push('UNCERTAINTY');
    push(`Last uncertainty reason: ${lastReason || 'N/A'}`);
    push(`Off-scale samples: ${rows.filter((sample) => sample.uncertaintyReason === 'off-scale').length}`);
    push(`Gauge-held samples: ${rows.filter((sample) => sample.uncertaintyReason === 'gauge-held').length}`);
    push('');
  }

  if (!rows.length) {
    push('No diagnostic samples in memory.');
    return lines.join('\n');
  }

  const start = rows[0].t;
  const measured = hasKey(rows, 'pressureMeasured')
    ? rows.filter((sample) => sample.pressureMeasured === true && finite(sample.rawPressure))
    : null;
  const pressureStats = measured ? linearStats(measured.map((sample) => sample.rawPressure)) : null;
  const heldPressure = hasKey(rows, 'pressureMeasured')
    ? rows.filter((sample) => sample.pressureMeasured === false && finite(sample.pressure) && sample.tracking !== 'CALIBRATING').length
    : null;

  push('PRESSURE');
  push('Values are the raw calculated bar on frames that accepted a new needle sample.');
  push('Held pressure is the last smoothed value kept on the screen and is excluded from min, max, mean, and standard deviation.');
  if (!pressureStats) {
    push('Min: N/A');
    push('Max: N/A');
    push('Mean: N/A');
    push('Standard deviation: N/A');
    push('First: N/A');
    push('Last: N/A');
    push('Valid pressure samples: N/A (pressureMeasured was not recorded)');
    push('Held-pressure samples: N/A (pressureMeasured was not recorded)');
  } else {
    push(`Min: ${fmt(pressureStats.min, 3)} bar`);
    push(`Max: ${fmt(pressureStats.max, 3)} bar`);
    push(`Mean: ${fmt(pressureStats.mean, 3)} bar`);
    push(`Standard deviation: ${fmt(pressureStats.sd, 3)} bar`);
    push(`First: ${fmt(measured[0]?.rawPressure, 3)} bar`);
    push(`Last: ${fmt(measured[measured.length - 1]?.rawPressure, 3)} bar`);
    push(`Valid pressure samples: ${measured.length}`);
    push(`Held-pressure samples: ${heldPressure}`);
  }
  const smoothedPressure = linearStats(rows.map((sample) => sample.pressure));
  push('Smoothed pressure:');
  push('Displayed bar on every frame that stored one, including frames that held the last value. Null readings are omitted.');
  if (!smoothedPressure.n) {
    push('Min: N/A');
    push('Max: N/A');
    push('Mean: N/A');
    push('Standard deviation: N/A');
  } else {
    push(`Min: ${fmt(smoothedPressure.min, 3)} bar`);
    push(`Max: ${fmt(smoothedPressure.max, 3)} bar`);
    push(`Mean: ${fmt(smoothedPressure.mean, 3)} bar`);
    push(`Standard deviation: ${fmt(smoothedPressure.sd, 3)} bar`);
  }
  if (!hasKey(rows, 'pressureMeasured')) {
    push('Held pressure values: N/A (pressureMeasured was not recorded)');
  } else {
    const heldValues = rows
      .filter((sample) => sample.pressureMeasured === false && sample.tracking !== 'CALIBRATING' && finite(sample.pressure))
      .map((sample) => sample.pressure);
    const heldStats = linearStats(heldValues);
    push('Held pressure values:');
    push('Displayed bar on frames that kept the last smoothed pressure instead of accepting a new needle sample.');
    if (!heldStats.n) {
      push('  Samples: 0');
    } else {
      push(statBlock(heldStats, 3, ' bar'));
    }
  }
  push('');

  const screen = circularStats(rows.map((sample) => sample.rawAngle));
  const relative = circularStats(rows.map((sample) => sample.relativeAngle));
  const smoothed = circularStats(rows.map((sample) => sample.smoothedAngle));
  const acceptedRelative = hasKey(rows, 'angleAccepted')
    ? circularStats(rows.filter((sample) => sample.angleAccepted === true).map((sample) => sample.relativeAngle))
    : null;
  const visibleCount = rows.filter(overlayVisible).length;
  const visibilityRecorded = hasKey(rows, 'needleVisible');

  push('NEEDLE');
  push('Raw screen angle:');
  push('Degrees in the unmirrored frame. 0 is right, clockwise is positive. Mean and standard deviation are circular. Min and max are the stored degree values.');
  push(statBlock(screen, 2, '°'));
  push('Accepted/raw relative angle:');
  push('Detector relative angle on every frame (screen angle minus applied gauge rotation). Not filtered to accepted frames.');
  push(statBlock(relative, 2, '°'));
  if (!acceptedRelative) {
    push('Relative angle on accepted frames: N/A (angleAccepted was not recorded)');
  } else {
    push('Relative angle on accepted frames:');
    push(statBlock(acceptedRelative, 2, '°'));
  }
  push('Smoothed relative angle:');
  push('The angle tracker output, including the held value on frames that did not accept a new sample.');
  push(statBlock(smoothed, 2, '°'));
  push('Needle detection:');
  push(`  Samples: ${rows.length}`);
  push(`  Samples with valid needle: ${visibleCount}`);
  push(`  Detection rate: ${fmtPct(visibleCount, rows.length)}`);
  push(visibilityRecorded
    ? '  Valid needle means the green overlay was shown. That flag is recorded with each sample.'
    : '  Valid needle is derived: tracking is TRACKING or UNCERTAIN and a smoothed angle is stored. That is the green overlay rule. needleVisible was not recorded.');
  push(`  The green line is hidden when the state is LOST or CALIBRATING. LOST is the needle score below ${LOST_SCORE} when the frame is not gauge-held and not flip-held. UNCERTAIN still shows the line. UNCERTAIN is gauge held, flip held, an unaccepted sample, needle score below ${UNCERTAIN_SCORE}, or jitter above ${JITTER_UNCERTAIN_DEG}°.`);
  push('');

  const visible = (sample) => overlayVisible(sample);
  const hidden = (sample) => !overlayVisible(sample);
  const lostHidden = rows.filter((sample) => sample.tracking === 'LOST' && !overlayVisible(sample)).length;
  const calibratingHidden = rows.filter((sample) => sample.tracking === 'CALIBRATING' && !overlayVisible(sample)).length;
  const otherHidden = rows.filter((sample) => !overlayVisible(sample) && sample.tracking !== 'LOST' && sample.tracking !== 'CALIBRATING').length;

  push('NEEDLE CONTINUITY');
  push('Valid means the green needle line. Durations use the gap from each sample to the next. The last sample adds no further time. A run that reaches the last sample ends at that sample.');
  push(`Valid → invalid transitions: ${countTransition(rows, true, false, overlayVisible)}`);
  push(`Invalid → valid transitions: ${countTransition(rows, false, true, overlayVisible)}`);
  push(`Longest continuous valid period: ${fmt(longestRunMs(rows, visible) / 1000, 2)} s`);
  push(`Longest continuous invalid period: ${fmt(longestRunMs(rows, hidden) / 1000, 2)} s`);
  push(`Total invalid duration: ${fmt(gapMs(rows, hidden) / 1000, 2)} s`);
  push(`Total uncertain duration: ${fmt(gapMs(rows, (sample) => sample.tracking === 'UNCERTAIN') / 1000, 2)} s (state UNCERTAIN; the green line stays visible in this state)`);
  push(`Total lost duration: ${fmt(gapMs(rows, (sample) => sample.tracking === 'LOST') / 1000, 2)} s (state LOST; this hides the green line)`);
  push(`Hidden samples while LOST: ${lostHidden}`);
  push(`Hidden samples while CALIBRATING: ${calibratingHidden}`);
  push(`Hidden samples for another reason: ${otherHidden}`);
  const gaugeHeldCount = countFlag(rows, 'gaugeHeld');
  const flipHeldCount = countFlag(rows, 'flipHeld');
  const weakCount = countFlag(rows, 'weakNeedle');
  const acceptedCount = countFlag(rows, 'angleAccepted');
  push('Recorded causes, counted per sample. These do not all hide the green line.');
  push(`  Gauge pose held: ${gaugeHeldCount == null ? 'N/A' : gaugeHeldCount} (state becomes UNCERTAIN; line stays up when the needle score is otherwise ok)`);
  push(`  Flip held: ${flipHeldCount == null ? 'N/A' : flipHeldCount} (tail or about-180° reject; state becomes UNCERTAIN)`);
  push(`  Needle score below ${LOST_SCORE}: ${weakCount == null ? 'N/A' : weakCount} (this is what makes state LOST and hides the line, unless gauge-held or flip-held already forced UNCERTAIN)`);
  push(`  Angle sample accepted: ${acceptedCount == null ? 'N/A' : acceptedCount}`);
  push('');

  push('GAUGE CENTRE');
  push('ΔX and ΔY are frame-to-frame changes in video pixels. They are not offsets from the first sample. Order is min / max / mean / standard deviation.');
  push('Raw detector:');
  push(`  ΔX min/max/mean/SD: ${deltaLine(frameDeltas(rows, (sample) => sample.rawGaugeX), 2, 'px')}`);
  push(`  ΔY min/max/mean/SD: ${deltaLine(frameDeltas(rows, (sample) => sample.rawGaugeY), 2, 'px')}`);
  push('Applied pose:');
  push(`  ΔX min/max/mean/SD: ${deltaLine(frameDeltas(rows, (sample) => sample.gaugeX), 2, 'px')}`);
  push(`  ΔY min/max/mean/SD: ${deltaLine(frameDeltas(rows, (sample) => sample.gaugeY), 2, 'px')}`);
  const centreSteps = appliedCentreSteps(rows);
  const largestCentre = centreSteps.length ? Math.max(...centreSteps) : null;
  const lastCentreX = lastFinite(rows, (sample) => sample.gaugeX);
  const lastCentreY = lastFinite(rows, (sample) => sample.gaugeY);
  push(lastCentreX == null || lastCentreY == null
    ? 'Last accepted centre: N/A'
    : `Last accepted centre: ${fmt(lastCentreX, 1)}, ${fmt(lastCentreY, 1)} px`);
  push(largestCentre == null
    ? 'Largest accepted centre displacement: N/A'
    : `Largest accepted centre displacement: ${fmt(largestCentre, 2)} px`);
  push('');

  push('GAUGE ROTATION');
  push('Stored degrees. Mean and standard deviation are circular. Min and max are the stored values in [0, 360) and are not circular.');
  push('Raw detector:');
  push(statBlock(circularStats(rows.map((sample) => sample.rawRotation)), 2, '°'));
  push('Applied:');
  push(statBlock(circularStats(rows.map((sample) => sample.gaugeRotation)), 2, '°'));
  const rotationSteps = frameDeltas(rows, (sample) => sample.gaugeRotation, true).map((step) => Math.abs(step));
  const largestRotation = rotationSteps.length ? Math.max(...rotationSteps) : null;
  const lastRotation = lastFinite(rows, (sample) => sample.gaugeRotation);
  push(lastRotation == null
    ? 'Last accepted rotation: N/A'
    : `Last accepted rotation: ${fmt(lastRotation, 2)}°`);
  push(largestRotation == null
    ? 'Largest accepted rotation change: N/A'
    : `Largest accepted rotation change: ${fmt(largestRotation, 2)}°`);
  push('');

  push('GAUGE RADIUS');
  push('Absolute radius in video pixels. Not a delta.');
  if (!hasKey(rows, 'rawGaugeRadius')) {
    push('Raw:');
    push('  N/A (raw radius was not recorded)');
  } else {
    push('Raw:');
    push(statBlock(linearStats(rows.map((sample) => sample.rawGaugeRadius)), 2, ' px'));
  }
  if (!hasKey(rows, 'gaugeRadius')) {
    push('Applied:');
    push('  N/A (applied radius was not recorded)');
  } else {
    push('Applied:');
    push(statBlock(linearStats(rows.map((sample) => sample.gaugeRadius)), 2, ' px'));
  }
  const lastRadius = lastFinite(rows, (sample) => sample.gaugeRadius);
  push(lastRadius == null
    ? 'Last accepted radius: N/A'
    : `Last accepted radius: ${fmt(lastRadius, 2)} px`);
  push('');

  push('POSE DECISIONS');
  push('Pose quality is the dial-profile correlation for the proposed pose. A rejection is a proposed centre, radius, or rotation that was not applied. Pending means that proposal is waiting for another frame to agree. Applied steps are the pose change actually written on that frame.');
  if (!hasKey(rows, 'poseQuality')) {
    push('Pose quality: N/A (pose quality was not recorded)');
  } else {
    push('Pose quality:');
    push(statBlock(linearStats(rows.map((sample) => sample.poseQuality)), 3));
  }
  if (!hasKey(rows, 'poseRejectReason')) {
    push('Rejection reasons: N/A (pose rejection was not recorded)');
  } else {
    const reasons = new Map();
    rows.forEach((sample) => {
      const reason = sample.poseRejectReason || 'none';
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
    });
    push('Rejection reasons:');
    reasons.forEach((count, reason) => {
      push(`  ${reason}: ${count}`);
    });
  }
  if (!hasKey(rows, 'posePending')) {
    push('Pending confirmation: N/A (pose pending was not recorded)');
  } else {
    const pending = rows.filter((sample) => sample.posePending === true).length;
    push(`Pending confirmation: ${pending} of ${rows.length} samples (${fmtPct(pending, rows.length)})`);
  }
  if (!hasKey(rows, 'poseDeltaPx')) {
    push('Applied centre step: N/A (pose delta was not recorded)');
  } else {
    push(`Applied centre step min/max/mean/SD: ${deltaLine(rows.map((sample) => sample.poseDeltaPx), 2, 'px')}`);
  }
  if (!hasKey(rows, 'poseDeltaRot')) {
    push('Applied rotation step: N/A (pose delta was not recorded)');
  } else {
    push(`Applied rotation step min/max/mean/SD: ${deltaLine(rows.map((sample) => Math.abs(sample.poseDeltaRot)), 2, '°')}`);
  }
  push('');

  const rotationDeltas = reacquireRotationDeltas(rows);
  push('REACQUISITION');
  push('Searching is a separate gauge hunt. It does not write a new pose until the same dial is confirmed. Pending is a candidate waiting on more frames. none means that frame had no rejection.');
  push('Confirming frames count agreeing observations of the current candidate, including the first. Acceptance is the third observation. One non-matching frame can sit between them without clearing that count.');
  if (!hasKey(rows, 'trackMode')) {
    push('N/A (reacquisition was not recorded)');
  } else {
    const searching = rows.filter((sample) => sample.trackMode === 'searching').length;
    const locked = rows.filter((sample) => sample.trackMode === 'locked').length;
    push(`Locked samples: ${locked}`);
    push(`Searching samples: ${searching}`);
    const searchingWindow = rows
      .filter((sample) => sample.trackMode === 'searching')
      .map((sample) => sample.searchFraction);
    const windowStats = linearStats(searchingWindow);
    push(windowStats.n
      ? `Search window while searching: min ${fmt(windowStats.min, 2)}× / max ${fmt(windowStats.max, 2)}× radius`
      : 'Search window while searching: N/A');
    const accepted = rows.filter((sample) => sample.reacquireAccepted === true).length;
    push(`Reacquisition accepted: ${accepted}`);
    const reasons = new Map();
    rows.forEach((sample) => {
      const reason = sample.reacquireRejectReason || 'none';
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
    });
    push('Reacquisition results:');
    reasons.forEach((count, reason) => {
      push(`  ${reason}: ${count}`);
    });
    const hits = nums(rows.map((sample) => sample.reacquireHits));
    push(`Confirming frames max: ${hits.length ? Math.max(...hits) : 0}`);
    const candidateDistance = [];
    rows.forEach((sample) => {
      if (!finite(sample.reacquireCx) || !finite(sample.reacquireCy) || !finite(sample.gaugeX) || !finite(sample.gaugeY)) return;
      candidateDistance.push(Math.hypot(sample.reacquireCx - sample.gaugeX, sample.reacquireCy - sample.gaugeY));
    });
    const distance = linearStats(candidateDistance);
    push(distance.n
      ? `Candidate distance from applied centre min/max/mean: ${fmt(distance.min, 1)} / ${fmt(distance.max, 1)} / ${fmt(distance.mean, 1)} px`
      : 'Candidate distance from applied centre: N/A');
    const quality = linearStats(rows.map((sample) => sample.reacquireQuality));
    push(quality.n
      ? `Candidate quality min/max/mean: ${fmt(quality.min, 3)} / ${fmt(quality.max, 3)} / ${fmt(quality.mean, 3)}`
      : 'Candidate quality: N/A');
    push('Candidate centre X:');
    push(statBlock(linearStats(rows.map((sample) => sample.reacquireCx)), 1, ' px'));
    push('Candidate centre Y:');
    push(statBlock(linearStats(rows.map((sample) => sample.reacquireCy)), 1, ' px'));
    push('Candidate radius:');
    push(statBlock(linearStats(rows.map((sample) => sample.reacquireRadius)), 2, ' px'));
    push('Candidate rotation:');
    push(statBlock(circularStats(rows.map((sample) => sample.reacquireRotation)), 2, '°'));
    const signedDeltas = rotationDeltas.filter((value) => value != null);
    const deltaStats = linearStats(signedDeltas);
    push('Candidate rotation delta from last accepted pose:');
    push('Signed degrees from the previous applied rotation to the candidate. Positive is clockwise.');
    if (!deltaStats.n) {
      push('  N/A');
    } else {
      push(statBlock(deltaStats, 2, '°'));
    }
    const acceptedWithDelta = rows.filter((sample, index) => sample.reacquireAccepted === true && rotationDeltas[index] != null).length;
    const acceptedLarge = rows.filter((sample, index) => (
      sample.reacquireAccepted === true && rotationDeltas[index] != null && Math.abs(rotationDeltas[index]) > 30
    )).length;
    push(acceptedWithDelta
      ? `Accepted reacquisition |rotation delta| greater than 30°: ${acceptedLarge}`
      : 'Accepted reacquisition |rotation delta| greater than 30°: N/A');
  }
  push('');

  push('QUALITY');
  push('Needle score:');
  push(statBlock(linearStats(rows.map((sample) => sample.quality)), 3));
  push('Gauge confidence:');
  push(statBlock(linearStats(rows.map((sample) => sample.gaugeConfidence)), 3));
  push('Orientation score:');
  push(statBlock(linearStats(rows.map((sample) => sample.orientationConfidence)), 3));
  push('');

  push('CANDIDATES');
  push('Best candidate is the detector angle before temporal acceptance, in the gauge frame. Scores are the radial-segment score. Margin is (best - second) / best. Likeness is 1 for a long continuous segment that begins in the inner part of the needle window, and near 0 for a short outer mark or a face stroke that starts further out. Inner reach is 1 when that inner part of the window has needle evidence. Start radius is where the strong evidence begins, as a fraction of the gauge radius. Probe distance is the lateral offset, in pixels, where the winning ray looked like a narrow two-sided ridge. Coverage and continuity are the fraction of the window that responded and the longest unbroken run. Needle score is the margin, reduced when likeness is low. The 0.08 lost threshold is unchanged.');
  push('A sleeve or bezel boundary is a one-sided step and is not scored as a needle. A step inside 12° is smoothed. A larger step is accepted only when the score reaches the tracking threshold and likeness reaches the ridge gate. Above the smooth band that evidence has to repeat. jump-ambiguous means the ray was not strong enough. jump-unconfirmed means it was strong but had not repeated yet. pose-snap means the gauge pose was reacquired on that frame, so the needle candidate was not allowed to move pressure.');
  if (!hasKey(rows, 'candidateAngle')) {
    push('N/A (candidate fields were not recorded)');
  } else {
    push('Best candidate angle:');
    push(statBlock(circularStats(rows.map((sample) => sample.candidateAngle)), 2, '°'));
    push('Best candidate score:');
    push(statBlock(linearStats(rows.map((sample) => sample.candidateScore)), 3));
    push('Second-best candidate angle:');
    push(statBlock(circularStats(rows.map((sample) => sample.secondCandidateAngle)), 2, '°'));
    push('Second-best candidate score:');
    push(statBlock(linearStats(rows.map((sample) => sample.secondCandidateScore)), 3));
    push('Candidate-to-accepted |delta|:');
    push(statBlock(linearStats(rows.map((sample) => sample.candidateDelta)), 2, '°'));
    push('Candidate margin:');
    push(statBlock(linearStats(rows.map((sample) => sample.candidateMargin)), 3));
    push('Candidate likeness:');
    push(statBlock(linearStats(rows.map((sample) => sample.candidateLikeness)), 3));
    push(hasKey(rows, 'candidateInnerReach') ? 'Candidate inner reach:' : 'Candidate inner reach: N/A');
    if (hasKey(rows, 'candidateInnerReach')) {
      push(statBlock(linearStats(rows.map((sample) => sample.candidateInnerReach)), 3));
    }
    push(hasKey(rows, 'candidateCoverage') ? 'Candidate coverage:' : 'Candidate coverage: N/A');
    if (hasKey(rows, 'candidateCoverage')) {
      push(statBlock(linearStats(rows.map((sample) => sample.candidateCoverage)), 3));
    }
    push(hasKey(rows, 'candidateContinuity') ? 'Candidate continuity:' : 'Candidate continuity: N/A');
    if (hasKey(rows, 'candidateContinuity')) {
      push(statBlock(linearStats(rows.map((sample) => sample.candidateContinuity)), 3));
    }
    push(hasKey(rows, 'candidateStartRadius') ? 'Candidate start radius:' : 'Candidate start radius: N/A');
    if (hasKey(rows, 'candidateStartRadius')) {
      push(statBlock(linearStats(rows.map((sample) => sample.candidateStartRadius)), 3));
    }
    push(hasKey(rows, 'candidateProbePx') ? 'Candidate probe distance:' : 'Candidate probe distance: N/A');
    if (hasKey(rows, 'candidateProbePx')) {
      push(statBlock(linearStats(rows.map((sample) => sample.candidateProbePx)), 2, ' px'));
    }
    const mode = separationMode(rows);
    push(mode
      ? `Best-to-second separation mode: ${mode.mode}° on ${mode.count} of ${mode.total} frames (${((mode.count / mode.total) * 100).toFixed(1)}%), binned to 5°.`
      : 'Best-to-second separation mode: N/A');
  }
  if (!hasKey(rows, 'needleDecision')) {
    push('Needle decisions: N/A (needle decision was not recorded)');
  } else {
    const decisions = new Map();
    rows.forEach((sample) => {
      const decision = sample.needleDecision || 'none';
      decisions.set(decision, (decisions.get(decision) || 0) + 1);
    });
    push('Needle decisions:');
    decisions.forEach((count, decision) => {
      push(`  ${decision}: ${count}`);
    });
  }
  if (!hasKey(rows, 'candidateJump')) {
    push('Candidate jump: N/A (candidate jump was not recorded)');
  } else {
    push('Candidate jump from the last accepted angle:');
    push('Signed degrees. Positive is clockwise in the gauge frame. This is the step the acceptance gate saw, before smoothing.');
    push(statBlock(linearStats(rows.map((sample) => sample.candidateJump)), 2, '°'));
  }
  push('');

  const states = ['TRACKING', 'UNCERTAIN', 'LOST', 'CALIBRATING'];
  push('STATE');
  push('Duration is the sum of gaps from a sample in that state to the next sample. The last sample is counted but adds no duration.');
  states.forEach((state) => {
    const count = rows.filter((sample) => sample.tracking === state).length;
    push(`${state}:`);
    push(`  Samples: ${count}`);
    push(`  Approx duration: ${fmt(gapMs(rows, (sample) => sample.tracking === state) / 1000, 2)} s`);
  });
  if (!hasKey(rows, 'trackMode')) {
    push('SEARCHING:');
    push('  N/A (track mode was not recorded)');
  } else {
    const searchingCount = rows.filter((sample) => sample.trackMode === 'searching').length;
    push('SEARCHING:');
    push(`  Samples: ${searchingCount}`);
    push(`  Approx duration: ${fmt(gapMs(rows, (sample) => sample.trackMode === 'searching') / 1000, 2)} s`);
    push('  Gauge track mode. A searching sample is also counted in its pressure state above.');
  }
  push('');

  const pairs = [
    ['TRACKING', 'UNCERTAIN'],
    ['UNCERTAIN', 'TRACKING'],
    ['TRACKING', 'LOST'],
    ['LOST', 'TRACKING'],
    ['UNCERTAIN', 'LOST'],
    ['LOST', 'UNCERTAIN'],
  ];
  push('STATE TRANSITIONS');
  pairs.forEach(([from, to]) => {
    push(`${from} → ${to}: ${countTransition(rows, from, to, (sample) => sample.tracking)}`);
  });
  const listed = new Set(pairs.map(([from, to]) => `${from}→${to}`));
  const extras = new Map();
  for (let i = 1; i < rows.length; i += 1) {
    const from = rows[i - 1].tracking;
    const to = rows[i].tracking;
    if (!from || !to || from === to) continue;
    const key = `${from}→${to}`;
    if (listed.has(key)) continue;
    extras.set(key, (extras.get(key) || 0) + 1);
  }
  extras.forEach((count, key) => {
    const [from, to] = key.split('→');
    push(`${from} → ${to}: ${count}`);
  });
  push('');

  const events = [];
  let sawCalibrating = false;
  let announcedCalibration = false;
  let previousAcceptedAngle = null;
  let previousMeasuredPressure = null;
  rows.forEach((sample, index) => {
    if (sample.tracking === 'CALIBRATING') sawCalibrating = true;
    if (!announcedCalibration && sawCalibrating && sample.tracking && sample.tracking !== 'CALIBRATING') {
      announcedCalibration = true;
      events.push({ t: sample.t, text: 'Calibration complete' });
    }
    if (index > 0) {
      const previous = rows[index - 1];
      if (overlayVisible(previous) !== overlayVisible(sample)) {
        events.push({
          t: sample.t,
          text: overlayVisible(sample) ? 'Needle valid again' : 'Needle became invalid',
        });
      }
      if (previous.tracking && sample.tracking && previous.tracking !== sample.tracking) {
        events.push({ t: sample.t, text: `State ${previous.tracking} → ${sample.tracking}` });
      }
      if (sample.angleAccepted === true && finite(sample.relativeAngle) && finite(previousAcceptedAngle)) {
        const step = Math.abs(wrapDelta(previousAcceptedAngle, sample.relativeAngle));
        if (step > REST_MAX_SPREAD_DEG) {
          const detail = [];
          if (finite(sample.candidateLikeness)) detail.push(`likeness ${sample.candidateLikeness.toFixed(2)}`);
          if (finite(sample.candidateInnerReach)) detail.push(`inner reach ${sample.candidateInnerReach.toFixed(2)}`);
          if (finite(sample.candidateStartRadius)) detail.push(`start ${sample.candidateStartRadius.toFixed(2)}R`);
          if (finite(sample.candidateMargin)) detail.push(`margin ${sample.candidateMargin.toFixed(2)}`);
          if (finite(sample.confirmationHits) && sample.confirmationHits > 0) detail.push(`${sample.confirmationHits} confirming frames`);
          if (finite(sample.poseAge)) detail.push(`pose age ${sample.poseAge}`);
          const suffix = detail.length ? ` (${detail.join(', ')})` : '';
          events.push({ t: sample.t, text: `Accepted relative angle changed ${step.toFixed(1)}°${suffix}` });
        }
      }
      if (
        sample.angleAccepted !== true
        && finite(sample.candidateJump)
        && Math.abs(sample.candidateJump) > REST_MAX_SPREAD_DEG
        && sample.needleDecision
        && sample.needleDecision !== 'held-gauge'
        && sample.needleDecision !== 'held-weak'
        && sample.needleDecision !== 'calibrating'
        && sample.needleDecision !== previous.needleDecision
      ) {
        const parts = [`Held needle candidate ${sample.candidateJump >= 0 ? '+' : ''}${sample.candidateJump.toFixed(1)}° (${sample.needleDecision})`];
        if (finite(sample.candidateLikeness)) parts.push(`likeness ${sample.candidateLikeness.toFixed(2)}`);
        if (finite(sample.candidateInnerReach)) parts.push(`inner reach ${sample.candidateInnerReach.toFixed(2)}`);
        if (finite(sample.candidateStartRadius)) parts.push(`start ${sample.candidateStartRadius.toFixed(2)}R`);
        if (finite(sample.candidateMargin)) parts.push(`margin ${sample.candidateMargin.toFixed(2)}`);
        if (finite(sample.quality)) parts.push(`score ${sample.quality.toFixed(2)}`);
        if (finite(sample.poseAge)) parts.push(`pose age ${sample.poseAge}`);
        events.push({ t: sample.t, text: parts.join(', ') });
      }
      if (finite(previous.gaugeX) && finite(previous.gaugeY) && finite(sample.gaugeX) && finite(sample.gaugeY) && finite(sample.gaugeRadius)) {
        const step = Math.hypot(sample.gaugeX - previous.gaugeX, sample.gaugeY - previous.gaugeY);
        if (step > sample.gaugeRadius * CENTRE_EVENT_FRACTION) {
          events.push({ t: sample.t, text: `Applied centre moved ${step.toFixed(1)} px` });
        }
      }
      if (finite(previous.gaugeRotation) && finite(sample.gaugeRotation)) {
        const step = Math.abs(wrapDelta(previous.gaugeRotation, sample.gaugeRotation));
        if (step >= ROTATION_EVENT_DEG) {
          events.push({ t: sample.t, text: `Applied rotation changed ${step.toFixed(1)}°` });
        }
      }
      if (previous.trackMode !== 'searching' && sample.trackMode === 'searching') {
        events.push({ t: sample.t, text: 'Reacquisition started' });
      }
      if (sample.reacquireAccepted === true) {
        const moved = finite(previous.gaugeX) && finite(previous.gaugeY) && finite(sample.gaugeX) && finite(sample.gaugeY)
          ? Math.hypot(sample.gaugeX - previous.gaugeX, sample.gaugeY - previous.gaugeY)
          : null;
        const parts = ['Reacquisition accepted'];
        if (moved != null) parts.push(`centre moved ${moved.toFixed(1)} px`);
        if (finite(sample.reacquireQuality)) parts.push(`quality ${sample.reacquireQuality.toFixed(3)}`);
        if (rotationDeltas[index] != null) parts.push(`rotation Δ ${rotationDeltas[index].toFixed(1)}° from last accepted`);
        events.push({ t: sample.t, text: parts.join('; ') });
      } else if (sample.reacquireRejectReason === 'reacquire-pending' && previous.reacquireRejectReason !== 'reacquire-pending') {
        const gap = finite(sample.reacquireCx) && finite(sample.reacquireCy) && finite(sample.gaugeX) && finite(sample.gaugeY)
          ? Math.hypot(sample.reacquireCx - sample.gaugeX, sample.reacquireCy - sample.gaugeY)
          : null;
        const parts = [`Reacquisition candidate pending confirmation (${sample.reacquireHits || 1} of 3 agreeing observations)`];
        if (gap != null) parts.push(`${gap.toFixed(1)} px from applied`);
        if (finite(sample.reacquireQuality)) parts.push(`quality ${sample.reacquireQuality.toFixed(3)}`);
        events.push({ t: sample.t, text: parts.join('; ') });
      } else if (
        sample.reacquireRejectReason
        && sample.reacquireRejectReason !== 'reacquire-pending'
        && sample.reacquireRejectReason !== previous.reacquireRejectReason
      ) {
        events.push({ t: sample.t, text: `Reacquisition candidate rejected (${sample.reacquireRejectReason})` });
      }
      if (sample.poseRejectReason) {
        const rotationGap = finite(sample.gaugeRotation) && finite(sample.rawRotation)
          ? Math.abs(wrapDelta(sample.gaugeRotation, sample.rawRotation))
          : 0;
        const centreGap = finite(sample.gaugeX) && finite(sample.gaugeY) && finite(sample.rawGaugeX) && finite(sample.rawGaugeY)
          ? Math.hypot(sample.rawGaugeX - sample.gaugeX, sample.rawGaugeY - sample.gaugeY)
          : 0;
        const centreLimit = finite(sample.gaugeRadius) ? sample.gaugeRadius * CENTRE_EVENT_FRACTION : Infinity;
        if (rotationGap >= ROTATION_EVENT_DEG || centreGap > centreLimit) {
          const parts = [`Pose rejected (${sample.poseRejectReason})`];
          if (rotationGap >= ROTATION_EVENT_DEG) parts.push(`raw rotation ${rotationGap.toFixed(1)}° from applied`);
          if (centreGap > centreLimit) parts.push(`raw centre ${centreGap.toFixed(1)} px from applied`);
          if (sample.posePending === true) parts.push('pending confirmation');
          events.push({ t: sample.t, text: parts.join('; ') });
        }
      }
    }
    if (sample.angleAccepted === true && finite(sample.relativeAngle)) previousAcceptedAngle = sample.relativeAngle;
    if (sample.pressureMeasured === true && finite(sample.rawPressure)) {
      if (previousMeasuredPressure != null && previousMeasuredPressure < PRESSURE_NEAR_ZERO_BAR && sample.rawPressure >= EXTRACTION_START_BAR) {
        events.push({ t: sample.t, text: `Measured pressure entered the ${EXTRACTION_START_BAR} bar range (${sample.rawPressure.toFixed(2)} bar)` });
      }
      previousMeasuredPressure = sample.rawPressure;
    }
  });

  push('EVENTS');
  push(`Thresholds: accepted relative-angle step above ${REST_MAX_SPREAD_DEG}°; applied centre step above ${CENTRE_EVENT_FRACTION * 100}% of applied radius; applied rotation step at least ${ROTATION_EVENT_DEG}°; measured pressure from below ${PRESSURE_NEAR_ZERO_BAR} bar to at least ${EXTRACTION_START_BAR} bar. A pose rejection is listed when the raw rotation is at least ${ROTATION_EVENT_DEG}° from the applied rotation, or the raw centre is more than ${CENTRE_EVENT_FRACTION * 100}% of the radius from the applied centre.`);
  if (!events.length) push('None.');
  events.forEach((event) => {
    push(`${clockOffset(start, event.t)}  ${event.text}`);
  });
  push('');

  const trackingCount = rows.filter((sample) => sample.tracking === 'TRACKING').length;
  const uncertainCount = rows.filter((sample) => sample.tracking === 'UNCERTAIN').length;
  const lostCount = rows.filter((sample) => sample.tracking === 'LOST').length;
  const needleMean = linearStats(rows.map((sample) => sample.quality)).mean;
  const confidenceMean = linearStats(rows.map((sample) => sample.gaugeConfidence)).mean;

  push('SUMMARY');
  push(`Pressure SD: ${pressureStats ? fmt(pressureStats.sd, 3) : 'N/A'}`);
  push(`Needle raw angle SD: ${fmt(screen.sd, 2)}`);
  push(`Needle relative angle SD: ${fmt(relative.sd, 2)}`);
  push(`Needle smoothed angle SD: ${fmt(smoothed.sd, 2)}`);
  push(`Needle detection rate: ${fmtPct(visibleCount, rows.length)}`);
  push(`Gauge applied centre SD: ${fmt(centreSpread(rows, (sample) => sample.gaugeX, (sample) => sample.gaugeY), 2)}`);
  push(`Gauge applied rotation SD: ${fmt(circularStats(rows.map((sample) => sample.gaugeRotation)).sd, 2)}`);
  push(`Needle score mean: ${fmt(needleMean, 3)}`);
  push(`Gauge confidence mean: ${fmt(confidenceMean, 3)}`);
  push(`TRACKING %: ${fmtPct(trackingCount, rows.length)}`);
  push(`UNCERTAIN %: ${fmtPct(uncertainCount, rows.length)}`);
  push(`LOST %: ${fmtPct(lostCount, rows.length)}`);
  push(`Needle valid→invalid transitions: ${countTransition(rows, true, false, overlayVisible)}`);
  push(`Needle invalid→valid transitions: ${countTransition(rows, false, true, overlayVisible)}`);
  if (hasKey(rows, 'candidateDelta')) {
    push(`Candidate-to-accepted delta mean: ${fmt(linearStats(rows.map((sample) => sample.candidateDelta)).mean, 2)}`);
  }
  const mode = separationMode(rows);
  if (mode) push(`Best-to-second separation mode: ${mode.mode}° (${((mode.count / mode.total) * 100).toFixed(1)}%)`);
  if (hasKey(rows, 'poseRejectReason')) {
    const rejected = rows.filter((sample) => sample.poseRejectReason).length;
    push(`Pose rejections: ${rejected} (${fmtPct(rejected, rows.length)})`);
  }
  if (hasKey(rows, 'posePending')) {
    const pending = rows.filter((sample) => sample.posePending === true).length;
    push(`Pose pending: ${pending} (${fmtPct(pending, rows.length)})`);
  }
  if (hasKey(rows, 'trackMode')) {
    const searching = rows.filter((sample) => sample.trackMode === 'searching').length;
    const accepted = rows.filter((sample) => sample.reacquireAccepted === true).length;
    push(`Searching: ${fmtPct(searching, rows.length)}`);
    push(`Reacquisition accepted: ${accepted}`);
  }

  return lines.join('\n');
}
