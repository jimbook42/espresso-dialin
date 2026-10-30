/**
 * Download-only export of the last Lab replay video and that shot's saved curve.
 * Does not change stored shot or bean records.
 */

/**
 * @param {object | null | undefined} shot
 * @returns {{ shotId: string | null, labPressureCurve: { tS: number, bar: number }[] }}
 */
export function labPressureCurveExportDocument(shot) {
  const curve = Array.isArray(shot?.labPressureCurve) ? shot.labPressureCurve : [];
  const labPressureCurve = [];
  for (const point of curve) {
    const tS = point?.tS;
    const bar = point?.bar;
    if (!Number.isFinite(tS) || !Number.isFinite(bar)) continue;
    labPressureCurve.push({ tS, bar });
  }
  const shotId = shot?.id == null ? null : String(shot.id);
  return { shotId, labPressureCurve };
}

/**
 * @param {string | null | undefined} mimeType
 */
export function replayVideoExtension(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  return 'webm';
}

/**
 * @param {string | null | undefined} shotId
 * @param {string | null | undefined} mimeType
 */
export function labReplayExportFilenames(shotId, mimeType) {
  const safe = String(shotId || 'shot').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return {
    video: `lab-replay-${safe}.${replayVideoExtension(mimeType)}`,
    pressure: `lab-replay-${safe}-pressure.json`,
  };
}

/**
 * @param {string} filename
 * @param {Blob} blob
 */
export function downloadBlobFile(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * @param {{ shot: object, blob: Blob, mimeType?: string }} input
 * @returns {{ shotId: string | null, labPressureCurve: { tS: number, bar: number }[] } | null}
 */
export function exportLabShotReplayDownloads({ shot, blob, mimeType }) {
  if (!shot?.id || !blob) return null;
  const documentJson = labPressureCurveExportDocument(shot);
  if (documentJson.shotId !== String(shot.id)) return null;
  const names = labReplayExportFilenames(shot.id, mimeType || blob.type);
  downloadBlobFile(names.video, blob);
  downloadBlobFile(
    names.pressure,
    new Blob([JSON.stringify(documentJson)], { type: 'application/json' }),
  );
  return documentJson;
}
