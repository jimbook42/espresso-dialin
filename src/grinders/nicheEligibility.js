/**
 * Niche Zero learning eligibility funnel and human-readable diagnostics.
 * Does not change confidence gate constants — only explains and counts exclusions.
 */

import { parseNicheZeroSetting } from './nicheZero.js';
import {
  recommendNicheZeroFromEvidence,
  buildNicheLearningTransparencyNote,
  NICHE_LEARNING_MIN_OBSERVATIONS,
} from './nicheZeroLearning.js';
import {
  shotMatchesGrinderForLearning,
  shotRecipeMismatchReason,
} from './grinderLearningMatch.js';
import { isPersistedLearningShot } from '../utils/learningShotIdentity.js';

/** When saved recipe targets on a shot match the current recipe, actual yield may differ this much (fast/slow shots). */
export const NICHE_SAVED_TARGET_ACTUAL_YIELD_TOLERANCE_G = 4;

const RECIPE_CHANGED_EXCLUSION_CODES = new Set([
  'recipe_time_changed',
  'recipe_dose_target',
  'recipe_yield_target',
]);

export function shotExclusionsIndicateRecipeChange(shotExclusions = []) {
  return shotExclusions.some((e) => RECIPE_CHANGED_EXCLUSION_CODES.has(e.reasonCode));
}

const VERDICT_FROM_REASON = {
  insufficient_observations: 'insufficient_observations',
  insufficient_variation: 'insufficient_variation',
  contradictory_response: 'insufficient_variation',
  noisy_response: 'insufficient_variation',
  implausible_slope: 'filtering_excluded',
  excessive_adjustment: 'filtering_excluded',
  invalid_prediction: 'filtering_excluded',
  boundary: 'filtering_excluded',
};

function learningFieldReason(shot) {
  const dial = parseNicheZeroSetting(shot?.nicheZeroSetting);
  const timeS = Number(shot?.actualTimeS ?? shot?.actualTime ?? NaN);
  if (dial === null) return 'missing_dial';
  if (!Number.isFinite(timeS)) return 'missing_time';
  return null;
}

/**
 * @returns {null | string} exclusion reason for this shot in the learning funnel
 */
export function nicheShotLearningExclusionReason(shot, { grinderModel, recipe, flairEnabled }) {
  if (!shot) return 'missing_shot';
  if (shot.excludeFromLearning === true) return 'excluded_from_learning';
  if (!shotMatchesGrinderForLearning(shot, grinderModel)) return 'wrong_grinder';
  const recipeReason = shotRecipeMismatchReason(shot, recipe, flairEnabled);
  if (recipeReason) return recipeReason;
  const fieldReason = learningFieldReason(shot);
  if (fieldReason) return fieldReason;
  return null;
}

/**
 * Pure funnel + empirical gate diagnosis for Niche learning.
 */
export function diagnoseNicheLearningEligibility({
  shots = [],
  beanId,
  grinderModel,
  recipe,
  flairEnabled = false,
  currentObservation = null,
}) {
  const beanShots = beanId ? shots.filter((s) => s.beanId === beanId) : [...shots];

  const shotExclusions = [];
  let excludedFromLearning = 0;
  let grinderMatched = 0;
  let loggedGrinderMatched = 0;
  let recipeMatched = 0;
  let loggedRecipeMatched = 0;
  let validDialTime = 0;

  const grinderPool = [];
  for (const shot of beanShots) {
    if (shot.excludeFromLearning === true) {
      excludedFromLearning += 1;
      shotExclusions.push({ shotKey: shot.id || shot.timestamp, reasonCode: 'excluded_from_learning' });
      continue;
    }
    if (!shotMatchesGrinderForLearning(shot, grinderModel)) {
      shotExclusions.push({ shotKey: shot.id || shot.timestamp, reasonCode: 'wrong_grinder' });
      continue;
    }
    grinderMatched += 1;
    if (isPersistedLearningShot(shot)) loggedGrinderMatched += 1;
    grinderPool.push(shot);

    const recipeReason = shotRecipeMismatchReason(shot, recipe, flairEnabled);
    if (recipeReason) {
      shotExclusions.push({ shotKey: shot.id || shot.timestamp, reasonCode: recipeReason });
      continue;
    }
    recipeMatched += 1;
    if (isPersistedLearningShot(shot)) loggedRecipeMatched += 1;

    const fieldReason = learningFieldReason(shot);
    if (fieldReason) {
      shotExclusions.push({ shotKey: shot.id || shot.timestamp, reasonCode: fieldReason });
      continue;
    }
    validDialTime += 1;
  }

  const comparableShots = grinderPool.filter((s) => {
    const recipeReason = shotRecipeMismatchReason(s, recipe, flairEnabled);
    if (recipeReason) return false;
    return learningFieldReason(s) === null;
  });

  const currentDial =
    currentObservation?.nicheZeroSetting != null
      ? parseNicheZeroSetting(currentObservation.nicheZeroSetting)
      : null;
  const currentTime = currentObservation?.actualTimeS;

  const empiricalInput = {
    currentDial: currentDial ?? 15,
    actualTime: Number(currentTime ?? 30),
    targetMin: recipe?.targetTimeMinS ?? 27,
    targetMax: recipe?.targetTimeMaxS ?? 32,
    tasteProfile: 'sour',
    severeChoke: false,
    isTimeInRange: true,
    comparableShots: [...comparableShots].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    currentObservation: currentObservation
      ? {
          nicheZeroSetting: currentDial,
          actualTimeS: currentTime,
        }
      : null,
  };

  const empirical = recommendNicheZeroFromEvidence(empiricalInput);
  const diagnostics = empirical.diagnostics ?? {
    observationCount: 0,
    dialSpread: 0,
    pairCount: 0,
  };

  let finalReasonCode = empirical.ok ? null : empirical.reasonCode;
  let verdict = empirical.ok ? 'eligible' : VERDICT_FROM_REASON[empirical.reasonCode] || empirical.reasonCode;

  if (grinderMatched === 0 && beanShots.length > 0) {
    finalReasonCode = 'filtering_excluded';
    verdict = 'filtering_excluded';
  } else if (grinderMatched > 0 && recipeMatched === 0) {
    finalReasonCode = 'filtering_excluded';
    verdict = 'filtering_excluded';
  } else if (recipeMatched > 0 && validDialTime < NICHE_LEARNING_MIN_OBSERVATIONS && !empirical.ok) {
    if (empirical.reasonCode === 'insufficient_observations') {
      finalReasonCode = 'insufficient_observations';
      verdict = 'insufficient_observations';
    }
  }

  return {
    counts: {
      beanShots: beanShots.length,
      grinderMatched,
      loggedGrinderMatched,
      excludedFromLearning,
      recipeMatched,
      loggedRecipeMatched,
      validDialTime,
    },
    shotExclusions,
    observationCount: diagnostics.observationCount ?? 0,
    dialSpread: diagnostics.dialSpread ?? 0,
    pairCount: diagnostics.pairCount ?? 0,
    finalReasonCode,
    verdict,
    diagnostics,
    empiricalOk: empirical.ok,
  };
}

export function buildRecipeChangedLearningNote(eligibility) {
  if (
    eligibility.counts.grinderMatched > 0
    && eligibility.counts.recipeMatched === 0
    && shotExclusionsIndicateRecipeChange(eligibility.shotExclusions)
  ) {
    return `Your recipe changed, so earlier shots at the old recipe aren't used for dial learning. Log fresh pulls at the new targets. — ${buildNicheEligibilityCompactCounts(eligibility)}`;
  }
  return null;
}

export function buildNicheEligibilityCompactCounts(eligibility) {
  const { counts, dialSpread } = eligibility;
  const grinderLabel = counts.grinderMatched === 1 ? '1 Niche shot' : `${counts.grinderMatched} Niche shots`;
  const recipePart = `${counts.recipeMatched} match recipe`;
  const spreadPart =
    eligibility.observationCount > 0 ? ` · dial spread ${dialSpread}` : '';
  return `${grinderLabel} · ${recipePart}${spreadPart}`;
}

/**
 * Human note for the recommendation UI: blocking stage + compact counts.
 */
export function buildNicheEligibilityLearningNote(
  eligibility,
  empiricalReasonCode,
  { recipeComparableCount = 0, grinderLearningShotCount = 0 } = {}
) {
  if (eligibility.empiricalOk) return null;

  const recipeChangedNote = buildRecipeChangedLearningNote(eligibility);
  if (recipeChangedNote) return recipeChangedNote;

  const countsForNote = {
    recipeComparableCount:
      eligibility.counts.loggedRecipeMatched ?? eligibility.counts.recipeMatched ?? recipeComparableCount,
    grinderLearningShotCount:
      eligibility.counts.loggedGrinderMatched ?? eligibility.counts.grinderMatched ?? grinderLearningShotCount,
  };

  const reasonCode = empiricalReasonCode || eligibility.finalReasonCode;
  const stageNote = buildNicheLearningTransparencyNote(reasonCode, eligibility.diagnostics, countsForNote);

  if (!stageNote) {
    if (eligibility.counts.grinderMatched === 0) {
      return `Why not learning yet: no saved shots for this grinder on this bean. (${buildNicheEligibilityCompactCounts(eligibility)})`;
    }
    if (eligibility.counts.recipeMatched === 0 && eligibility.counts.grinderMatched > 0) {
      return `Why not learning yet: none of your saved shots match this recipe’s targets. (${buildNicheEligibilityCompactCounts(eligibility)})`;
    }
    return null;
  }

  if (
    eligibility.counts.recipeMatched === 0
    && countsForNote.grinderLearningShotCount > 0
    && shotExclusionsIndicateRecipeChange(eligibility.shotExclusions)
  ) {
    return buildRecipeChangedLearningNote(eligibility);
  }

  return `${stageNote} — ${buildNicheEligibilityCompactCounts(eligibility)}`;
}
