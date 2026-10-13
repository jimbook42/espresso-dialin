import assert from 'assert';
import {
  buildShotsCsvContent,
  buildShotsCsvRows,
  escapeCsvField,
  SHOT_CSV_HEADERS,
} from './csvExport.js';

export function runCsvExportTests() {
  assert.equal(escapeCsvField('plain'), '"plain"');
  assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvField(null), '""');

  const headers = ['Timestamp', 'Bean', 'Notes'];
  const rows = [
    ['Oct 13, 2026, 9:30:00 AM', 'Ethiopia', 'He said "great shot"'],
    ['Oct 14, 2026, 10:00:00 AM', 'Brazil', ''],
  ];
  const csv = buildShotsCsvContent(headers, rows);
  assert.equal(
    csv,
    [
      '"Timestamp","Bean","Notes"',
      '"Oct 13, 2026, 9:30:00 AM","Ethiopia","He said ""great shot"""',
      '"Oct 14, 2026, 10:00:00 AM","Brazil",""',
    ].join('\n')
  );

  const shots = [
    { id: '1', timestamp: '2026-10-01T12:00:00.000Z', beanId: 'b1', grinderModel: 'G', wasPurged: false, actualDoseG: 18, actualYieldG: 36, actualTimeS: 30, tasteProfile: 'balanced' },
    { id: '2', timestamp: '2026-10-02T12:00:00.000Z', beanId: 'missing', grinderModel: 'G', wasPurged: true, actualDoseG: 18, actualYieldG: 34, actualTimeS: 28, tasteProfile: 'sour', notes: 'channel #1' },
    { id: '3', timestamp: '2026-10-03T12:00:00.000Z', beanId: 'b2', grinderModel: 'G', wasPurged: false, actualDoseG: 18, actualYieldG: 35, actualTimeS: 29, tasteProfile: 'balanced', excludeFromLearning: true, knownIssueReason: 'puck_prep' },
  ];
  const beans = [{ id: 'b1', name: 'Ethiopia' }, { id: 'b2', name: 'Finished', isFinished: true }];
  const exportRows = buildShotsCsvRows(shots, {
    beans,
    formatShotGrindForHistory: () => '15-A',
    normalizeTasteProfile: (t) => t,
    formatRecFollowedForCsv: () => 'Yes',
    knownIssueReasonLabel: () => 'Puck prep issue',
  });
  assert.equal(exportRows.length, 3);
  assert.equal(exportRows[1][1], 'Unknown');
  assert.equal(exportRows[1][16], 'channel #1');
  assert.equal(SHOT_CSV_HEADERS.length, 17);

  console.log('CSV export tests passed.');
}
