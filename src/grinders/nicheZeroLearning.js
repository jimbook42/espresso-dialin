/**
 * Empirical Niche Zero dial learning from comparable logged shots.
 * Estimates local seconds-per-mark from the user's own data; no fixed global sensitivity.
 */

import { isBalancedTaste } from '../utils/tasteProfile.js';
import {
  NICHE_ZERO_DIAL_MIN,
  NICHE_ZERO_DIAL_MAX,
  parseNicheZeroSetting,
  clampNicheZeroDial,
} from './nicheZero.js';

export const NICHE_LEARNING_MIN_OBSERVATIONS = 3;
export const NICHE_LEARNING_MIN_PAIRS = 2;
export const NICHE_MIN_SETTING_SPREAD = 0.35;
export const NICHE_MAX_SINGLE_ADJUSTMENT = 3;
export const NICHE_MIN_ABS_SECONDS_PER_MARK = 0.4;
export const NICHE_MAX_ABS_SECONDS_PER_MARK = 18;
export const NICHE_MAX_RESIDUAL_STD = 4.5;

function learningPointsFromShots({
  currentDial,
  actualTime,
  comparableShots = [],
  currentObservation = null,
}) {
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
  return points;
}

function nicheLearningDiagnostics(points, estimate = null) {
  const observationCount = points.length;
  const dialSpread =
    observationCount > 0
      ? Math.max(...points.map((p) => p.dial)) - Math.min(...points.map((p) => p.dial))
      : 0;
  const est = estimate ?? estimateSecondsPerMark(points);
  return {
    observationCount,
    dialSpread: Math.round(dialSpread * 10) / 10,
    pairCount: est.pairCount ?? 0,
    spreadOk: est.spreadOk ?? false,
  };
}

function defaultClampDial(n, settings = null) {
  return clampNicheZeroDial(n, settings);
}

function resolveClampDial(params) {
  if (typeof params?.clampDial === 'function') {
    return (n) => params.clampDial(n);
  }
  const settings = params?.settings ?? null;
  return (n) => defaultClampDial(n, settings);
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
  const clampDial = resolveClampDial(params);

  const targetMid = (targetMin + targetMax) / 2;
  const timeDelta = actualTime - targetMid;

  const points = learningPointsFromShots({
    currentDial,
    actualTime,
    comparableShots,
    currentObservation,
  });

  if (points.length < NICHE_LEARNING_MIN_OBSERVATIONS) {
    return {
      ok: false,
      reasonCode: 'insufficient_observations',
      recommendedDial: currentDial,
      shift: 0,
      diagnostics: nicheLearningDiagnostics(points),
    };
  }

  const { secondsPerMark, spreadOk, contradictory, implausible, noisy, pairCount } =
    estimateSecondsPerMark(points);
  const diagnostics = nicheLearningDiagnostics(points, {
    secondsPerMark,
    spreadOk,
    pairCount,
  });

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
      diagnostics,
    };
  }

  let dialShift = timeDelta / secondsPerMark;
  if (!Number.isFinite(dialShift)) {
    return {
      ok: false,
      reasonCode: 'invalid_prediction',
      recommendedDial: currentDial,
      shift: 0,
      diagnostics,
    };
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
      diagnostics,
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
        diagnostics,
      };
    }
  }

  const recommendedDial = clampDial(rawTarget);
  const shift = Math.round((recommendedDial - currentDial) * 10) / 10;
  if (shift === 0 && !severeChoke && isTimeInRange && isBalancedTaste(tasteProfile)) {
    return {
      ok: true,
      recommendedDial: currentDial,
      shift: 0,
      secondsPerMark,
      keepGrind: true,
      diagnostics,
    };
  }

  return {
    ok: true,
    recommendedDial,
    shift,
    secondsPerMark,
    pairCount,
    diagnostics,
  };
}

/**
 * User-facing note for why empirical dial learning is not active (from model reason codes).
 */
export function buildNicheLearningTransparencyNote(
  reasonCode,
  diagnostics = {},
  { recipeComparableCount = 0, grinderLearningShotCount = 0 } = {}
) {
  const { dialSpread = 0 } = diagnostics;
  if (reasonCode === 'insufficient_observations') {
    if (recipeComparableCount >= NICHE_LEARNING_MIN_OBSERVATIONS) {
      return null;
    }
    if (recipeComparableCount === 0 && grinderLearningShotCount > 0) {
      return 'Dial learning needs shots logged at this recipe’s dose, yield, and target time (and Flair profile when enabled). None of your saved shots match yet.';
    }
    return `Need at least ${NICHE_LEARNING_MIN_OBSERVATIONS} comparable dial/time observations for this recipe — you have ${recipeComparableCount}.`;
  }
  if (reasonCode === 'insufficient_variation') {
    return `Comparable shots use nearly the same dial (spread ${dialSpread} marks; need about ${NICHE_MIN_SETTING_SPREAD}+). Try a few settings further apart and log the times.`;
  }
  if (reasonCode === 'contradictory_response') {
    return 'Your comparable shots disagree on whether a coarser dial speeds up or slows down the shot — log a few more consistent pulls before numeric learning can activate.';
  }
  if (reasonCode === 'noisy_response') {
    return 'The dial/time pattern in your comparable shots is too inconsistent for a reliable local estimate.';
  }
  if (reasonCode === 'implausible_slope') {
    return 'The inferred seconds-per-mark from your history looks unrealistic for this recipe — verify dial readings and shot times, then log again.';
  }
  if (reasonCode === 'excessive_adjustment') {
    return 'A learned dial step would be larger than the app allows in one move — adjust manually in smaller steps and log results.';
  }
  if (reasonCode === 'boundary') {
    return 'A learned recommendation would hit the dial limit — adjust manually at the boundary.';
  }
  return null;
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
  const clampDial = resolveClampDial(params);
  const targetMid = (targetMin + targetMax) / 2;
  const timeDelta = actualTime - targetMid;
  const halfWindow = Math.max((targetMax - targetMin) / 2, 1);

  let shift;
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

/** Shown in the Dial-in UI whenever empirical learning produces the active recommendation. */
export const NICHE_EMPIRICAL_VALIDATION_NOTE =
  'Personalised estimate from your shots, not yet validated against real-world use.';

export function buildNicheTimingBoundedReason({ recommendedDial, shift, empiricalUnavailable }) {
  const dir = shift < 0 ? 'finer' : 'coarser';
  const detail = empiricalUnavailable
    ? 'timing-based step until local dial learning is reliable'
    : 'timing-based step';
  return `Set dial to ${recommendedDial} (${Math.abs(shift)} mark${Math.abs(shift) === 1 ? '' : 's'} ${dir}) — ${detail}.`;
}

export function buildNicheEmpiricalReason({ recommendedDial, shift, secondsPerMark, keepGrind }) {
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
    if (isTimeInRange && isBalancedTaste(tasteProfile) && !severeChoke) {
      return 'KEEP GRIND — Balanced and in range.';
    }
    return 'Comparable Niche shots disagree on how the dial affects time — keeping your current dial until the pattern is clearer.';
  }
  if (reasonCode === 'excessive_adjustment' || reasonCode === 'implausible_slope') {
    if (isTimeInRange && isBalancedTaste(tasteProfile) && !severeChoke) {
      return 'KEEP GRIND — Balanced and in range.';
    }
    return 'Learned dial response looks unreliable for this recipe — keeping your current dial. Try a smaller manual change and log the result.';
  }
  if (reasonCode === 'boundary') {
    return 'Recommendation would move past the dial limit — adjust manually in small steps at the boundary.';
  }
  return 'Insufficient reliable Niche history for a numeric dial step — qualitative timing guidance only.';
}

export { TIMING_BOUNDED_UNRELIABLE_CODES };
