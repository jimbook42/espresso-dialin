/** User-entered note from stored shot notes (strips pre-infusion prefix). */
export function userShotNoteFromStoredNotes(notes) {
  if (notes == null || notes === '') return '';
  let rest = String(notes).trim();
  if (!rest) return '';
  const prePrefix = rest.match(/^Pre-infusion:\s*[\d.]+s\.\s*/i);
  if (prePrefix) {
    rest = rest.slice(prePrefix[0].length).trim();
  }
  return rest;
}

export function truncateShotUserNote(note, maxLen = 48) {
  const text = String(note ?? '').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
}

/** Suffix for Dial last-shot line: ` · “note”` (empty when no user note). */
export function formatLastShotUserNoteSuffix(storedNotes, maxLen = 48) {
  const userNote = userShotNoteFromStoredNotes(storedNotes);
  if (!userNote) return '';
  const display = truncateShotUserNote(userNote, maxLen);
  return ` · “${display}”`;
}

/** Single-line history card note (full user note, no quotes). */
export function formatHistoryShotUserNoteLine(storedNotes) {
  return userShotNoteFromStoredNotes(storedNotes);
}
