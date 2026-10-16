/**
 * Shared frame prep for the pressure lab.
 * Subtract a local mean before edges so a global brightness change, or a slow
 * lighting gradient, does not look like a new needle or a new gauge.
 */

export function grayscale(data, width, height) {
  const gray = new Float32Array(width * height);
  grayscaleInto(data, width, height, gray);
  return gray;
}

function grayscaleInto(data, width, height, gray) {
  const n = width * height;
  for (let i = 0; i < n; i += 1) {
    const offset = i * 4;
    gray[i] = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  }
  return gray;
}

/**
 * 3×3 box. Interior samples use a fixed window of 3 so the edge branch
 * stays off the hot path. Edge pixels still divide by the in-bounds count.
 */
export function boxBlur(src, width, height) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  boxBlurInto(src, width, height, tmp, out);
  return out;
}

function boxBlurInto(src, width, height, tmp, out) {
  if (width >= 3 && height >= 3) {
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      tmp[row] = (src[row] + src[row + 1]) * 0.5;
      const last = row + width - 1;
      tmp[last] = (src[last - 1] + src[last]) * 0.5;
      for (let x = 1; x < width - 1; x += 1) {
        const i = row + x;
        tmp[i] = (src[i - 1] + src[i] + src[i + 1]) / 3;
      }
    }
    const rowBytes = width;
    out[0] = (tmp[0] + tmp[rowBytes]) * 0.5;
    for (let x = 1; x < width - 1; x += 1) out[x] = (tmp[x] + tmp[rowBytes + x]) * 0.5;
    out[width - 1] = (tmp[width - 1] + tmp[rowBytes + width - 1]) * 0.5;
    const lastRow = (height - 1) * width;
    const prevRow = (height - 2) * width;
    out[lastRow] = (tmp[prevRow] + tmp[lastRow]) * 0.5;
    for (let x = 1; x < width - 1; x += 1) out[lastRow + x] = (tmp[prevRow + x] + tmp[lastRow + x]) * 0.5;
    out[lastRow + width - 1] = (tmp[prevRow + width - 1] + tmp[lastRow + width - 1]) * 0.5;
    for (let y = 1; y < height - 1; y += 1) {
      const row = y * width;
      const up = row - width;
      const down = row + width;
      out[row] = (tmp[up] + tmp[row] + tmp[down]) / 3;
      out[row + width - 1] = (tmp[up + width - 1] + tmp[row + width - 1] + tmp[down + width - 1]) / 3;
      for (let x = 1; x < width - 1; x += 1) {
        out[row + x] = (tmp[up + x] + tmp[row + x] + tmp[down + x]) / 3;
      }
    }
    return out;
  }
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
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  boxMeanInto(src, width, height, radius, tmp, out);
  return out;
}

function boxMeanInto(src, width, height, radius, tmp, out) {
  const r = Math.max(1, radius | 0);
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

function sobelInto(gray, width, height, mag, gx, gy) {
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    const up = row - width;
    const down = row + width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;
      const tl = gray[up + x - 1];
      const tc = gray[up + x];
      const tr = gray[up + x + 1];
      const ml = gray[i - 1];
      const mr = gray[i + 1];
      const bl = gray[down + x - 1];
      const bc = gray[down + x];
      const br = gray[down + x + 1];
      const gxValue = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gyValue = -tl - 2 * tc - tr + bl + 2 * bc + br;
      gx[i] = gxValue;
      gy[i] = gyValue;
      // Same magnitude as Math.hypot while the Sobel sums stay in a normal range.
      mag[i] = Math.sqrt(gxValue * gxValue + gyValue * gyValue);
    }
  }
  return { mag, gx, gy };
}

export function sobel(gray, width, height) {
  const mag = new Float32Array(gray.length);
  const gx = new Float32Array(gray.length);
  const gy = new Float32Array(gray.length);
  return sobelInto(gray, width, height, mag, gx, gy);
}

function clearEdgeBorder(arr, width, height) {
  arr.fill(0, 0, width);
  const last = (height - 1) * width;
  arr.fill(0, last, last + width);
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    arr[row] = 0;
    arr[row + width - 1] = 0;
  }
}

const edgeSlots = new Map();

function takeEdgeSlot(width, height) {
  const key = width * 100000 + height;
  let ring = edgeSlots.get(key);
  if (!ring) {
    const make = () => ({
      gray: new Float32Array(width * height),
      blurTmp: new Float32Array(width * height),
      blur: new Float32Array(width * height),
      meanTmp: new Float32Array(width * height),
      mean: new Float32Array(width * height),
      contrast: new Float32Array(width * height),
      mag: new Float32Array(width * height),
      gx: new Float32Array(width * height),
      gy: new Float32Array(width * height),
    });
    ring = { slots: [make(), make(), make()], i: 0 };
    edgeSlots.set(key, ring);
  }
  const slot = ring.slots[ring.i];
  ring.i = (ring.i + 1) % ring.slots.length;
  return slot;
}

export function prepareEdges(image, { contrastRadius } = {}) {
  const { data, width, height } = image;
  const slot = takeEdgeSlot(width, height);
  grayscaleInto(data, width, height, slot.gray);
  boxBlurInto(slot.gray, width, height, slot.blurTmp, slot.blur);
  const radius = contrastRadius ?? Math.max(3, Math.round(Math.min(width, height) / 14));
  boxMeanInto(slot.blur, width, height, radius, slot.meanTmp, slot.mean);
  const contrast = slot.contrast;
  const blurred = slot.blur;
  const mean = slot.mean;
  for (let i = 0; i < contrast.length; i += 1) contrast[i] = blurred[i] - mean[i];
  clearEdgeBorder(slot.mag, width, height);
  clearEdgeBorder(slot.gx, width, height);
  clearEdgeBorder(slot.gy, width, height);
  sobelInto(contrast, width, height, slot.mag, slot.gx, slot.gy);
  return {
    gray: contrast,
    edges: { mag: slot.mag, gx: slot.gx, gy: slot.gy },
    width,
    height,
  };
}
