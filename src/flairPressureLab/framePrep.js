/**
 * Shared frame prep for the pressure lab.
 * Subtract a local mean before edges so a global brightness change, or a slow
 * lighting gradient, does not look like a new needle or a new gauge.
 */

export function grayscale(data, width, height) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i += 1) {
    const offset = i * 4;
    gray[i] = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  }
  return gray;
}

export function boxBlur(src, width, height) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -1; k <= 1; k += 1) {
        const xx = x + k;
        if (xx < 0 || xx >= width) continue;
        sum += src[y * width + xx];
        count += 1;
      }
      tmp[y * width + x] = sum / count;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -1; k <= 1; k += 1) {
        const yy = y + k;
        if (yy < 0 || yy >= height) continue;
        sum += tmp[yy * width + x];
        count += 1;
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

/** Separable box mean. Border samples are clamped. */
export function boxMean(src, width, height, radius) {
  const r = Math.max(1, radius | 0);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = r * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -r; x <= r; x += 1) {
      sum += src[row + Math.min(width - 1, Math.max(0, x))];
    }
    for (let x = 0; x < width; x += 1) {
      tmp[row + x] = sum / win;
      sum -= src[row + Math.min(width - 1, Math.max(0, x - r))];
      sum += src[row + Math.min(width - 1, Math.max(0, x + r + 1))];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) {
      sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / win;
      sum -= tmp[Math.min(height - 1, Math.max(0, y - r)) * width + x];
      sum += tmp[Math.min(height - 1, Math.max(0, y + r + 1)) * width + x];
    }
  }
  return out;
}

/** High-pass image. Flat lighting and slow gradients fall out; edges remain. */
export function localContrast(gray, width, height, radius) {
  const mean = boxMean(gray, width, height, radius);
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) out[i] = gray[i] - mean[i];
  return out;
}

export function sobel(gray, width, height) {
  const mag = new Float32Array(gray.length);
  const gx = new Float32Array(gray.length);
  const gy = new Float32Array(gray.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const tl = gray[i - width - 1];
      const tc = gray[i - width];
      const tr = gray[i - width + 1];
      const ml = gray[i - 1];
      const mr = gray[i + 1];
      const bl = gray[i + width - 1];
      const bc = gray[i + width];
      const br = gray[i + width + 1];
      const gxValue = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gyValue = -tl - 2 * tc - tr + bl + 2 * bc + br;
      gx[i] = gxValue;
      gy[i] = gyValue;
      mag[i] = Math.hypot(gxValue, gyValue);
    }
  }
  return { mag, gx, gy };
}

export function prepareEdges(image, { contrastRadius } = {}) {
  const { data, width, height } = image;
  const gray = boxBlur(grayscale(data, width, height), width, height);
  const radius = contrastRadius ?? Math.max(3, Math.round(Math.min(width, height) / 14));
  const contrast = localContrast(gray, width, height, radius);
  return { gray: contrast, edges: sobel(contrast, width, height), width, height };
}
