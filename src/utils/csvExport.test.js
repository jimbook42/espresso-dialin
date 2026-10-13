import assert from 'assert';
import { buildShotsCsvContent, escapeCsvField } from './csvExport.js';

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

  console.log('CSV export tests passed.');
}
