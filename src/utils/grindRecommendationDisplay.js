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

function stripLeadingEstimatedPrefix(raw) {
  const text = (raw || '').trim();
  if (!/^ESTIMATED\s*[—–-]/i.test(text)) {
    return { estimated: false, text };
  }
  return {
    estimated: true,
    text: text.replace(/^ESTIMATED\s*[—–-]\s*/i, '').trim(),
  };
}

/**
 * Plain-language grind recommendation for the Dial-In hero (direction, why, target setting).
 */
export function formatGrindRecommendationSummary(grinderModel, rec, settings = null) {
  if (!rec?.recommendedSetting) return null;

  const { estimated, text: reasonBody } = stripLeadingEstimatedPrefix(rec.reason || rec.originalReason || '');
  const targetSetting = formatRecommendedGrindDisplay(grinderModel, rec.recommendedSetting, settings);
  const { lead, detail } = splitRecommendationReason(reasonBody);
  const direction = directionFromLead(lead) || directionFromLead(detail);

  const why = detail || (lead && !direction ? lead : '');
  const estimatedLabel = estimated ? 'Estimated' : '';

  if (isNicheZeroGrinderModel(grinderModel)) {
    const parts = [estimatedLabel, direction, why, targetSetting ? `Target dial: ${targetSetting}` : ''].filter(Boolean);
    return parts.join(' · ');
  }

  const parts = [estimatedLabel, direction, why, targetSetting ? `Target setting: ${targetSetting}` : ''].filter(Boolean);
  return parts.join(' · ');
}
