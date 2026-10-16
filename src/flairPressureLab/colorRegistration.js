import { wrap360, wrapDelta } from './gaugeConfig.js';
import {
  DARK_BAND_INNER_FRACTION,
  DARK_BAND_OUTER_FRACTION,
  ESPRESSO_SECTOR,
  RED_BAND_INNER_FRACTION,
  RED_BAND_OUTER_FRACTION,
  STOP_SECTOR,
} from './dialFaceTemplate.js';

const BINS = 72;
const BIN_DEG = 360 / BINS;
const CHROMA_MIN = 0.08;
const BAND_AGREE_DEG = 10;
const PERIOD_MARGIN_MIN = 0.08;

function chromaOf(r, g, b) {
  const excess = r - Math.max(g, b);
  if (excess <= 0) return 0;
  return excess / ((r + g + b) / 3 + 1);
}

function nearRay(deg, needleDeg, half) {
  if (needleDeg == null) return false;
  return Math.abs(wrapDelta(needleDeg, deg)) <= half
    || Math.abs(wrapDelta(wrap360(needleDeg + 180), deg)) <= half;
}

function sampleAnnulus(image, cx, cy, radius, inner, outer, needleDeg) {
  const { data, width, height } = image;
  const samples = [];
  if (!(radius > 4)) return samples;
  for (let deg = 0; deg < 360; deg += 2) {
    if (nearRay(deg, needleDeg, 14)) continue;
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    for (let t = 0; t <= 1; t += 0.34) {
      const rf = inner + (outer - inner) * t;
      const x = Math.round(cx + radius * rf * cos);
      const y = Math.round(cy + radius * rf * sin);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const o = (y * width + x) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      samples.push({
        deg,
        chroma: chromaOf(r, g, b),
        lum: r * 0.299 + g * 0.587 + b * 0.114,
      });
    }
  }
  return samples;
}

/**
 * Angular histograms of red chroma and darkness.
 * Red is the solid Espresso block (mid-face). Darkness is the outer STOP band.
 * Red uses a chroma ratio, so a gain change does not move the sector.
 * Darkness is relative to that annulus median, so a shadow does not paint the face black.
 * The red Flair script is a second, smaller blob and is not the sector centroid.
 */
export function measureDialColorBands(image, cx, cy, radius, needleDeg = null) {
  const red = new Float32Array(BINS);
  const dark = new Float32Array(BINS);
  const redSamples = sampleAnnulus(
    image, cx, cy, radius, RED_BAND_INNER_FRACTION, RED_BAND_OUTER_FRACTION, null,
  );
  const darkSamples = sampleAnnulus(
    image, cx, cy, radius, DARK_BAND_INNER_FRACTION, DARK_BAND_OUTER_FRACTION, needleDeg,
  );
  let redMass = 0;
  for (const sample of redSamples) {
    if (sample.chroma < CHROMA_MIN) continue;
    const bin = Math.round(sample.deg / BIN_DEG) % BINS;
    red[bin] += sample.chroma;
    redMass += sample.chroma;
  }
  let darkMass = 0;
  if (darkSamples.length) {
    const lumas = darkSamples.map((sample) => sample.lum).sort((a, b) => a - b);
    const darkCut = lumas[Math.floor(lumas.length / 2)] * 0.62;
    for (const sample of darkSamples) {
      if (sample.chroma >= CHROMA_MIN || sample.lum > darkCut) continue;
      const bin = Math.round(sample.deg / BIN_DEG) % BINS;
      dark[bin] += 1;
      darkMass += 1;
    }
  }
  return {
    red,
    dark,
    redMass,
    darkMass,
    samples: redSamples.length + darkSamples.length,
  };
}

function sectorMidpoint(startDeg, endDeg) {
  return wrap360(startDeg + wrap360(endDeg - startDeg) / 2);
}

const ESPRESSO_MID = sectorMidpoint(ESPRESSO_SECTOR.startDeg, ESPRESSO_SECTOR.endDeg);
const STOP_MID = sectorMidpoint(STOP_SECTOR.startDeg, STOP_SECTOR.endDeg);

/**
 * Centroid of the heaviest contiguous red run.
 * The Espresso block outweighs the Flair script, so the script does not move zero.
 */
function dominantRunCentroid(hist) {
  let max = 0;
  for (let i = 0; i < BINS; i += 1) if (hist[i] > max) max = hist[i];
  if (max <= 0) return { mass: 0, deg: 0, concentration: 0 };
  const floor = max * 0.22;
  const active = [];
  for (let i = 0; i < BINS; i += 1) active.push(hist[i] >= floor);
  let origin = 0;
  while (origin < BINS && active[origin]) origin += 1;
  if (origin === BINS) return circularPeak(hist);
  let best = null;
  for (let k = 0; k < BINS; k += 1) {
    const i = (origin + k) % BINS;
    if (!active[i] || active[(i - 1 + BINS) % BINS]) continue;
    let mass = 0;
    let sin = 0;
    let cos = 0;
    for (let t = 0; t < BINS; t += 1) {
      const j = (i + t) % BINS;
      if (!active[j]) break;
      const weight = hist[j];
      const rad = ((j * BIN_DEG) * Math.PI) / 180;
      sin += weight * Math.sin(rad);
      cos += weight * Math.cos(rad);
      mass += weight;
    }
    if (!best || mass > best.mass) {
      best = {
        mass,
        deg: wrap360((Math.atan2(sin, cos) * 180) / Math.PI),
        concentration: mass > 0 ? Math.hypot(sin, cos) / mass : 0,
      };
    }
  }
  return best || { mass: 0, deg: 0, concentration: 0 };
}

function circularPeak(hist) {
  let sin = 0;
  let cos = 0;
  let mass = 0;
  for (let i = 0; i < BINS; i += 1) {
    const weight = hist[i];
    if (weight <= 0) continue;
    const rad = ((i * BIN_DEG) * Math.PI) / 180;
    sin += weight * Math.sin(rad);
    cos += weight * Math.cos(rad);
    mass += weight;
  }
  if (mass < 1e-4) return { mass: 0, deg: 0, concentration: 0 };
  const concentration = Math.hypot(sin, cos) / mass;
  return {
    mass,
    deg: wrap360((Math.atan2(sin, cos) * 180) / Math.PI),
    concentration,
  };
}

/**
 * Rotation of the printed face. The red sector's angular centroid is the
 * rotation; the dark stop centroid has to land on the same rotation.
 * A flat colour field has no centroid (concentration near 0).
 */
export function registerDialFromColorBands(bands) {
  const empty = { ok: false, rotationDeg: 0, confidence: 0, periodMargin: 0 };
  if (!bands || bands.redMass < 0.4) return empty;
  const red = dominantRunCentroid(bands.red);
  if (red.concentration < 0.45) {
    return { ...empty, confidence: red.concentration, periodMargin: red.concentration };
  }
  const rotationDeg = wrap360(red.deg - ESPRESSO_MID);
  let periodMargin = red.concentration;
  if (bands.darkMass >= 4) {
    const dark = circularPeak(bands.dark);
    const expected = wrap360(STOP_MID + rotationDeg);
    const miss = Math.abs(wrapDelta(expected, dark.deg));
    const agree = miss <= BAND_AGREE_DEG ? 1 : Math.max(0, 1 - miss / 90);
    // A sharp dark peak that misses the stop sector lowers confidence.
    // A shadow can invent that peak. It does not erase a red centroid the
    // concentration gate has already accepted unless the dark peak is itself
    // very sharp.
    const veto = dark.concentration > 0.35 ? agree : 1;
    const shadowFloor = 1 - Math.min(dark.concentration, 0.85);
    periodMargin = red.concentration * Math.max(veto, shadowFloor);
  }
  if (periodMargin < PERIOD_MARGIN_MIN) {
    return { ...empty, confidence: red.concentration, periodMargin };
  }
  return {
    ok: true,
    rotationDeg,
    confidence: red.concentration,
    periodMargin,
  };
}
