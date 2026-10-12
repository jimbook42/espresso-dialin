/**
 * Empirical Niche Zero dial learning from comparable logged shots.
 * Estimates local seconds-per-mark from the user's own data; no fixed global sensitivity.
 */

import {
  NICHE_ZERO_DIAL_MIN,
  NICHE_ZERO_DIAL_MAX,
  parseNicheZeroSetting,
} from './nicheZero.js';

export const NICHE_LEARNING_MIN_OBSERVATIONS = 3;
export const NICHE_LEARNING_MIN_PAIRS = 2;
export const NICHE_MIN_SETTING_SPREAD = 0.35;
export const NICHE_MAX_SINGLE_ADJUSTMENT = 3;
export const NICHE_MIN_ABS_SECONDS_PER_MARK = 0.4;
export const NICHE_MAX_ABS_SECONDS_PER_MARK = 18;
export const NICHE_MAX_RESIDUAL_STD = 4.5;

function clampDial(n) {
  return Math.round(Math.min(NICHE_ZERO_DIAL_MAX, Math.max(NICHE_ZERO_DIAL_MIN, n)) * 10) / 10;
}

/**
 * @param {Array<{ dial: number, timeS: number, weight: number }>} points
 */
export function estimateSecondsPerMark(points) {
  const slopes = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      const dDial = b.dial - a.dial;
      if (Math.abs(dDial) < NICHE_MIN_SETTING_SPREAD) continue;
      const dTime = b.timeS - a.timeS;
      const slope = dTime / dDial;
      if (!Number.isFinite(slope)) continue;
      const w = (a.weight + b.weight) / 2;
      slopes.push({ slope, weight: w, dDial });
    }
  }
  if (slopes.length < NICHE_LEARNING_MIN_PAIRS) {
    return { secondsPerMark: null, pairCount: slopes.length, spreadOk: false };
  }

  const finerCoarserSign = slopes.map((s) => (s.slope < 0 ? -1 : s.slope > 0 ? 1 : 0));
  const pos = finerCoarserSign.filter((x) => x > 0).length;
  const neg = finerCoarserSign.filter((x) => x < 0).length;
  if (pos > 0 && neg > 0) {
    return { secondsPerMark: null, pairCount: slopes.length, spreadOk: true, contradictory: true };
  }

  let weightedSum = 0;
  let weightTotal = 0;
  for (const s of slopes) {
    weightedSum += s.slope * s.weight;
    weightTotal += s.weight;
  }
  const secondsPerMark = weightTotal > 0 ? weightedSum / weightTotal : null;
  if (secondsPerMark === null || !Number.isFinite(secondsPerMark)) {
    return { secondsPerMark: null, pairCount: slopes.length, spreadOk: true };
  }
  const abs = Math.abs(secondsPerMark);
  if (abs < NICHE_MIN_ABS_SECONDS_PER_MARK || abs > NICHE_MAX_ABS_SECONDS_PER_MARK) {
    return { secondsPerMark: null, pairCount: slopes.length, spreadOk: true, implausible: true };
  }

  const mean = secondsPerMark;
  let varSum = 0;
  let varN = 0;
  for (const s of slopes) {
    varSum += (s.slope - mean) ** 2;
    varN += 1;
  }
  const std = varN > 1 ? Math.sqrt(varSum / varN) : 0;
  if (std > NICHE_MAX_RESIDUAL_STD) {
    return { secondsPerMark: null, pairCount: slopes.length, spreadOk: true, noisy: true };
  }

  const dialSpread = Math.max(...points.map((p) => p.dial)) - Math.min(...points.map((p) => p.dial));
  return {
    secondsPerMark,
    pairCount: slopes.length,
    spreadOk: dialSpread >= NICHE_MIN_SETTING_SPREAD,
    residualStd: std,
  };
}

/**
 * @param {object} params
 * @param {number} params.currentDial
 * @param {number} params.actualTime
 * @param {number} params.targetMin
 * @param {number} params.targetMax
 * @param {string} params.tasteProfile
 * @param {boolean} params.severeChoke
 * @param {boolean} params.isTimeInRange
 * @param {Array<object>} params.comparableShots - newest-first comparable history including current conditions context
 */
export function recommendNicheZeroFromEvidence(params) {
  const {
    currentDial,
    actualTime,
    targetMin,
    targetMax,
    tasteProfile,
    severeChoke,
    isTimeInRange,
    comparableShots = [],
    currentObservation = null,
  } = params;

  const targetMid = (targetMin + targetMax) / 2;
  const timeDelta = actualTime - targetMid;

  const points = [];
  const seenKeys = new Set();
  if (currentObservation) {
    const dial = parseNicheZeroSetting(currentObservation.nicheZeroSetting ?? currentDial);
    const timeS = Number(currentObservation.actualTimeS ?? actualTime);
    if (dial !== null && Number.isFinite(timeS)) {
      const key = `${dial}|${timeS}|current`;
      seenKeys.add(key);
      points.push({ dial, timeS, weight: 1.15 });
    }
  }
  comparableShots.forEach((s, idx) => {
    const dial = parseNicheZeroSetting(s.nicheZeroSetting);
    const timeS = Number(s.actualTimeS ?? s.actualTime ?? NaN);
    if (dial === null || !Number.isFinite(timeS)) return;
    const key = `${dial}|${timeS}|${s.timestamp || idx}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    const weight = Math.pow(0.85, idx);
    points.push({ dial, timeS, weight });
  });

  if (points.length < NICHE_LEARNING_MIN_OBSERVATIONS) {
    return {
      ok: false,
      reasonCode: 'insufficient_observations',
      recommendedDial: currentDial,
      shift: 0,
    };
  }

  const { secondsPerMark, spreadOk, contradictory, implausible, noisy, pairCount } =
    estimateSecondsPerMark(points);

  if (!spreadOk || secondsPerMark === null) {
    return {
      ok: false,
      reasonCode: contradictory
        ? 'contradictory_response'
        : implausible
          ? 'implausible_slope'
          : noisy
            ? 'noisy_response'
            : 'insufficient_variation',
      recommendedDial: currentDial,
      shift: 0,
      pairCount,
    };
  }

  let dialShift = -timeDelta / secondsPerMark;
  if (!Number.isFinite(dialShift)) {
    return { ok: false, reasonCode: 'invalid_prediction', recommendedDial: currentDial, shift: 0 };
  }

  if (severeChoke) {
    const windowS = Math.max(targetMax - targetMin, 1);
    const coarseNeed = Math.max(1.5, windowS / Math.abs(secondsPerMark));
    dialShift = Math.max(dialShift, coarseNeed);
  } else if (isTimeInRange) {
    if (tasteProfile === 'very_sour') dialShift -= 1.2;
    else if (tasteProfile === 'sour') dialShift -= 0.6;
    else if (tasteProfile === 'bitter') dialShift += 0.6;
    else if (tasteProfile === 'very_bitter') dialShift += 1.2;
    else dialShift = 0;
  }

  if (Math.abs(dialShift) > NICHE_MAX_SINGLE_ADJUSTMENT) {
    return {
      ok: false,
      reasonCode: 'excessive_adjustment',
      recommendedDial: currentDial,
      shift: 0,
      attemptedShift: dialShift,
      secondsPerMark,
    };
  }

  if (dialShift !== 0 && Math.abs(dialShift) < 0.05) {
    dialShift = timeDelta < 0 ? -0.1 : timeDelta > 0 ? 0.1 : 0;
  }

  const rawTarget = currentDial + dialShift;
  if (rawTarget <= NICHE_ZERO_DIAL_MIN || rawTarget >= NICHE_ZERO_DIAL_MAX) {
    const clamped = clampDial(rawTarget);
    if (clamped === currentDial) {
      return {
        ok: false,
        reasonCode: 'boundary',
        recommendedDial: currentDial,
        shift: 0,
        secondsPerMark,
      };
    }
  }

  const recommendedDial = clampDial(rawTarget);
  const shift = Math.round((recommendedDial - currentDial) * 10) / 10;
  if (shift === 0 && !severeChoke && isTimeInRange && (tasteProfile === 'good' || tasteProfile === 'balanced')) {
    return {
      ok: true,
      recommendedDial: currentDial,
      shift: 0,
      secondsPerMark,
      keepGrind: true,
    };
  }

  return {
    ok: true,
    recommendedDial,
    shift,
    secondsPerMark,
    pairCount,
  };
}

/** Empirical failure codes that should not block a separate timing-based numeric step. */
const TIMING_BOUNDED_UNRELIABLE_CODES = new Set([]);

/**
 * Conservative numeric step from shot time / taste when empirical learning is not yet reliable.
 */
export function recommendNicheTimingBounded(params) {
  const {
    currentDial,
    actualTime,
    targetMin,
    targetMax,
    tasteProfile,
    severeChoke,
    isTimeInRange,
  } = params;
  const targetMid = (targetMin + targetMax) / 2;
  const timeDelta = actualTime - targetMid;
  const halfWindow = Math.max((targetMax - targetMin) / 2, 1);

  let shift = 0;
  if (severeChoke) {
    shift = Math.min(NICHE_MAX_SINGLE_ADJUSTMENT, 2);
  } else if (!isTimeInRange && Math.abs(timeDelta) >= 0.25) {
    const magnitude = Math.min(
      NICHE_MAX_SINGLE_ADJUSTMENT,
      Math.max(0.5, Math.abs(timeDelta) / halfWindow)
    );
    shift = timeDelta > 0 ? magnitude : -magnitude;
  } else if (isTimeInRange) {
    if (tasteProfile === 'very_sour') shift = -1;
    else if (tasteProfile === 'sour') shift = -0.5;
    else if (tasteProfile === 'bitter') shift = 0.5;
    else if (tasteProfile === 'very_bitter') shift = 1;
    else return { ok: false };
  } else {
    return { ok: false };
  }

  if (shift === 0) return { ok: false };
  const recommendedDial = clampDial(currentDial + shift);
  const appliedShift = Math.round((recommendedDial - currentDial) * 10) / 10;
  if (appliedShift === 0) return { ok: false };
  return { ok: true, recommendedDial, shift: appliedShift };
}

export function buildNicheTimingBoundedReason({ recommendedDial, shift, empiricalUnavailable }) {
  const dir = shift < 0 ? 'finer' : 'coarser';
  const detail = empiricalUnavailable
    ? 'timing-based step until more comparable dial history is available'
    : 'timing-based step';
  return `Set dial to ${recommendedDial} (${Math.abs(shift)} mark${Math.abs(shift) === 1 ? '' : 's'} ${dir}) — ${detail}.`;
}

export function buildNicheEmpiricalReason({ currentDial, recommendedDial, shift, secondsPerMark, keepGrind }) {
  if (keepGrind) return 'KEEP GRIND — Balanced and in range.';
  const dir = shift < 0 ? 'finer (lower number)' : 'coarser (higher number)';
  const absShift = Math.abs(shift);
  const perMark = Math.abs(secondsPerMark).toFixed(1);
  if (absShift < 0.05) return 'KEEP GRIND — Balanced and in range.';
  return `Set dial to ${recommendedDial} (${absShift} mark${absShift === 1 ? '' : 's'} ${dir}) — estimated from your comparable Niche shots (~${perMark}s per mark locally).`;
}

export function buildNicheFallbackReason({
  severeChoke,
  isTimeInRange,
  tasteProfile,
  timeDelta,
  reasonCode,
}) {
  if (reasonCode === 'insufficient_observations' || reasonCode === 'insufficient_variation') {
    if (severeChoke) {
      return 'SEVERE CHOKE — Grind substantially coarser (higher dial number). Not enough comparable Niche history to size the step numerically.';
    }
    if (isTimeInRange) {
      if (tasteProfile === 'very_sour' || tasteProfile === 'sour') {
        return 'Shot is in range but tastes sour — consider grinding finer (lower dial number). Log more comparable shots to unlock numeric dial suggestions.';
      }
      if (tasteProfile === 'bitter' || tasteProfile === 'very_bitter') {
        return 'Shot is in range but tastes bitter — consider grinding coarser (higher dial number). Log more comparable shots to unlock numeric dial suggestions.';
      }
      return 'KEEP GRIND — Balanced and in range.';
    }
    const secOff = Math.abs(Math.round(timeDelta));
    if (timeDelta < 0) {
      return `Shot was ${secOff}s fast — consider grinding finer (lower dial number). Log more comparable shots at different dial positions to unlock numeric suggestions.`;
    }
    return `Shot was ${secOff}s slow — consider grinding coarser (higher dial number). Log more comparable shots at different dial positions to unlock numeric suggestions.`;
  }
  if (reasonCode === 'contradictory_response' || reasonCode === 'noisy_response') {
    return 'Comparable Niche shots disagree on how the dial affects time — keeping your current dial until the pattern is clearer.';
  }
  if (reasonCode === 'excessive_adjustment' || reasonCode === 'implausible_slope') {
    return 'Learned dial response looks unreliable for this recipe — keeping your current dial. Try a smaller manual change and log the result.';
  }
  if (reasonCode === 'boundary') {
    return 'Recommendation would move past the dial limit — adjust manually in small steps at the boundary.';
  }
  return 'Insufficient reliable Niche history for a numeric dial step — qualitative timing guidance only.';
}

export { TIMING_BOUNDED_UNRELIABLE_CODES };
