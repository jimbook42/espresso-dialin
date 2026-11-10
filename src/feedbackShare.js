import { buildShotDiagnosticDocument, labReplayExportFilenames } from './flairPressureLab/labShotReplayExport.js';
import { diagnosticsBuild } from './scales/shotDeviceDiagnostics.js';

const version = diagnosticsBuild.appVersion;
const email = 'TullLabs@outlook.com';

function jsonFile(name, data) {
  return new File([JSON.stringify(data)], name, { type: 'application/json' });
}

export function prepareShotFeedback(shot, note) {
  const shortId = String(shot.id).slice(0, 8);
  const filename = labReplayExportFilenames(shot.id).pressure;
  const diagnostics = buildShotDiagnosticDocument(shot, undefined, { testerFeedback: note, includeSavedFlow: true });
  return {
    title: `Espresso Dial-In shot ${shortId} v${version}`,
    files: [jsonFile(filename, diagnostics)],
  };
}

export function prepareGaugeFeedback(reason, note, clip) {
  const summary = {
    appVersion: version,
    compatibility: { state: 'unsupported', reason },
    ...(note ? { testerFeedback: note } : {}),
  };
  return {
    title: `Espresso Dial-In gauge feedback v${version}`,
    files: [jsonFile('dial-in-gauge-feedback.json', summary), ...(clip ? [clip] : [])],
  };
}

export function feedbackMailto(subject, note) {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(note)}`;
}

export async function shareFeedbackFiles(navigator, { files, title }) {
  try {
    if (!navigator.share || !navigator.canShare?.({ files })) return 'fallback';
    await navigator.share({ files, title });
    return 'share';
  } catch (error) {
    return error?.name === 'AbortError' ? 'cancelled' : 'fallback';
  }
}
