const MAX_EDGE = 240;
const JPEG_QUALITY = 0.72;

/**
 * Small JPEG data URL from an ImageData frame (bounded size, display compare only).
 * @param {ImageData} image
 * @returns {string | null}
 */
export function gaugeSnapshotJpegFromImageData(image) {
  if (!image?.data || typeof document === 'undefined') return null;
  const { width, height } = image;
  if (!(width > 0 && height > 0)) return null;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const tmp = document.createElement('canvas');
  tmp.width = width;
  tmp.height = height;
  tmp.getContext('2d')?.putImageData(image, 0, 0);
  ctx.drawImage(tmp, 0, 0, outW, outH);
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  if (!dataUrl || dataUrl.length > 120_000) return null;
  return dataUrl;
}
