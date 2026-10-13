import { getRecommendationGrinderProfile, isNicheZeroGrinderModel } from '../grinders/grinderRegistry.js';
import { parseNicheZeroSetting } from '../grinders/nicheZero.js';
import { isBalancedTaste } from './tasteProfile.js';

function shotEligibleForLearning(shot) {
  return shot?.excludeFromLearning !== true;
}

/** Absolute shot times treated as unreliable for full grind moves. */
export const OUTLIER_ABSOLUTE_MIN_S = 15;
export const OUTLIER_ABSOLUTE_MAX_S = 45;

/** Deviation from expected time at a similar grind (seconds). */
export const OUTLIER_NEAR_SETTING_DEVIATION_S = 10;

/** Grind numeric distance considered "same setting" for expectation checks. */
const NEAR_GRIND_NUMERIC_TOLERANCE = {
  sette: 2,
  sunbeam: 1,
  niche: 0.6,
};

const MIN_OBS_FOR_FULL_CONFIDENCE = 5;
export const SECONDS_PER_UNIT_LOW_CONFIDENCE = 7.5;
export const LOW_CONFIDENCE_SHIFT_MIN = 1;
export const LOW_CONFIDENCE_SHIFT_MAX = 3;

export const KNOWN_ISSUE_OUTLIER_HINT =
  "If channeling, puck prep, or an early stop caused this, mark the shot as a known issue so it won't affect future recommendations.";

/**
 * @param {object} shot
 * @param {import('../grinders/grinderRegistry.js').GrinderProfile} grinderProfile
 */
export function grindNumericFromShot(shot, grinderProfile) {
  if (!shot || !grinderProfile) return null;
  const num = grinderProfile.shotToNumeric(shot);
  return Number.isFinite(num) ? num : null;
}

function nearGrindTolerance(grinderProfile) {
  if (grinderProfile.controlType === 'sette') return NEAR_GRIND_NUMERIC_TOLERANCE.sette;
  if (grinderProfile.controlType === 'sunbeam') return NEAR_GRIND_NUMERIC_TOLERANCE.sunbeam;
  if (grinderProfile.controlType === 'custom') return 1;
  return NEAR_GRIND_NUMERIC_TOLERANCE.niche;
}

function expectedTimeAtGrind(comparableShots, grindNumeric, recipe, grinderProfile) {
  const tol = nearGrindTolerance(grinderProfile);
  const times = comparableShots
    .map((s) => {
      const g = grindNumericFromShot(s, grinderProfile);
      const t = Number(s.actualTimeS ?? s.actualTime ?? NaN);
      if (g === null || !Number.isFinite(t)) return null;
      if (Math.abs(g - grindNumeric) > tol) return null;
      return t;
    })
    .filter((t) => t !== null);
  if (times.length === 0) return null;
  times.sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  return times.length % 2 === 1 ? times[mid] : (times[mid - 1] + times[mid]) / 2;
}

function shotWasDialledIn(shot, recipe) {
  const targetMin = shot.targetTimeMinS ?? recipe.targetTimeMinS ?? 27;
  const targetMax = shot.targetTimeMaxS ?? recipe.targetTimeMaxS ?? 32;
  const targetYield = recipe.targetYieldG ?? 36;
  const time = Number(shot.actualTimeS ?? shot.actualTime ?? NaN);
  const yieldG = Number(shot.actualYieldG ?? shot.actualYield ?? targetYield);
  if (!Number.isFinite(time)) return false;
  const inRange = time >= targetMin && time <= targetMax;
  const yieldOk = Math.abs(yieldG - targetYield) < 3.5;
  return inRange && isBalancedTaste(shot.tasteProfile) && yieldOk;
}

function lastDialledInShot(comparableShots, recipe) {
  for (const s of comparableShots) {
    if (shotWasDialledIn(s, recipe)) return s;
  }
  return null;
}

/**
 * Likely outlier: extreme absolute time or far from cluster at this grind (especially after a dialled-in pull).
 */
export function detectLikelyShotOutlier({
  actualTime,
  grindNumeric,
  recipe,
  comparableShots = [],
  grinderProfile,
}) {
  const time = Number(actualTime);
  if (!Number.isFinite(time)) return { isOutlier: false };

  if (time < OUTLIER_ABSOLUTE_MIN_S || time > OUTLIER_ABSOLUTE_MAX_S) {
    const anchor = lastDialledInShot(comparableShots, recipe);
    const anchorGrind = anchor ? grindNumericFromShot(anchor, grinderProfile) : null;
    const anchorTime = anchor ? Number(anchor.actualTimeS ?? anchor.actualTime) : null;
    const nearDialledInAnchor =
      anchorGrind !== null
      && grindNumeric !== null
      && shotWasDialledIn(anchor, recipe)
      && Math.abs(grindNumeric - anchorGrind) <= nearGrindTolerance(grinderProfile) * 2;
    const farFromDialledInTime =
      Number.isFinite(anchorTime) && Math.abs(time - anchorTime) >= 15;
    return {
      isOutlier: true,
      holdGrind: nearDialledInAnchor && (time < 10 || farFromDialledInTime),
      reasonCode: 'absolute_time',
      detail: time < OUTLIER_ABSOLUTE_MIN_S
        ? `Shot time (${time}s) is unusually fast for a completed extraction.`
        : `Shot time (${time}s) is unusually slow for a normal pull.`,
    };
  }

  if (grindNumeric === null || comparableShots.length === 0) {
    return { isOutlier: false };
  }

  const expected = expectedTimeAtGrind(comparableShots, grindNumeric, recipe, grinderProfile);
  if (expected === null) return { isOutlier: false };

  const deviation = Math.abs(time - expected);
  if (deviation < OUTLIER_NEAR_SETTING_DEVIATION_S) return { isOutlier: false };

  const anchor = lastDialledInShot(comparableShots, recipe);
  const anchorGrind = anchor ? grindNumericFromShot(anchor, grinderProfile) : null;
  const anchorTime = anchor ? Number(anchor.actualTimeS ?? anchor.actualTime) : null;
  const nearAnchor =
    anchorGrind !== null
    && Math.abs(grindNumeric - anchorGrind) <= nearGrindTolerance(grinderProfile) * 2;
  const anchorWasInRange =
    nearAnchor
    && Number.isFinite(anchorTime)
    && anchorTime >= (recipe.targetTimeMinS ?? 27)
    && anchorTime <= (recipe.targetTimeMaxS ?? 32);

  if (anchorWasInRange || deviation >= OUTLIER_NEAR_SETTING_DEVIATION_S + 4) {
    const anchorTime = anchor ? Number(anchor.actualTimeS ?? anchor.actualTime) : null;
    const muchFasterThanAnchor =
      anchorWasInRange && Number.isFinite(anchorTime) && time < anchorTime - 12;
    const muchFasterThanCluster = time < expected - 12;
    return {
      isOutlier: true,
      holdGrind: muchFasterThanAnchor || (muchFasterThanCluster && anchorWasInRange),
      reasonCode: 'contextual_time',
      detail: `At a similar grind, recent shots ran about ${Math.round(expected)}s — this ${time}s pull is far off that pattern.`,
    };
  }

  return { isOutlier: false };
}

/**
 * Drop historical outliers from pools used for seconds-per-step learning (does not mutate stored shots).
 */
export function filterOutliersFromLearningShots(shots, recipe, grinderModel, settings = null) {
  const grinderProfile = getRecommendationGrinderProfile(grinderModel, settings);
  const sorted = [...shots].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return shots.filter((shot) => {
    if (!shotEligibleForLearning(shot)) return false;
    const grindNumeric = grindNumericFromShot(shot, grinderProfile);
    const others = sorted.filter((s) => s !== shot);
    const { isOutlier } = detectLikelyShotOutlier({
      actualTime: shot.actualTimeS ?? shot.actualTime,
      grindNumeric,
      recipe,
      comparableShots: others,
      grinderProfile,
    });
    return !isOutlier;
  });
}

function estimateSecondsPerStepFromPairs(points) {
  const slopes = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      const dGrind = b.grind - a.grind;
      if (Math.abs(dGrind) < 0.35) continue;
      const dTime = b.time - a.time;
      const slope = dTime / dGrind;
      if (!Number.isFinite(slope) || Math.abs(slope) < 0.25) continue;
      slopes.push(slope);
    }
  }
  if (slopes.length === 0) return { secondsPerStep: null, pairCount: 0, confidence: 0 };

  const pos = slopes.filter((s) => s > 0).length;
  const neg = slopes.filter((s) => s < 0).length;
  if (pos > 0 && neg > 0) {
    return { secondsPerStep: null, pairCount: slopes.length, confidence: 0.15, contradictory: true };
  }

  const mean = slopes.reduce((sum, s) => sum + s, 0) / slopes.length;
  let varSum = 0;
  for (const s of slopes) varSum += (s - mean) ** 2;
  const std = slopes.length > 1 ? Math.sqrt(varSum / slopes.length) : 0;

  let confidence = Math.min(1, points.length / MIN_OBS_FOR_FULL_CONFIDENCE);
  confidence *= Math.min(1, slopes.length / 3);
  if (std > 3) confidence *= 0.5;
  else if (std > 1.5) confidence *= 0.75;

  return {
    secondsPerStep: mean,
    pairCount: slopes.length,
    confidence: Math.max(0, Math.min(1, confidence)),
    residualStd: std,
  };
}

function shiftMagnitudeFromMiss(secondsOffMidpoint) {
  const secOff = Math.max(0, Number(secondsOffMidpoint) || 0);
  if (secOff <= 0) return LOW_CONFIDENCE_SHIFT_MIN;
  let units = Math.round(secOff / SECONDS_PER_UNIT_LOW_CONFIDENCE);
  if (units < LOW_CONFIDENCE_SHIFT_MIN) units = LOW_CONFIDENCE_SHIFT_MIN;
  if (secOff >= 8 && secOff < 15 && units < 2) units = 2;
  return Math.min(LOW_CONFIDENCE_SHIFT_MAX, units);
}

/**
 * Confidence-weighted step from timing miss (~1 unit per 7–8s when confidence is low).
 */
export function dampQuantitativeShift(
  rawShift,
  confidence,
  { isOutlier = false, holdOutlier = false, secondsOffMidpoint = null } = {}
) {
  if (!rawShift) return 0;
  if (isOutlier && holdOutlier) return 0;

  const sign = rawShift < 0 ? -1 : 1;
  const absRaw = Math.abs(rawShift);
  const conf = Math.max(0, Math.min(1, confidence ?? 0));
  const fromMiss = shiftMagnitudeFromMiss(secondsOffMidpoint);

  if (isOutlier) {
    return sign * Math.min(absRaw, fromMiss, LOW_CONFIDENCE_SHIFT_MAX);
  }

  let magnitude;
  if (conf >= 0.75) {
    magnitude = Math.max(LOW_CONFIDENCE_SHIFT_MIN, Math.min(absRaw, Math.max(fromMiss, LOW_CONFIDENCE_SHIFT_MAX)));
  } else if (conf >= 0.45) {
    magnitude = Math.max(LOW_CONFIDENCE_SHIFT_MIN, Math.min(LOW_CONFIDENCE_SHIFT_MAX, fromMiss, absRaw));
  } else {
    magnitude = Math.max(LOW_CONFIDENCE_SHIFT_MIN, Math.min(LOW_CONFIDENCE_SHIFT_MAX, fromMiss));
  }

  return sign * magnitude;
}

export function buildOutlierRecommendationReason({ baseReason, outlierDetail }) {
  const trimmed = baseReason?.trim() || 'Adjust grind cautiously.';
  return `LIKELY OUTLIER — ${outlierDetail} Holding to a small grind change. ${trimmed} ${KNOWN_ISSUE_OUTLIER_HINT}`;
}

/**
 * @param {Array<object>} comparableShots recipe-matched, learning-eligible history (newest first)
 */
export function sensitivityConfidenceForQuantitativeGrinder(comparableShots, grinderModel, recipe, settings = null) {
  const grinderProfile = getRecommendationGrinderProfile(grinderModel, settings);
  const cleaned = filterOutliersFromLearningShots(comparableShots, recipe, grinderModel);
  const points = cleaned
    .map((s, idx) => ({
      grind: grindNumericFromShot(s, grinderProfile),
      time: Number(s.actualTimeS ?? s.actualTime ?? NaN),
      weight: Math.pow(0.85, idx),
    }))
    .filter((p) => p.grind !== null && Number.isFinite(p.time));

  const estimate = estimateSecondsPerStepFromPairs(points);
  const fallbackSensitivity = grinderProfile.sensitivity;
  const secondsPerStep =
    estimate.secondsPerStep !== null && Number.isFinite(estimate.secondsPerStep)
      ? Math.abs(estimate.secondsPerStep)
      : fallbackSensitivity;

  return {
    secondsPerStep,
    confidence: estimate.confidence ?? 0,
    observationCount: points.length,
    usedEmpiricalSlope: estimate.secondsPerStep !== null,
  };
}

export function nicheTimingStepConfidence(comparableShots, recipe, grinderModel) {
  const { confidence, observationCount } = sensitivityConfidenceForQuantitativeGrinder(
    comparableShots,
    grinderModel,
    recipe
  );
  return { confidence, observationCount };
}

export function filterComparableShotsForNicheLearning(comparableShots, recipe, grinderModel) {
  return filterOutliersFromLearningShots(comparableShots, recipe, grinderModel);
}

/** Prefer recipe-matched shots; fall back to grinder learning pool for outlier context. */
export function shotsForOutlierContext(learningRecentShots, recipeMatchedShots) {
  if (recipeMatchedShots.length > 0) return recipeMatchedShots;
  return [...learningRecentShots].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

export function grindNumericFromShotData(shotData, grinderProfile) {
  if (isNicheZeroGrinderModel(shotData.grinderModel)) {
    return parseNicheZeroSetting(shotData.nicheZeroSetting);
  }
  if (shotData.customGrindValue != null && grinderProfile?.controlType === 'custom') {
    return grindNumericFromShot(shotData, grinderProfile);
  }
  return grindNumericFromShot(shotData, grinderProfile);
}
