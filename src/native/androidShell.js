import { Capacitor, registerPlugin } from '@capacitor/core';

export const isAndroidApp = Capacitor.getPlatform() === 'android';
export const AndroidShell = registerPlugin('AndroidShell');

const chunkSize = 256 * 1024;
const fileLimit = 64 * 1024 * 1024;
const replayLimit = 256 * 1024 * 1024;
const encodeChunk = (bytes) => typeof bytes.toBase64 === 'function'
  ? bytes.toBase64() : btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));

export function saveAndroidFile(file, filename, share = false, { feedback = false, title } = {}) {
  return stageAndroidFile(file, filename, { share, feedback, title });
}

export function saveAndroidReplay(file, filename) {
  return stageAndroidFile(file, filename, { replay: true });
}

async function stageAndroidFile(file, filename, { share = false, feedback = false, title, replay = false }) {
  const mimeType = file.type.split(';')[0];
  if (replay && !['video/mp4', 'video/webm'].includes(mimeType)) throw new Error('The replay video format is unsupported.');
  if (!file.size || file.size > (replay ? replayLimit : fileLimit)) {
    throw new Error(`Export must contain data and fit within ${replay ? '256' : '64'} MiB.`);
  }
  const id = crypto.randomUUID();
  const options = { id, filename, mimeType, byteCount: file.size };
  if (replay) await AndroidShell.beginReplayExport(options);
  else await AndroidShell.beginFileExport(options);
  try {
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const bytes = new Uint8Array(await file.slice(offset, Math.min(offset + chunkSize, file.size)).arrayBuffer());
      await AndroidShell.appendFileExport({ id, offset, data: encodeChunk(bytes) });
    }
    const result = await AndroidShell.exportFile({ id, share, feedback, ...(feedback && title ? { title } : {}) });
    if ((!share && result?.cancelled === true) || result?.bytesWritten === file.size) return result;
    throw new Error('Android could not confirm the complete export.');
  } catch (error) {
    await AndroidShell.cancelFileExport({ id }).catch(() => {});
    throw error;
  }
}

/** Save an archive without sending the entire binary through the bridge at once. */
export async function saveAndroidBackup(file, filename) {
  const { opened } = await AndroidShell.beginBackupExport({ filename });
  if (!opened) return false;
  try {
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const data = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
      await AndroidShell.appendBackupExport({ data: encodeChunk(data) });
    }
    await AndroidShell.finishBackupExport();
    return true;
  } catch (error) {
    await AndroidShell.cancelBackupExport().catch(() => {});
    throw error;
  }
}
