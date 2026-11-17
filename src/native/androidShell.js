import { Capacitor, registerPlugin } from '@capacitor/core';

export const isAndroidApp = Capacitor.getPlatform() === 'android';
export const AndroidShell = registerPlugin('AndroidShell');

export function saveAndroidFile(file, filename, share = false, { feedback = false } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => AndroidShell.exportFile({
      filename, mimeType: file.type.split(';')[0], data: reader.result.split(',')[1], share, feedback,
    }).then(resolve, reject);
    reader.readAsDataURL(file);
  });
}

/** Save an archive without sending the entire binary through the bridge at once. */
export async function saveAndroidBackup(file, filename) {
  const { opened } = await AndroidShell.beginBackupExport({ filename });
  if (!opened) return false;
  try {
    const chunkSize = 256 * 1024;
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const data = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
      const base64 = typeof data.toBase64 === 'function'
        ? data.toBase64()
        : btoa(Array.from(data, (byte) => String.fromCharCode(byte)).join(''));
      await AndroidShell.appendBackupExport({ data: base64 });
    }
    await AndroidShell.finishBackupExport();
    return true;
  } catch (error) {
    await AndroidShell.cancelBackupExport().catch(() => {});
    throw error;
  }
}
