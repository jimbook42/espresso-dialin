/** @param {number} n */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Locale-independent ISO 8601 for CSV export (matches stored shot timestamps). */
export function formatShotTimestampIso(timestamp) {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

/** Epoch milliseconds for CSV export/import (timezone-neutral). */
export function formatShotTimestampEpochMs(timestamp) {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getTime());
}

/**
 * Human-readable timestamp for legacy CSV column (D/M/Y, 24h local).
 * Does not use `toLocaleString` — stable across en-US / en-NZ runtimes.
 */
export function formatShotTimestampDisplay(timestamp) {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T/;

export function parseIsoOrEpochTimestamp(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (ISO_LIKE.test(text)) {
    const ms = Date.parse(text);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  const epoch = Number(text);
  if (Number.isFinite(epoch) && text.length >= 10) {
    const d = new Date(epoch);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/**
 * Legacy display timestamps (D/M/Y or M/D/Y) with optional AM/PM — only when ISO/epoch absent.
 */
export function parseLegacyDisplayTimestamp(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  const dmy24 = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/i.exec(text);
  if (dmy24) {
    const [, day, month, year, hour, minute, second = '0'] = dmy24;
    const h = Number(hour);
    if (h <= 23) {
      const iso = new Date(
        `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second.padStart(2, '0')}`
      );
      if (!Number.isNaN(iso.getTime())) return iso.toISOString();
    }
  }

  const mdy12 = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)\s*$/i.exec(text);
  if (mdy12) {
    const [, month, day, year, hour, minute, second = '0', ampm] = mdy12;
    let h = Number(hour) % 12;
    if (ampm.toUpperCase() === 'PM') h += 12;
    const iso = new Date(
      `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${String(h).padStart(2, '0')}:${minute}:${second.padStart(2, '0')}`
    );
    if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return null;
}

export function resolveShotTimestampFromCsvRow(row, header, colFn) {
  const iso = parseIsoOrEpochTimestamp(colFn(row, header, 'Timestamp (ISO)'));
  if (iso) return iso;
  const epoch = parseIsoOrEpochTimestamp(colFn(row, header, 'Timestamp (Epoch Ms)'));
  if (epoch) return epoch;
  return parseLegacyDisplayTimestamp(colFn(row, header, 'Timestamp'));
}
