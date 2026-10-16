import { discoverGaugeInFrame } from './gaugeTrack.js';

self.onmessage = (event) => {
  const { bitmap, width, height } = event.data || {};
  if (!bitmap || !width || !height) {
    self.postMessage({ found: null });
    return;
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  if (typeof bitmap.close === 'function') bitmap.close();
  const image = context.getImageData(0, 0, width, height);
  let found = null;
  try {
    found = discoverGaugeInFrame(image);
  } catch {
    found = null;
  }
  self.postMessage({ found });
};
