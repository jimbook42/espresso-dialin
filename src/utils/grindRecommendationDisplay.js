import {
  formatRecommendedGrindDisplay,
  isNicheZeroGrinderModel,
} from '../grinders/grinderRegistry.js';
import { KNOWN_ISSUE_OUTLIER_HINT } from './recommendationTuning.js';

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
  if (!trimmed.includes(KNOWN_ISSUE_OUTLIER_HINT)) return trimmed;
  return trimmed.replace(KNOWN_ISSUE_OUTLIER_HINT, '').replace(/\s{2,}/g, ' ').trim();
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

  const holdingOutlier =
    /LIKELY OUTLIER/i.test(reasonBody) && /Holding to a small grind change/i.test(reasonBody);
  const direction = holdingOutlier
    ? 'Grind setting held'
    : directionFromLead(lead) || directionFromLead(detail);

  let why = detail || (lead && !direction ? lead : '');
  if (holdingOutlier) {
    why = 'If puck prep, channeling, or an early stop caused this, mark the shot as a known issue.';
  }
  why = stripKnownIssueHint(why);
  const estimatedLabel = estimated ? 'Estimated' : '';

  if (isNicheZeroGrinderModel(grinderModel)) {
    const parts = [estimatedLabel, direction, why, targetSetting ? `Target dial: ${targetSetting}` : ''].filter(Boolean);
    return parts.join(' · ');
  }

  const parts = [estimatedLabel, direction, why, targetSetting ? `Target setting: ${targetSetting}` : ''].filter(Boolean);
  return parts.join(' · ');
}
