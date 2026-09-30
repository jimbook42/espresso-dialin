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

function firstSentence(text) {
  if (!text) return '';
  const trimmed = String(text).trim();
  const match = trimmed.match(/^[^.!?]+[.!?]?/);
  return match ? match[0].trim() : trimmed;
}

/**
 * Compact reminders derived from the same brew steps as the Full Guide.
 * Omits disabled accessories and long explanations.
 */
export function buildQuickChecklist(rawAccessories, dial = {}) {
  const accessories = normalizeBrewAccessories(rawAccessories);
  const steps = buildBrewSteps(accessories, dial);
  const items = [];

  items.push({
    id: 'prep-machine',
    text: 'Heat machine, preheat group, warm cup.',
  });

  const grindSetting = steps.find((step) => step.id === 'grindSetting');
  if (grindSetting?.highlight) {
    let text = `Set ${grindSetting.highlightLabel || 'grind'} to ${grindSetting.highlight}.`;
    if (grindSettingChanged(dial)) {
      text += ' Purge fresh beans before dosing.';
    }
    items.push({ id: 'grind-setting', text });
  }

  const dose = steps.find((step) => step.id === 'dose');
  if (dose) {
    const doseG = dose.highlight || '—';
    const doseBits = [`Weigh ${doseG} dose; do not fill the hopper.`];
    for (const action of dose.actions || []) {
      doseBits.push(firstSentence(action.text) || action.title);
    }
    items.push({ id: 'dose', text: doseBits.join(' ') });
  }

  const grind = steps.find((step) => step.id === 'grind');
  if (grind) {
    const grindBits = [];
    for (const action of grind.actions || []) {
      grindBits.push(firstSentence(action.text) || action.title);
    }
    if (!grindBits.length && grind.lines?.[0]) {
      grindBits.push(firstSentence(grind.lines[0]));
    }
    if (grindBits.length) {
      items.push({ id: 'grind', text: grindBits.join(' ') });
    }
  }

  const puck = steps.find((step) => step.id === 'puck');
  if (puck) {
    const puckBits = [];
    for (const action of puck.actions || []) {
      puckBits.push(`${action.title}: ${firstSentence(action.text)}`);
    }
    for (const line of puck.lines || []) {
      puckBits.push(firstSentence(line));
    }
    if (puckBits.length) {
      items.push({ id: 'puck', text: puckBits.join(' ') });
    }
  }

  const extract = steps.find((step) => step.id === 'extract');
  if (extract) {
    const stopAt = brewStopYield(dial.yieldG) || extract.stopAt;
    const yieldG = extract.highlight;
    let text = stopAt
      ? `Pull shot — stop around ${stopAt}g (target ${yieldG}).`
      : `Pull shot toward ${yieldG}.`;
    if (extract.timeLabel) {
      text += ` Aim ${extract.timeLabel}.`;
    }
    items.push({ id: 'extract', text });
  }

  items.push({
    id: 'log',
    text: 'Enter time and yield on Dial-In, pick taste, log shot.',
  });

  return items;
}
