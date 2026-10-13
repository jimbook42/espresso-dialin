import {
  clampNicheZeroDial,
  NICHE_ZERO_GRINDER_ID,
  parseNicheZeroSetting,
} from './nicheZero.js';
import { getPresetGrinderDefinition } from './presetGrinders/index.js';

/**
 * Maps Niche-style empirical learning onto preset stepless grinders (Eureka line).
 * Shots are normalized to nicheZeroSetting for learningPointsFromShots.
 */
export function resolveReferenceLearningDialIO(grinderModel, settings = null) {
  if (grinderModel === NICHE_ZERO_GRINDER_ID) {
    return {
      kind: 'niche',
      readDialFromShot(shot) {
        return parseNicheZeroSetting(shot?.nicheZeroSetting, settings);
      },
      readDialFromState(value) {
        return parseNicheZeroSetting(value, settings);
      },
      clampDial(n) {
        return clampNicheZeroDial(n, settings);
      },
      buildRecommendedSetting(dial) {
        return { nicheZeroSetting: dial };
      },
      grinderLabel: 'Niche',
    };
  }
  const def = getPresetGrinderDefinition(grinderModel);
  if (def?.referenceLearning) {
    return {
      kind: 'preset',
      readDialFromShot(shot) {
        return def.parseReferenceDial(shot?.customGrindValue);
      },
      readDialFromState(value) {
        return def.parseReferenceDial(value);
      },
      clampDial(n) {
        return def.clampReferenceDial(n);
      },
      buildRecommendedSetting(dial) {
        return { customGrindValue: dial };
      },
      grinderLabel: def.shortBadgeLabel || def.id,
    };
  }
  return null;
}

export function usesReferenceDialLearning(grinderModel, settings = null) {
  return resolveReferenceLearningDialIO(grinderModel, settings) !== null;
}

export function mapShotsForReferenceLearning(shots, refIO) {
  return shots.map((s) => ({
    ...s,
    nicheZeroSetting: refIO.readDialFromShot(s),
  }));
}
