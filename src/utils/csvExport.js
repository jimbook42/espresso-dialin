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
