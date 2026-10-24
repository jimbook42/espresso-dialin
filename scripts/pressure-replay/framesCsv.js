const CSV_COLUMNS = [
  'timeS',
  'gaugeFound',
  'centreFromGuide',
  'centreX',
  'centreY',
  'radius',
  'gaugeRotationDeg',
  'needleAngleDeg',
  'bar',
  'confidence',
  'flags',
  'conflictDeg',
];

function escapeCsv(value) {
  if (value == null) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function framesToCsv(frames) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const frame of frames) {
    lines.push(CSV_COLUMNS.map((key) => escapeCsv(frame[key])).join(','));
  }
  return `${lines.join('\n')}\n`;
}
