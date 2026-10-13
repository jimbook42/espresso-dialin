import assert from 'assert';
import {
  formatShotTimestampDisplay,
  formatShotTimestampIso,
  parseIsoOrEpochTimestamp,
  parseLegacyDisplayTimestamp,
  resolveShotTimestampFromCsvRow,
} from './csvTimestamp.js';

function withLocales(fn) {
  const locales = ['en-US', 'en-NZ'];
  for (const locale of locales) {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions() {
      return { ...original.call(this), locale };
    };
    try {
      fn(locale);
    } finally {
      Intl.DateTimeFormat.prototype.resolvedOptions = original;
    }
  }
}

export function runCsvTimestampTests() {
  const sample = '2026-10-13T14:27:35.000Z';
  withLocales(() => {
    assert.equal(formatShotTimestampIso(sample), sample);
    assert.equal(formatShotTimestampDisplay(sample), '13/10/2026, 14:27:35');
  });

  assert.equal(parseIsoOrEpochTimestamp(sample), sample);
  assert.equal(parseIsoOrEpochTimestamp('1760365655000'), new Date(1760365655000).toISOString());
  assert.equal(parseLegacyDisplayTimestamp('13/10/2026, 14:27:35'), sample);

  const header = ['Timestamp (ISO)', 'Timestamp (Epoch Ms)', 'Timestamp', 'Bean'];
  const row = [sample, String(Date.parse(sample)), '13/10/2026, 14:27:35', 'B2'];
  const col = (r, h, name) => r[h.indexOf(name)];
  assert.equal(resolveShotTimestampFromCsvRow(row, header, col), sample);

  const legacyHeader = ['Timestamp', 'Bean'];
  const legacyRow = ['13/10/2026, 14:27:35', 'B2'];
  assert.equal(resolveShotTimestampFromCsvRow(legacyRow, legacyHeader, col), sample);

  console.log('CSV timestamp tests passed.');
}
