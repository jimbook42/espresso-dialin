import {
  brewStopYield,
  buildBrewSteps,
  grindSettingChanged,
  normalizeBrewAccessories,
} from './steps.js';

/** UI-only preference: full step-by-step, compact checklist, or no brew guidance on Dial-In. */
export const BREW_GUIDANCE_MODES = Object.freeze({
  full: 'full',
  quick: 'quick',
  none: 'none',
});

/** Shot count threshold uses persisted shot history rows (Log shot only, not draft UI state). */
export const BREW_GUIDANCE_GRADUATION_SHOT_COUNT = 10;

export function countLoggedShots(shots) {
  return Array.isArray(shots) ? shots.length : 0;
}

export function normalizeBrewGuidanceMode(value) {
  if (value === BREW_GUIDANCE_MODES.quick || value === BREW_GUIDANCE_MODES.none) {
    return value;
  }
  if (value === BREW_GUIDANCE_MODES.full) return BREW_GUIDANCE_MODES.full;
  return BREW_GUIDANCE_MODES.full;
}

/** First-visit intro only for new users who have not set up Brew Guide or logged shots yet. */
export function shouldShowBrewGuideIntro(settings, shotCount) {
  if (settings?.brewGuideIntroSeen === true) return false;
  if (settings?.brewGuideSetupComplete) return false;
  if (shotCount > 0) return false;
  return true;
}

export function shouldShowGraduationPrompt(settings, shotCount) {
  if (normalizeBrewGuidanceMode(settings?.brewGuideGuidanceMode) !== BREW_GUIDANCE_MODES.full) {
    return false;
  }
  if (settings?.brewGuideGraduationDismissed === true) return false;
  const total = typeof shotCount === 'number' ? shotCount : countLoggedShots(shotCount);
  return total >= BREW_GUIDANCE_GRADUATION_SHOT_COUNT;
}

/** After the first bean profile is saved with Brew Guide on, send the user to Brew Guide once. */
export function shouldNavigateToBrewAfterFirstBean(settings, isFirstBeanAdd, brewGuideEnabled) {
  if (!isFirstBeanAdd || !brewGuideEnabled) return false;
  if (settings?.brewGuideFirstBeanNavDone === true) return false;
  return true;
}

function firstSentence(text) {
  if (!text) return '';
  const trimmed = String(text).trim();
  const match = trimmed.match(/^[^.!?]+[.!?]?/);
  return match ? match[0].trim() : trimmed;
}

function pushChecklistItem(items, id, text) {
  if (!text) return;
  items.push({ id: `${id}-${items.length}`, text });
}

/**
 * Compact reminders derived from the same brew steps as the Full Guide.
 * Omits disabled accessories and long explanations.
 */
export function buildQuickChecklist(rawAccessories, dial = {}) {
  const accessories = normalizeBrewAccessories(rawAccessories);
  const steps = buildBrewSteps(accessories, dial);
  const items = [];

  pushChecklistItem(items, 'prep-machine', 'Heat machine, preheat group, warm cup.');

  const grindSetting = steps.find((step) => step.id === 'grindSetting');
  if (grindSetting?.highlight) {
    let text = `Set ${grindSetting.highlightLabel || 'grind'} to ${grindSetting.highlight}.`;
    pushChecklistItem(items, 'grind-setting', text);
    if (grindSettingChanged(dial)) {
      pushChecklistItem(items, 'purge', 'Purge fresh beans before dosing.');
    }
  }

  const dose = steps.find((step) => step.id === 'dose');
  if (dose) {
    const doseG = dose.highlight || '—';
    pushChecklistItem(items, 'dose', `Weigh ${doseG} dose; do not fill the hopper.`);
    for (const action of dose.actions || []) {
      pushChecklistItem(items, 'dose-tool', firstSentence(action.text) || action.title);
    }
  }

  const grind = steps.find((step) => step.id === 'grind');
  if (grind) {
    for (const action of grind.actions || []) {
      pushChecklistItem(items, 'grind-tool', firstSentence(action.text) || action.title);
    }
    if (!(grind.actions || []).length && grind.lines?.[0]) {
      pushChecklistItem(items, 'grind', firstSentence(grind.lines[0]));
    }
  }

  const puck = steps.find((step) => step.id === 'puck');
  if (puck) {
    for (const action of puck.actions || []) {
      pushChecklistItem(items, 'puck-tool', firstSentence(action.text) || action.title);
    }
    for (const line of puck.lines || []) {
      pushChecklistItem(items, 'puck', firstSentence(line));
    }
  }

  const extract = steps.find((step) => step.id === 'extract');
  if (extract) {
    const stopAt = brewStopYield(dial.yieldG) || extract.stopAt;
    const yieldG = extract.highlight;
    if (stopAt) {
      pushChecklistItem(items, 'extract', `Pull shot — stop around ${stopAt}g (target ${yieldG}).`);
    } else {
      pushChecklistItem(items, 'extract', `Pull shot toward ${yieldG}.`);
    }
    if (extract.timeLabel) {
      pushChecklistItem(items, 'extract-time', `Aim ${extract.timeLabel}.`);
    }
  }

  pushChecklistItem(items, 'log', 'Enter time and yield on Dial-In, pick taste, log shot.');

  return items;
}
