import { Capacitor, registerPlugin } from '@capacitor/core';

export const isAndroidApp = Capacitor.getPlatform() === 'android';
export const AndroidShell = registerPlugin('AndroidShell');

export function saveAndroidFile(file, filename, share = false) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => AndroidShell.exportFile({
      filename, mimeType: file.type, data: reader.result.split(',')[1], share,
    }).then(resolve, reject);
    reader.readAsDataURL(file);
  });
}
