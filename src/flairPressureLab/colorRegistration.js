import { wrap360, wrapDelta } from './gaugeConfig.js';
import {
  BAND_INNER_FRACTION,
  BAND_OUTER_FRACTION,
  ESPRESSO_SECTOR,
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

/**
 * Angular histograms of red chroma and darkness on the face annulus.
 * Red uses a chroma ratio, so a gain change does not move the sector.
 * Darkness is relative to the annulus median, so a shadow does not paint the whole face black.
 */
export function measureDialColorBands(image, cx, cy, radius, needleDeg = null) {
  const red = new Float32Array(BINS);
  const dark = new Float32Array(BINS);
  const { data, width, height } = image;
  const lumas = [];
  const samples = [];
  if (!(radius > 4)) {
    return { red, dark, redMass: 0, darkMass: 0, samples: 0 };
  }
  for (let deg = 0; deg < 360; deg += 3) {
    if (nearRay(deg, needleDeg, 14)) continue;
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    for (let t = 0; t <= 1; t += 0.34) {
      const rf = BAND_INNER_FRACTION + (BAND_OUTER_FRACTION - BAND_INNER_FRACTION) * t;
      const x = Math.round(cx + radius * rf * cos);
      const y = Math.round(cy + radius * rf * sin);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const o = (y * width + x) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const chroma = chromaOf(r, g, b);
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      lumas.push(lum);
      samples.push({ deg, chroma, lum });
    }
  }
  if (!lumas.length) {
    return { red, dark, redMass: 0, darkMass: 0, samples: 0 };
  }
  lumas.sort((a, b) => a - b);
  const median = lumas[Math.floor(lumas.length / 2)];
  const darkCut = median * 0.55;
  let redMass = 0;
  let darkMass = 0;
  for (const sample of samples) {
    const bin = Math.round(sample.deg / BIN_DEG) % BINS;
    if (sample.chroma >= CHROMA_MIN) {
      red[bin] += sample.chroma;
      redMass += sample.chroma;
    } else if (sample.lum <= darkCut) {
      dark[bin] += 1;
      darkMass += 1;
    }
  }
  return { red, dark, redMass, darkMass, samples: samples.length };
}

function sectorMidpoint(startDeg, endDeg) {
  return wrap360(startDeg + wrap360(endDeg - startDeg) / 2);
}

const ESPRESSO_MID = sectorMidpoint(ESPRESSO_SECTOR.startDeg, ESPRESSO_SECTOR.endDeg);
const STOP_MID = sectorMidpoint(STOP_SECTOR.startDeg, STOP_SECTOR.endDeg);

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
  const red = circularPeak(bands.red);
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
    // It does not throw away a sharp red centroid on its own.
    periodMargin = red.concentration * (dark.concentration > 0.35 ? agree : 1);
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
