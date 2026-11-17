import { Capacitor, registerPlugin } from '@capacitor/core';

export const isAndroidApp = Capacitor.getPlatform() === 'android';
export const AndroidShell = registerPlugin('AndroidShell');

const chunkSize = 256 * 1024;
const encodeChunk = (bytes) => typeof bytes.toBase64 === 'function'
  ? bytes.toBase64() : btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));

export async function saveAndroidFile(file, filename, share = false, { feedback = false } = {}) {
  if (!file.size || file.size > 64 * 1024 * 1024) throw new Error('Export must contain data and fit within 64 MiB.');
  const id = crypto.randomUUID();
  await AndroidShell.beginFileExport({ id, filename, mimeType: file.type.split(';')[0], byteCount: file.size });
  try {
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const bytes = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
      await AndroidShell.appendFileExport({ id, offset, data: encodeChunk(bytes) });
    }
    const result = await AndroidShell.exportFile({ id, share, feedback });
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
