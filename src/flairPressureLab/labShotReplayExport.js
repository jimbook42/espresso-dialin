/**
 * Export of the last Lab replay video and that shot's saved curve.
 * Does not change stored shot or bean records.
 */
import {
  diagnosticsBuild, DIAGNOSTICS_UNAVAILABLE, shotDeviceDiagnosticsForShot,
} from '../scales/shotDeviceDiagnostics.js';
import { replayDiagnosticsForShot } from './labReplayDiagnostics.js';
import { readerStallDiagnosticsForShot } from './readerStallDiagnostics.js';
import { isAndroidApp, saveAndroidFile, saveAndroidReplay } from '../native/androidShell.js';
import { buildPressureFlowAnalytics } from '../utils/pressureFlowAnalytics.js';
import { recordedShotTiming } from '../utils/shotProfile.js';
import { instantaneousFlowGs, SCALE_FLOW_MAX_SAMPLE_GAP_S } from '../scales/flowMetrics.js';

function savedScaleSampling(curve) {
  if (!Array.isArray(curve) || !curve.length) return null;
  const summary = { observations: curve.length, duplicateTimestamps: 0, reversedTimestamps: 0,
    gapsOver500ms: 0, sub20msIntervals: 0, shortestPositiveMs: null, largestRise: null, largestDrop: null };
  for (let i = 1; i < curve.length; i += 1) {
    const previous = curve[i - 1];
    const point = curve[i];
    const elapsedS = point?.tS - previous?.tS;
    if (!Number.isFinite(elapsedS)) continue;
    if (elapsedS === 0) summary.duplicateTimestamps += 1;
    else if (elapsedS < 0) summary.reversedTimestamps += 1;
    else {
      const ms = elapsedS * 1000;
      summary.shortestPositiveMs = Math.min(summary.shortestPositiveMs ?? Infinity, ms);
      if (elapsedS > SCALE_FLOW_MAX_SAMPLE_GAP_S + 1e-9) {
        summary.gapsOver500ms += 1;
        continue;
      }
      if (ms < 20 - 1e-6) summary.sub20msIntervals += 1;
      const flowGs = instantaneousFlowGs(previous, point);
      if (!Number.isFinite(flowGs) || point.breakBefore || point.reset || point.confident === false
        || previous.confident === false) continue;
      const interval = { fromTS: previous.tS, toTS: point.tS, flowGs };
      if (flowGs > (summary.largestRise?.flowGs ?? 0)) summary.largestRise = interval;
      if (flowGs < (summary.largestDrop?.flowGs ?? 0)) summary.largestDrop = interval;
    }
  }
  return summary;
}

function savedMeasurementDiagnostics(shot) {
  const timing = recordedShotTiming(shot);
  const analysis = buildPressureFlowAnalytics(shot);
  const offsetFields = ['pressureOriginMs', 'scaleOriginMs', 'extractionStartMs', 'extractionEndMs',
    'stopMs', 'settlementEndMs', 'clockDriftMs'];
  return {
    timing: timing ? {
      origin: 'application shot timer start',
      ...Object.fromEntries(offsetFields.map((key) => [key, Number.isFinite(timing[key]) ? timing[key] : null])),
      pressureSource: ['camera', 'simulated'].includes(timing.pressureSource) ? timing.pressureSource : null,
      scaleSource: ['native-ble', 'web-bluetooth'].includes(timing.scaleSource) ? timing.scaleSource : null,
      scaleInterrupted: typeof timing.scaleInterrupted === 'boolean' ? timing.scaleInterrupted : null,
    } : null,
    extractionDurationS: analysis.durationS,
    pressureStatus: analysis.pressureStatus,
    pressureCoverage: analysis.pressureCoverage,
    scaleStatus: analysis.flowStatus,
    scaleSampling: savedScaleSampling(shot.scaleFlowCurve),
  };
}

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
  const safe = String(shotId || 'shot').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 90);
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

export function buildShotDiagnosticDocument(shot, exportedAt = new Date().toISOString(),
  { testerFeedback, includeSavedFlow = false } = {}) {
  const documentJson = labPressureCurveExportDocument(shot);
  const trace = shotDeviceDiagnosticsForShot(shot?.id);
  documentJson.readerDiagnostics = replayDiagnosticsForShot(shot?.id);
  documentJson.readerDiagnosticsAvailability = documentJson.readerDiagnostics
    ? 'current-session' : 'unavailable: replay predates capture or page was reloaded';
  documentJson.readerStallDiagnostics = readerStallDiagnosticsForShot(shot?.id);
  return {
    ...documentJson,
    diagnosticsVersion: 2,
    exportBuild: diagnosticsBuild,
    exportedAt,
    pressureDiagnosticsAvailability: documentJson.readerDiagnostics || documentJson.readerStallDiagnostics
      ? 'current-session' : documentJson.labPressureCurve.length ? 'saved-curve-only' : 'unavailable',
    timeline: { origin: null, units: 'ms', pressureOffsetMs: null, extractionOffsetMs: null },
    recordingBuild: null,
    scaleDiagnostics: { availability: 'unavailable', reason: DIAGNOSTICS_UNAVAILABLE },
    stopDiagnosticsAvailability: trace ? 'current-session' : DIAGNOSTICS_UNAVAILABLE,
    ...trace,
    ...(shot ? { savedMeasurementDiagnostics: savedMeasurementDiagnostics(shot) } : {}),
    pressureSource: documentJson.labPressureCurve.length || documentJson.readerDiagnostics || documentJson.readerStallDiagnostics
      ? trace?.pressureSource ?? null : null,
    ...(testerFeedback ? { testerFeedback } : {}),
    ...(includeSavedFlow && shot?.scaleFlowCurve?.length
      ? { savedScaleFlowCurve: shot.scaleFlowCurve } : {}),
  };
}

export async function exportLabShotFiles({ shot, replay, includeVideo }, {
  native = isAndroidApp, save = saveAndroidFile, saveVideo = saveAndroidReplay, download = downloadBlobFile,
} = {}) {
  if (!shot?.id) throw new Error('This shot is no longer available.');
  if (includeVideo && (replay?.meta?.shotId !== shot.id || !replay.blob?.size)) {
    throw new Error('This shot’s replay video is unavailable. Export diagnostics to save its pressure data.');
  }
  const mimeType = (replay?.meta?.mimeType || replay?.blob?.type || '').split(';')[0].toLowerCase();
  const names = labReplayExportFilenames(shot.id, mimeType);
  const diagnostics = new Blob([JSON.stringify(buildShotDiagnosticDocument(shot))], { type: 'application/json' });
  const files = [];
  if (includeVideo) files.push({
    name: names.video, blob: replay.blob.slice(0, replay.blob.size, mimeType), write: saveVideo,
  });
  files.push({ name: names.pressure, blob: diagnostics, write: save });

  const outcomes = [];
  for (const { name, blob, write } of files) {
    const file = { name, bytes: blob.size };
    try {
      if (!native) {
        download(name, blob);
        outcomes.push({ ...file, status: 'download' });
        continue;
      }
      const receipt = await write(blob, name);
      if (receipt.cancelled) {
        outcomes.push({ ...file, status: 'cancelled' });
        break;
      }
      if (receipt.bytesWritten !== blob.size) throw new Error('The byte count did not match.');
      outcomes.push({ ...file, savedAs: receipt.filename, status: 'saved' });
    } catch (error) {
      outcomes.push({ ...file, status: 'failed', error: error.message });
      break;
    }
  }
  return outcomes;
}
