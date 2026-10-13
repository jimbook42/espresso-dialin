import assert from 'assert';
import {
  buildShotsCsvContent,
  buildShotsCsvRows,
  escapeCsvField,
  formatCsvRow,
  SHOT_CSV_HEADERS,
} from './csvExport.js';
import { formatShotGrindForHistory, parseGrindForShotSave } from '../grinders/grinderRegistry.js';

export function runCsvExportTests() {
  assert.equal(escapeCsvField('plain'), '"plain"');
  assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvField(null), '""');

  const iso = '2026-10-13T14:27:35.000Z';
  const display = '13/10/2026, 14:27:35';
  const quotedRow = formatCsvRow([iso, display, 'Notes with, comma']);
  assert.ok(quotedRow.includes(`"${iso}"`));
  assert.ok(quotedRow.includes(`"${display}"`));
  assert.ok(quotedRow.includes('"Notes with, comma"'));

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
  assert.equal(exportRows[0][0], '2026-10-01T12:00:00.000Z');
  assert.equal(exportRows[1][3], 'Unknown');
  assert.equal(exportRows[1][18], 'channel #1');
  assert.equal(SHOT_CSV_HEADERS.length, 23);
  const excludedIdx = SHOT_CSV_HEADERS.indexOf('Excluded');
  assert.equal(excludedIdx, 16);
  assert.equal(exportRows[2][excludedIdx], 'Yes');
  assert.equal(exportRows[2][excludedIdx + 1], 'Puck prep issue');
  assert.equal(exportRows[0][excludedIdx], 'No');

  const customSettings = {
    grinderModel: 'DF64',
    customGrinder: {
      name: 'DF64',
      dialType: 'stepped',
      min: 1,
      max: 20,
      step: 1,
      lowerIsFiner: true,
    },
  };
  const customValues = [10, 12, 9, 11, 13, 10, 7, 7];
  const customShots = customValues.map((value, index) => {
    const parsed = parseGrindForShotSave(
      'DF64',
      { customGrindValue: value },
      customSettings
    );
    assert.equal(parsed.ok, true);
    return {
      id: `c${index}`,
      timestamp: `2026-10-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
      beanId: 'b1',
      grinderModel: 'DF64',
      customGrindValue: parsed.customGrindValue,
      wasPurged: true,
      actualDoseG: 18,
      actualYieldG: 36,
      actualTimeS: 28,
      tasteProfile: 'balanced',
    };
  });
  for (const shot of customShots) {
    assert.equal(
      formatShotGrindForHistory(shot, customSettings),
      String(shot.customGrindValue),
      'history label must use stored customGrindValue'
    );
  }
  const customRows = buildShotsCsvRows(customShots, {
    beans: [{ id: 'b1', name: 'Test' }],
    formatShotGrindForHistory: (s) => formatShotGrindForHistory(s, customSettings),
    normalizeTasteProfile: (t) => t,
    formatRecFollowedForCsv: () => 'Yes',
    knownIssueReasonLabel: () => '',
  });
  assert.deepEqual(customRows.map((row) => row[5]), customValues.map(String));

  console.log('CSV export tests passed.');
}
