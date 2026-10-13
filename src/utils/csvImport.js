import { generateId, knownIssueReasonKeyFromLabel } from './grinderLogic.js';
import { parseGrindForShotSave } from '../grinders/grinderRegistry.js';
import { normalizeTasteProfile, tasteProfileForSave } from './tasteProfile.js';

const LEGACY_EXCLUDED_HEADER = 'Excluded From Learning';
const EXCLUDED_HEADER = 'Excluded';

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
  if (header[0] !== 'Timestamp' || cols.length <= header.length) {
    return cols;
  }
  if (cols.length > header.length) {
    return [`${cols[0]}, ${cols[1].trim()}`, ...cols.slice(2)];
  }
  return cols;
}

/**
 * Parse export timestamp (locale string or ISO).
 * @param {string} raw
 */
export function parseExportedTimestamp(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (dmy) {
    const [, day, month, year, hour, minute, second = '0'] = dmy;
    const iso = new Date(
      `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second.padStart(2, '0')}`
    );
    if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return null;
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
  const lines = String(csvText || '').trim().split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { header: [], rows: [] };
  }
  const header = parseCsvLine(lines[0]).map(normalizeHeaderName);
  const rows = lines.slice(1).map((line) => mergeTimestampFields(parseCsvLine(line), header));
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

      const timestamp = parseExportedTimestamp(col(row, header, 'Timestamp'));
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

      const targetMinRaw = col(row, header, 'Target Time Min (s)');
      const targetMaxRaw = col(row, header, 'Target Time Max (s)');
      const targetDoseRaw = col(row, header, 'Target Dose (g)');
      const targetYieldRaw = col(row, header, 'Target Yield (g)');

      const shot = {
        id: generateId(),
        beanId,
        timestamp,
        grinderModel,
        ...grindResult.fields,
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

  const [existingShots, existingBeans] = await Promise.all([
    database.shots.toArray(),
    database.beans.toArray(),
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

  await database.transaction('rw', database.beans, database.shots, async () => {
    if (pendingBeans.length > 0) {
      await database.beans.bulkAdd(pendingBeans);
    }
    if (imported.length > 0) {
      await database.shots.bulkAdd(imported);
    }
  });

  return {
    imported: imported.length,
    skipped: skipped.length,
    errors,
    createdBeans: pendingBeans.length,
  };
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
