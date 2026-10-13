import {
  formatRecommendedGrindDisplay,
  isNicheZeroGrinderModel,
} from '../grinders/grinderRegistry.js';

const REASON_SPLIT = /—|–/;

function splitRecommendationReason(raw) {
  const text = (raw || '').trim();
  if (!text) return { lead: '', detail: '' };
  const parts = text.split(REASON_SPLIT);
  if (parts.length < 2) return { lead: text, detail: '' };
  return {
    lead: parts[0].trim(),
    detail: parts.slice(1).join('—').trim(),
  };
}

function directionFromLead(lead) {
  const upper = (lead || '').toUpperCase();
  if (upper.includes('KEEP GRIND')) return 'Keep the same grind';
  if (upper.includes('FINER')) return 'Grind finer';
  if (upper.includes('COARSER')) return 'Grind coarser';
  if (upper.includes('CHOKE')) return 'Grind coarser';
  return '';
}

/**
 * Plain-language grind recommendation for the Dial-In hero (direction, why, target setting).
 */
export function formatGrindRecommendationSummary(grinderModel, rec) {
  if (!rec?.recommendedSetting) return null;

  const targetSetting = formatRecommendedGrindDisplay(grinderModel, rec.recommendedSetting);
  const raw = rec.reason || rec.originalReason || '';
  const { lead, detail } = splitRecommendationReason(raw);
  const direction = directionFromLead(lead);

  if (isNicheZeroGrinderModel(grinderModel)) {
    const why = detail || raw;
    const parts = [direction, why, targetSetting ? `Target dial: ${targetSetting}` : ''].filter(Boolean);
    return parts.join(' · ');
  }

  const why = detail || (lead && !direction ? lead : '');
  const parts = [direction, why, targetSetting ? `Target setting: ${targetSetting}` : ''].filter(Boolean);
  return parts.join(' · ');
}
