import {
  formatRecommendedGrindDisplay,
  isNicheZeroGrinderModel,
} from '../grinders/grinderRegistry.js';
import { dialBoundaryAdvisoryForRecommendation } from '../grinders/dialBoundaryAdvisory.js';
import { KNOWN_ISSUE_CHOKE_HINT, KNOWN_ISSUE_OUTLIER_HINT } from './recommendationTuning.js';

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

function stripKnownIssueHint(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  for (const hint of [KNOWN_ISSUE_OUTLIER_HINT, KNOWN_ISSUE_CHOKE_HINT]) {
    if (trimmed.includes(hint)) {
      return trimmed.replace(hint, '').replace(/\s{2,}/g, ' ').trim();
    }
  }
  return trimmed;
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

  let why = detail || (lead && !direction ? lead : '');
  if (/^LIKELY OUTLIER/i.test(lead) && direction) {
    why = detail || '';
  }
  why = stripKnownIssueHint(why);
  const estimatedLabel = estimated ? 'Estimated' : '';

  const boundary = dialBoundaryAdvisoryForRecommendation(grinderModel, rec, settings);
  if (boundary) {
    const parts = [estimatedLabel, boundary.headline, boundary.detail].filter(Boolean);
    return parts.join(' · ');
  }

  if (isNicheZeroGrinderModel(grinderModel)) {
    const parts = [estimatedLabel, direction, why, targetSetting ? `Target dial: ${targetSetting}` : ''].filter(Boolean);
    return parts.join(' · ');
  }

  const parts = [estimatedLabel, direction, why, targetSetting ? `Target setting: ${targetSetting}` : ''].filter(Boolean);
  return parts.join(' · ');
}
