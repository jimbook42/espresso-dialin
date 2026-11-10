import assert from 'assert';
import { buildShotsCsvContent, buildShotsCsvRows, SHOT_CSV_HEADERS } from './csvExport.js';
import { parseShotsCsvText } from './csvImport.js';
import {
  formatShotTimestampDisplay,
  formatShotTimestampEpochMs,
  formatShotTimestampIso,
  parseIsoOrEpochTimestamp,
  parseLegacyDisplayTimestamp,
  resolveShotTimestampFromCsvRow,
} from './csvTimestamp.js';

const timestampCases = [
  ['2026-10-13T14:27:35.000Z', '13/10/2026, 14:27:35', '14/10/2026, 03:27:35'],
  // Auckland spring forward skips 02:00–02:59.
  ['2026-09-26T13:59:59.000Z', '26/09/2026, 13:59:59', '27/09/2026, 01:59:59'],
  ['2026-09-26T14:00:00.000Z', '26/09/2026, 14:00:00', '27/09/2026, 03:00:00'],
  // Both instants export the same Auckland wall time when the clocks fall back.
  ['2026-04-04T13:30:00.000Z', '04/04/2026, 13:30:00', '05/04/2026, 02:30:00'],
  ['2026-04-04T14:30:00.000Z', '04/04/2026, 14:30:00', '05/04/2026, 02:30:00'],
];

export function runCsvTimestampTests() {
  const col = (r, h, name) => r[h.indexOf(name)];
  const originalTz = process.env.TZ;
  const zones = ['UTC', 'Pacific/Auckland'];
  try {
    const exports = zones.map((zone, zoneIndex) => {
      process.env.TZ = zone;
      for (const [iso, utc, auckland] of timestampCases) {
        const epoch = String(Date.parse(iso));
        assert.equal(formatShotTimestampIso(iso), iso);
        assert.equal(formatShotTimestampEpochMs(iso), epoch);
        assert.equal(formatShotTimestampDisplay(iso), zoneIndex === 0 ? utc : auckland);
        assert.equal(parseIsoOrEpochTimestamp(iso), iso);
        assert.equal(parseIsoOrEpochTimestamp(epoch), iso);
      }
      const rows = buildShotsCsvRows(timestampCases.map(([timestamp]) => ({ timestamp })), {
        beans: [],
        formatShotGrindForHistory: () => '',
        normalizeTasteProfile: () => '',
        formatRecFollowedForCsv: () => '',
        knownIssueReasonLabel: () => '',
      });
      assert.deepEqual(rows.map((row) => col(row, SHOT_CSV_HEADERS, 'Timestamp')),
        timestampCases.map((entry) => entry[zoneIndex + 1]));
      return buildShotsCsvContent(SHOT_CSV_HEADERS, rows);
    });

    const instants = timestampCases.map(([iso]) => iso);
    for (const zone of zones) {
      process.env.TZ = zone;
      for (const csv of exports) {
        const { header, rows } = parseShotsCsvText(csv);
        assert.deepEqual(rows.map((row) => resolveShotTimestampFromCsvRow(row, header, col)), instants);
        assert.deepEqual(rows.map((row) => resolveShotTimestampFromCsvRow(row.slice(1), header.slice(1), col)),
          instants);
      }

      const localInstant = zone === 'UTC' ? instants[0] : '2026-10-13T01:27:35.000Z';
      const legacyCsv = buildShotsCsvContent(['Timestamp', 'Bean'], [['13/10/2026, 14:27:35', 'B2']]);
      const { header, rows } = parseShotsCsvText(legacyCsv);
      assert.equal(resolveShotTimestampFromCsvRow(rows[0], header, col), localInstant);
      assert.equal(parseLegacyDisplayTimestamp('10/13/2026, 2:27:35 PM'), localInstant);
      assert.equal(parseLegacyDisplayTimestamp('05/04/2026, 02:30:00'),
        zone === 'UTC' ? '2026-04-05T02:30:00.000Z' : '2026-04-04T13:30:00.000Z');
    }
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }

  console.log('CSV timestamp tests passed.');
}
