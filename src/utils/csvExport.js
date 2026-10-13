import { shotExcludedFromLearning } from './grinderLogic.js';
import {
  formatShotTimestampDisplay,
  formatShotTimestampEpochMs,
  formatShotTimestampIso,
} from './csvTimestamp.js';

/** RFC 4180 field: wrap in double quotes; internal quotes doubled. */
export function escapeCsvField(value) {
  const str = value == null ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

export function formatCsvRow(fields) {
  return fields.map(escapeCsvField).join(',');
}

export function buildShotsCsvContent(headers, rows) {
  return [formatCsvRow(headers), ...rows.map((row) => formatCsvRow(row))].join('\n');
}

export const SHOT_CSV_HEADERS = [
  'Timestamp (ISO)',
  'Timestamp (Epoch Ms)',
  'Timestamp',
  'Bean',
  'Grinder',
  'Grind Setting',
  'Purged',
  'Dose(g)',
  'Yield(g)',
  'Ratio',
  'Time(s)',
  'Taste',
  'Rating',
  'Bean Age (Days)',
  'Storage',
  'Rec Followed',
  'Excluded',
  'Known Issue Reason',
  'Notes',
  'Target Time Min (s)',
  'Target Time Max (s)',
  'Target Dose (g)',
  'Target Yield (g)',
];

/**
 * One CSV row per logged shot (same inclusion rules as History — no recipe/bean filters).
 *
 * @param {object[]} shots Newest-first or any order (export preserves input order).
 * @param {{
 *   beans: object[],
 *   formatShotGrindForHistory: (shot: object) => string,
 *   normalizeTasteProfile: (taste: string) => string,
 *   formatRecFollowedForCsv: (shot: object) => string,
 *   knownIssueReasonLabel: (reason: string) => string,
 *   recipes?: object[],
 * }} helpers
 */
export function buildShotsCsvRows(shots, helpers) {
  const {
    beans,
    recipes = [],
    formatShotGrindForHistory,
    normalizeTasteProfile,
    formatRecFollowedForCsv,
    knownIssueReasonLabel,
  } = helpers;

  return (shots || []).map((s) => {
    const bean = beans.find((b) => b.id === s.beanId);
    const recipe = recipes.find((r) => r.beanId === s.beanId);
    const grind = formatShotGrindForHistory(s);
    const targetTimeMinS = recipe?.targetTimeMinS ?? s.targetTimeMinS;
    const targetTimeMaxS = recipe?.targetTimeMaxS ?? s.targetTimeMaxS;
    const targetDoseG = recipe?.targetDoseG ?? s.targetDoseG;
    const targetYieldG = recipe?.targetYieldG ?? s.targetYieldG;
    return [
      formatShotTimestampIso(s.timestamp),
      formatShotTimestampEpochMs(s.timestamp),
      formatShotTimestampDisplay(s.timestamp),
      bean ? bean.name : 'Unknown',
      s.grinderModel,
      grind,
      s.wasPurged ? 'Yes' : 'No',
      s.actualDoseG,
      s.actualYieldG,
      s.brewRatio || '',
      s.actualTimeS,
      normalizeTasteProfile(s.tasteProfile),
      s.shotRating || '',
      s.beanAgeDays || 0,
      s.storageType || 'bag',
      formatRecFollowedForCsv(s),
      shotExcludedFromLearning(s) ? 'Yes' : 'No',
      shotExcludedFromLearning(s) ? knownIssueReasonLabel(s.knownIssueReason) : '',
      s.notes || '',
      targetTimeMinS ?? '',
      targetTimeMaxS ?? '',
      targetDoseG ?? '',
      targetYieldG ?? '',
    ];
  });
}

/** Browser download via Blob URL (avoids data-URL truncation on `#` in field text). */
export function downloadCsvFile(filename, csvText) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
