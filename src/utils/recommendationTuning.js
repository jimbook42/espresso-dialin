import { getRecommendationGrinderProfile, isNicheZeroGrinderModel } from '../grinders/grinderRegistry.js';
import { parseNicheZeroSetting } from '../grinders/nicheZero.js';
import { isBalancedTaste } from './tasteProfile.js';
import { applyGrindShiftDamping } from './grindShiftDamping.js';

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
/** Below this, learned seconds-per-step is not trusted — use default grinder sensitivity (uncapped). */
export const LEARNED_SENSITIVITY_MIN_CONFIDENCE = 0.45;
export { GRIND_SHIFT_DAMPING, HIGH_LEARNED_CONFIDENCE_THRESHOLD } from './grindShiftDamping.js';
export { proportionalGrindShiftFromTimeDelta, applyGrindShiftDamping } from './grindShiftDamping.js';

export const KNOWN_ISSUE_OUTLIER_HINT =
  'If this was puck prep or another one-off, mark it as a known issue in History to leave it out.';

export const KNOWN_ISSUE_CHOKE_HINT =
  'A choke is usually grind; marking a known issue in History is still an option.';

/** Borderline extreme times that should surface the known-issue hint without blocking grind moves. */
export function shouldAttachKnownIssueHintForExtremeTime(actualTime) {
  const time = Number(actualTime);
  if (!Number.isFinite(time)) return false;
  return time <= OUTLIER_ABSOLUTE_MIN_S || time >= OUTLIER_ABSOLUTE_MAX_S;
}

/** Soft known-issue note for the dial card (does not replace grind direction). */
export function knownIssueSoftNoteForShot(actualTime) {
  const time = Number(actualTime);
  if (Number.isFinite(time) && time >= OUTLIER_ABSOLUTE_MAX_S) {
    return KNOWN_ISSUE_CHOKE_HINT;
  }
  return KNOWN_ISSUE_OUTLIER_HINT;
}

export function appendKnownIssueSoftNote(warning, actualTime) {
  const time = Number(actualTime);
  const extreme = shouldAttachKnownIssueHintForExtremeTime(time);
  if (!extreme) return warning;
  const note = knownIssueSoftNoteForShot(time);
  if (warning?.includes(note)) return warning;
  const alternate =
    note === KNOWN_ISSUE_CHOKE_HINT ? KNOWN_ISSUE_OUTLIER_HINT : KNOWN_ISSUE_CHOKE_HINT;
  let merged = warning;
  if (merged?.includes(alternate)) {
    merged = merged.replace(alternate, '').replace(/\s{2,}/g, ' ').trim();
  }
  return merged ? `${merged} ${note}` : note;
}

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
    return {
      isOutlier: true,
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
    return {
      isOutlier: true,
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

export function hasReliableLearnedSensitivity(estimate) {
  if (!estimate || estimate.secondsPerStep === null || !Number.isFinite(estimate.secondsPerStep)) {
    return false;
  }
  if (estimate.contradictory) return false;
  return (estimate.confidence ?? 0) >= LEARNED_SENSITIVITY_MIN_CONFIDENCE;
}

export function signedShiftFromTimeDelta(timeDelta, secondsPerStep) {
  const raw = Math.round(timeDelta / secondsPerStep);
  if (raw === 0) {
    return timeDelta < 0 ? -1 : 1;
  }
  return raw;
}

/** @deprecated Use applyGrindShiftDamping */
export function dampQuantitativeShift(
  rawShift,
  confidence,
  { isOutlier = false, holdOutlier = false, reliableLearnedSensitivity = false } = {}
) {
  if (!rawShift) return 0;
  if (isOutlier && holdOutlier) return 0;
  return applyGrindShiftDamping(rawShift, {
    isOutlier,
    confidence,
    reliableLearnedSensitivity,
  });
}

export function buildOutlierRecommendationReason({ baseReason, outlierDetail }) {
  const trimmed = baseReason?.trim() || 'Adjust grind cautiously.';
  return `LIKELY OUTLIER — ${outlierDetail} ${trimmed}`;
}

/** Count user-facing "channeling" mentions (case-insensitive) across dial-card text blocks. */
export function countChannelingMentions(...textParts) {
  const combined = textParts.filter(Boolean).join(' ');
  return (combined.match(/channeling/gi) || []).length;
}

/**
 * @param {Array<object>} comparableShots recipe-matched, learning-eligible history (newest first)
 */
function sensitivityEstimateFromComparableShots(comparableShots, grinderModel, recipe, settings) {
  const grinderProfile = getRecommendationGrinderProfile(grinderModel, settings);
  const cleaned = filterOutliersFromLearningShots(comparableShots, recipe, grinderModel, settings);
  const points = cleaned
    .map((s, idx) => ({
      grind: grindNumericFromShot(s, grinderProfile),
      time: Number(s.actualTimeS ?? s.actualTime ?? NaN),
      weight: Math.pow(0.85, idx),
    }))
    .filter((p) => p.grind !== null && Number.isFinite(p.time));

  const estimate = estimateSecondsPerStepFromPairs(points);
  return { estimate, points, grinderProfile };
}

export function sensitivityConfidenceForQuantitativeGrinder(
  comparableShots,
  grinderModel,
  recipe,
  settings = null,
  grinderWideComparableShots = null
) {
  const { estimate: beanEstimate, points, grinderProfile } = sensitivityEstimateFromComparableShots(
    comparableShots,
    grinderModel,
    recipe,
    settings
  );

  let estimate = beanEstimate;
  if (
    grinderWideComparableShots
    && grinderWideComparableShots.length > 0
    && !hasReliableLearnedSensitivity(beanEstimate)
  ) {
    const { estimate: grinderEstimate } = sensitivityEstimateFromComparableShots(
      grinderWideComparableShots,
      grinderModel,
      recipe,
      settings
    );
    if (
      hasReliableLearnedSensitivity(grinderEstimate)
      || (grinderEstimate.confidence ?? 0) > (beanEstimate.confidence ?? 0)
    ) {
      estimate = grinderEstimate;
    }
  }

  const fallbackSensitivity = grinderProfile.sensitivity;
  const reliableLearnedSensitivity = hasReliableLearnedSensitivity(estimate);
  const secondsPerStep =
    reliableLearnedSensitivity && estimate.secondsPerStep !== null
      ? Math.abs(estimate.secondsPerStep)
      : fallbackSensitivity;

  return {
    secondsPerStep,
    confidence: estimate.confidence ?? 0,
    observationCount: points.length,
    usedEmpiricalSlope: estimate.secondsPerStep !== null,
    reliableLearnedSensitivity,
    defaultSensitivity: fallbackSensitivity,
    usedGrinderWideLearning:
      grinderWideComparableShots != null
      && grinderWideComparableShots.length > 0
      && estimate !== beanEstimate,
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

export function grindNumericFromShotData(shotData, grinderProfile, settings = null) {
  if (isNicheZeroGrinderModel(shotData.grinderModel)) {
    return parseNicheZeroSetting(shotData.nicheZeroSetting, settings);
  }
  if (shotData.customGrindValue != null && grinderProfile?.controlType === 'custom') {
    return grindNumericFromShot(shotData, grinderProfile);
  }
  return grindNumericFromShot(shotData, grinderProfile);
}
