import { generateId, knownIssueReasonKeyFromLabel } from './grinderLogic.js';
import {
  defaultBrewTemperatureForGrinder,
  parseGrindForShotSave,
} from '../grinders/grinderRegistry.js';
import { inferRecipeTargetsFromShots } from './beanRecipeResolution.js';
import {
  parseLegacyDisplayTimestamp,
  resolveShotTimestampFromCsvRow,
} from './csvTimestamp.js';
import { parseRecFollowedFromCsv } from './recommendationFollowed.js';
import { normalizeTasteProfile, tasteProfileForSave } from './tasteProfile.js';

const LEGACY_EXCLUDED_HEADER = 'Excluded From Learning';
const EXCLUDED_HEADER = 'Excluded';

const TARGET_TIME_MIN_HEADER = 'Target Time Min (s)';
const TARGET_TIME_MAX_HEADER = 'Target Time Max (s)';
const TARGET_DOSE_HEADER = 'Target Dose (g)';
const TARGET_YIELD_HEADER = 'Target Yield (g)';

function csvHasPerShotTargetColumns(header) {
  return (
    header.includes(TARGET_TIME_MIN_HEADER)
    || header.includes(TARGET_TIME_MAX_HEADER)
    || header.includes(TARGET_DOSE_HEADER)
    || header.includes(TARGET_YIELD_HEADER)
  );
}

/** Legacy 17-column exports: attach inferred recipe targets so recipe matching matches a full round-trip. */
export function backfillLegacyImportedShotTargets(importedShots, existingShots = []) {
  if (!importedShots.length) return importedShots;
  const byBean = new Map();
  for (const shot of importedShots) {
    if (!byBean.has(shot.beanId)) byBean.set(shot.beanId, []);
    byBean.get(shot.beanId).push(shot);
  }

  for (const [beanId, beanImports] of byBean) {
    const pool = [...existingShots, ...importedShots].filter((s) => s.beanId === beanId);
    const targets = inferRecipeTargetsFromShots(pool);
    for (const shot of beanImports) {
      if (shot.targetTimeMinS == null) shot.targetTimeMinS = targets.targetTimeMinS;
      if (shot.targetTimeMaxS == null) shot.targetTimeMaxS = targets.targetTimeMaxS;
      if (shot.targetDoseG == null) shot.targetDoseG = targets.targetDoseG;
      if (shot.targetYieldG == null) shot.targetYieldG = targets.targetYieldG;
    }
  }
  return importedShots;
}

/** @param {string} line */
export function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

function normalizeHeaderName(name) {
  return String(name || '').trim();
}

function headerIndex(header, name) {
  const idx = header.indexOf(name);
  return idx >= 0 ? idx : -1;
}

function excludedColumnIndex(header) {
  const direct = headerIndex(header, EXCLUDED_HEADER);
  if (direct >= 0) return direct;
  return headerIndex(header, LEGACY_EXCLUDED_HEADER);
}

/** Merge locale timestamp split across two CSV fields (e.g. "13/10/2026" + "14:27:35"). */
export function mergeTimestampFields(cols, header) {
  return alignDataRowToHeader(cols, header);
}

/**
 * Align a parsed data row with the header when unquoted timestamps (or other fields) added extra commas.
 */
function headerHasIsoTimestamp(header) {
  return header.includes('Timestamp (ISO)');
}

function mergeSplitTimestampAtIndex(fields, index) {
  if (index < 0 || fields.length < index + 2) return fields;
  const merged = `${fields[index]}, ${fields[index + 1].trim()}`;
  if (parseLegacyDisplayTimestamp(merged) || !parseLegacyDisplayTimestamp(fields[index])) {
    return [...fields.slice(0, index), merged, ...fields.slice(index + 2)];
  }
  return [...fields.slice(0, index), `${fields[index]},${fields[index + 1]}`, ...fields.slice(index + 2)];
}

export function alignDataRowToHeader(cols, header) {
  if (!header?.length) return cols;
  let fields = [...cols];
  if (fields[0]?.charCodeAt(0) === 0xfeff) {
    fields[0] = fields[0].slice(1);
  }

  const timestampMergeIndex = headerHasIsoTimestamp(header)
    ? header.indexOf('Timestamp')
    : header[0] === 'Timestamp'
      ? 0
      : -1;

  if (timestampMergeIndex >= 0) {
    while (fields.length > header.length) {
      fields = mergeSplitTimestampAtIndex(fields, timestampMergeIndex);
    }
  }

  if (fields.length < header.length) {
    while (fields.length < header.length) fields.push('');
  }
  return fields.slice(0, header.length);
}

/** @deprecated Use parseLegacyDisplayTimestamp from csvTimestamp.js */
export function parseExportedTimestamp(raw) {
  return parseLegacyDisplayTimestamp(raw);
}

function yesNo(value) {
  return String(value || '').trim().toLowerCase() === 'yes';
}

function shotDuplicateKey(shot) {
  return [
    shot.timestamp,
    shot.beanId,
    shot.grinderModel,
    shot.setteMacro ?? '',
    shot.setteMicro ?? '',
    shot.sunbeamSetting ?? '',
    shot.nicheZeroSetting ?? '',
    shot.customGrindValue ?? '',
    shot.actualTimeS,
    shot.actualDoseG,
    shot.actualYieldG,
  ].join('|');
}

function grindFieldsFromCsvRow(grinderModel, grindSetting, settings) {
  const grindText = String(grindSetting || '').trim();
  if (!grindText) return { ok: false, error: 'Missing grind setting' };

  if (/^\d+-[A-I]$/i.test(grindText)) {
    const match = /^(\d+)-([A-I])$/i.exec(grindText);
    const parsed = parseGrindForShotSave(
      grinderModel,
      { setteMacro: Number(match[1]), setteMicro: match[2].toUpperCase() },
      settings
    );
    return parsed.ok ? { ok: true, fields: parsed } : { ok: false, error: 'Invalid Sette grind' };
  }

  const numeric = Number(grindText);
  if (Number.isFinite(numeric)) {
    if (grinderModel === 'Sunbeam Barista Max') {
      const parsed = parseGrindForShotSave(grinderModel, { sunbeamSetting: numeric }, settings);
      return parsed.ok ? { ok: true, fields: parsed } : { ok: false, error: 'Invalid Sunbeam grind' };
    }
    if (grinderModel === 'Niche Zero') {
      const parsed = parseGrindForShotSave(grinderModel, { nicheZeroSetting: numeric }, settings);
      return parsed.ok ? { ok: true, fields: parsed } : { ok: false, error: 'Invalid Niche grind' };
    }
    const parsed = parseGrindForShotSave(
      grinderModel,
      { customGrindValue: numeric },
      settings
    );
    return parsed.ok ? { ok: true, fields: parsed } : { ok: false, error: 'Invalid custom grind' };
  }

  const setteParsed = parseGrindForShotSave(
    'Sette 270Wi',
    {
      setteMacro: Number(grindText.split('-')[0]),
      setteMicro: grindText.split('-')[1],
    },
    settings
  );
  if (setteParsed.ok) return { ok: true, fields: setteParsed };

  return { ok: false, error: `Unrecognized grind setting: ${grindText}` };
}

/**
 * @param {string} csvText
 * @returns {{ header: string[], rows: string[][] }}
 */
export function parseShotsCsvText(csvText) {
  const text = String(csvText || '').replace(/^\uFEFF/, '');
  const lines = text.trim().split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { header: [], rows: [] };
  }
  const header = parseCsvLine(lines[0]).map(normalizeHeaderName);
  const rows = lines.slice(1).map((line) => alignDataRowToHeader(parseCsvLine(line), header));
  return { header, rows };
}

function col(row, header, name) {
  const idx = headerIndex(header, name);
  return idx >= 0 ? row[idx] : '';
}

/**
 * Build shot records from parsed CSV (does not touch the database).
 *
 * @param {string[][]} rows
 * @param {string[]} header
 * @param {{
 *   resolveBeanId: (beanName: string) => { beanId: string, created?: boolean },
 *   settings?: object | null,
 *   existingShots?: object[],
 * }} options
 */
export function buildShotRecordsFromCsvRows(rows, header, options) {
  const { resolveBeanId, settings = null, existingShots = [] } = options;
  const duplicateKeys = new Set(existingShots.map(shotDuplicateKey));
  const excludedIdx = excludedColumnIndex(header);

  const imported = [];
  const skipped = [];
  const errors = [];

  for (let lineNo = 0; lineNo < rows.length; lineNo += 1) {
    const row = rows[lineNo];
    try {
      const beanName = col(row, header, 'Bean').trim() || 'Unknown';
      const grinderModel = col(row, header, 'Grinder').trim();
      if (!grinderModel) {
        errors.push({ row: lineNo + 2, message: 'Missing grinder' });
        continue;
      }

      const timestamp = resolveShotTimestampFromCsvRow(row, header, col);
      if (!timestamp) {
        errors.push({ row: lineNo + 2, message: 'Invalid timestamp' });
        continue;
      }

      const grindResult = grindFieldsFromCsvRow(grinderModel, col(row, header, 'Grind Setting'), settings);
      if (!grindResult.ok) {
        errors.push({ row: lineNo + 2, message: grindResult.error });
        continue;
      }

      const { beanId } = resolveBeanId(beanName);
      const actualTimeS = Number(col(row, header, 'Time(s)'));
      const actualDoseG = Number(col(row, header, 'Dose(g)'));
      const actualYieldG = Number(col(row, header, 'Yield(g)'));
      if (!Number.isFinite(actualTimeS) || !Number.isFinite(actualDoseG) || !Number.isFinite(actualYieldG)) {
        errors.push({ row: lineNo + 2, message: 'Invalid dose, yield, or time' });
        continue;
      }

      const tasteRaw = col(row, header, 'Taste');
      const tasteProfile = tasteProfileForSave(normalizeTasteProfile(tasteRaw || 'balanced'));

      const excludedCell = excludedIdx >= 0 ? row[excludedIdx] : '';
      const excluded = yesNo(excludedCell);
      const reasonLabel = col(row, header, 'Known Issue Reason');
      const knownIssueReason = excluded ? knownIssueReasonKeyFromLabel(reasonLabel) : undefined;

      const ratingRaw = col(row, header, 'Rating');
      const shotRating = ratingRaw !== '' && ratingRaw != null ? Number(ratingRaw) : undefined;
      const recommendationFollowed = parseRecFollowedFromCsv(col(row, header, 'Rec Followed'));

      const targetMinRaw = col(row, header, 'Target Time Min (s)');
      const targetMaxRaw = col(row, header, 'Target Time Max (s)');
      const targetDoseRaw = col(row, header, 'Target Dose (g)');
      const targetYieldRaw = col(row, header, 'Target Yield (g)');

      const grindFields = { ...grindResult.fields };
      delete grindFields.ok;
      delete grindFields.error;

      const shot = {
        id: generateId(),
        beanId,
        timestamp,
        grinderModel,
        ...grindFields,
        wasPurged: yesNo(col(row, header, 'Purged')),
        actualDoseG,
        actualYieldG,
        actualTimeS,
        actualTime: actualTimeS,
        tasteProfile,
        shotRating: Number.isFinite(shotRating) ? shotRating : undefined,
        brewRatio: col(row, header, 'Ratio') || undefined,
        beanAgeDays: Number(col(row, header, 'Bean Age (Days)')) || 0,
        storageType: col(row, header, 'Storage') || 'bag',
        ...(recommendationFollowed === true || recommendationFollowed === false
          ? { recommendationFollowed }
          : {}),
        notes: col(row, header, 'Notes') || '',
        ...(targetMinRaw !== '' && Number.isFinite(Number(targetMinRaw))
          ? { targetTimeMinS: Number(targetMinRaw) }
          : {}),
        ...(targetMaxRaw !== '' && Number.isFinite(Number(targetMaxRaw))
          ? { targetTimeMaxS: Number(targetMaxRaw) }
          : {}),
        ...(targetDoseRaw !== '' && Number.isFinite(Number(targetDoseRaw))
          ? { targetDoseG: Number(targetDoseRaw) }
          : {}),
        ...(targetYieldRaw !== '' && Number.isFinite(Number(targetYieldRaw))
          ? { targetYieldG: Number(targetYieldRaw) }
          : {}),
        ...(excluded
          ? { excludeFromLearning: true, knownIssueReason: knownIssueReason || 'other' }
          : {}),
      };

      const key = shotDuplicateKey(shot);
      if (duplicateKeys.has(key)) {
        skipped.push({ row: lineNo + 2, reason: 'duplicate' });
        continue;
      }
      duplicateKeys.add(key);
      imported.push(shot);
    } catch (err) {
      errors.push({ row: lineNo + 2, message: err?.message || String(err) });
    }
  }

  return { imported, skipped, errors };
}

/**
 * Additive import: never updates or deletes existing shots.
 *
 * @param {import('dexie').Dexie} database
 * @param {string} csvText
 * @param {{
 *   settings?: object | null,
 *   generateId?: () => string,
 * }} [options]
 */
export async function importShotsFromCsv(database, csvText, options = {}) {
  const settings = options.settings ?? null;
  const { header, rows } = parseShotsCsvText(csvText);
  if (header.length === 0) {
    return { imported: 0, skipped: 0, errors: [{ row: 0, message: 'Empty CSV' }], createdBeans: 0 };
  }

  const required = ['Timestamp', 'Bean', 'Grinder', 'Grind Setting', 'Time(s)', 'Dose(g)', 'Yield(g)'];
  for (const name of required) {
    if (!header.includes(name)) {
      return {
        imported: 0,
        skipped: 0,
        errors: [{ row: 1, message: `Missing required column: ${name}` }],
        createdBeans: 0,
      };
    }
  }

  const [existingShots, existingBeans, existingRecipes] = await Promise.all([
    database.shots.toArray(),
    database.beans.toArray(),
    database.recipes.toArray(),
  ]);

  const beansByName = new Map(existingBeans.map((b) => [String(b.name).toLowerCase(), b]));
  const pendingBeans = [];

  const resolveBeanId = (beanName) => {
    const key = beanName.toLowerCase();
    const found = beansByName.get(key);
    if (found) return { beanId: found.id };
    const id = generateId();
    const bean = {
      id,
      name: beanName,
      roaster: '',
      roastType: 'Medium',
      roastDate: new Date().toISOString().slice(0, 10),
      storageType: 'bag',
      createdAt: new Date().toISOString(),
    };
    beansByName.set(key, bean);
    pendingBeans.push(bean);
    return { beanId: id };
  };

  const { imported, skipped, errors } = buildShotRecordsFromCsvRows(rows, header, {
    resolveBeanId,
    settings,
    existingShots,
  });

  if (!csvHasPerShotTargetColumns(header) && imported.length > 0) {
    backfillLegacyImportedShotTargets(imported, existingShots);
  }

  const grinderModel = settings?.grinderModel || 'Sette 270Wi';
  const recipesToAdd = [];
  const beansTouched = new Set(imported.map((s) => s.beanId));

  for (const beanId of beansTouched) {
    if (existingRecipes.some((r) => r.beanId === beanId)) continue;
    const beanShots = [...existingShots, ...imported].filter((s) => s.beanId === beanId);
    const targets = inferRecipeTargetsFromShots(beanShots);
    recipesToAdd.push({
      id: generateId(),
      beanId,
      ...targets,
      brewTemperatureC: defaultBrewTemperatureForGrinder(grinderModel),
      flairProfile: null,
    });
  }

  await database.transaction('rw', database.beans, database.shots, database.recipes, async () => {
    if (pendingBeans.length > 0) {
      await database.beans.bulkAdd(pendingBeans);
    }
    if (imported.length > 0) {
      await database.shots.bulkAdd(imported);
    }
    if (recipesToAdd.length > 0) {
      await database.recipes.bulkAdd(recipesToAdd);
    }
  });

  return {
    imported: imported.length,
    skipped: skipped.length,
    errors,
    createdBeans: pendingBeans.length,
    recipesCreated: recipesToAdd.length,
  };
}

/** Same entry point as Settings → Import Shots from CSV in the app. */
export async function importShotsCsvThroughAppPath(database, csvText, appSettings = null) {
  return importShotsFromCsv(database, csvText, { settings: appSettings });
}

const REQUIRED_EXPORT_HEADERS = [
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
  EXCLUDED_HEADER,
  'Known Issue Reason',
  'Notes',
];

export function isRecognizedShotsExportHeader(headerRow) {
  const header = headerRow.map(normalizeHeaderName);
  const hasExcluded =
    header.includes(EXCLUDED_HEADER) || header.includes(LEGACY_EXCLUDED_HEADER);
  if (!hasExcluded) return false;
  return REQUIRED_EXPORT_HEADERS.every(
    (name) => name === EXCLUDED_HEADER || header.includes(name)
  );
}
