import { saveAndroidFile, isAndroidApp } from '../native/androidShell.js';
import { shareFeedbackFiles } from '../feedbackShare.js';
import { downloadBlobFile } from '../flairPressureLab/labShotReplayExport.js';

export function betaJsonFile(data, filename) {
  return new File([JSON.stringify(data, null, 2)], filename, { type: 'application/json' });
}

// The chooser can open successfully even when the user cancels it or never sends.
export async function shareLocalFile(file, { consent, title, feedback = false } = {}, {
  native = isAndroidApp,
  android = saveAndroidFile,
  browser = globalThis.navigator,
} = {}) {
  if (!consent) return 'consent-required';
  if (!native) return shareFeedbackFiles(browser ?? {}, { files: [file], title });
  if (!file?.size || (feedback && file.type !== 'application/json')) return 'fallback';
  try {
    if (feedback) {
      const body = JSON.parse(await file.text());
      if (!body || typeof body !== 'object' || Array.isArray(body)) return 'fallback';
    }
    await android(file, file.name, true, { feedback, ...(title ? { title } : {}) });
    return 'chooser-opened';
  } catch (error) {
    return error?.name === 'AbortError' ? 'cancelled' : 'fallback';
  }
}

export async function saveLocalFile(file, { consent } = {}, {
  native = isAndroidApp, android = saveAndroidFile, download = downloadBlobFile,
} = {}) {
  if (!consent) return 'consent-required';
  if (native) {
    const result = await android(file, file.name);
    return result?.cancelled ? 'cancelled' : 'saved';
  }
  download(file.name, file);
  return 'download-started';
}
