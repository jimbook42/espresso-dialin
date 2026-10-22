import { wrap360, wrapDelta } from './gaugeConfig.js';
import {
  DARK_BAND_INNER_FRACTION,
  DARK_BAND_OUTER_FRACTION,
  ESPRESSO_SECTOR,
  FLAIR_LOGO_ANGLE_DEG,
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

const ANNULUS_COS = new Float64Array(180);
const ANNULUS_SIN = new Float64Array(180);
for (let i = 0; i < 180; i += 1) {
  const rad = (i * 2 * Math.PI) / 180;
  ANNULUS_COS[i] = Math.cos(rad);
  ANNULUS_SIN[i] = Math.sin(rad);
}

function annulusPack() {
  return {
    deg: new Float64Array(720),
    chroma: new Float64Array(720),
    lum: new Float64Array(720),
    lumSort: new Float64Array(720),
  };
}

const redAnnulus = annulusPack();
const darkAnnulus = annulusPack();

function sampleAnnulus(image, cx, cy, radius, inner, outer, needleDeg, into) {
  const { data, width, height } = image;
  let n = 0;
  if (!(radius > 4)) return n;
  for (let i = 0; i < 180; i += 1) {
    const deg = i * 2;
    if (nearRay(deg, needleDeg, 14)) continue;
    const cos = ANNULUS_COS[i];
    const sin = ANNULUS_SIN[i];
    for (let t = 0; t <= 1; t += 0.34) {
      const rf = inner + (outer - inner) * t;
      const x = Math.round(cx + radius * rf * cos);
      const y = Math.round(cy + radius * rf * sin);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const o = (y * width + x) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      into.deg[n] = deg;
      into.chroma[n] = chromaOf(r, g, b);
      into.lum[n] = r * 0.299 + g * 0.587 + b * 0.114;
      n += 1;
    }
  }
  return n;
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
  const redN = sampleAnnulus(
    image, cx, cy, radius, RED_BAND_INNER_FRACTION, RED_BAND_OUTER_FRACTION, null, redAnnulus,
  );
  const darkN = sampleAnnulus(
    image, cx, cy, radius, DARK_BAND_INNER_FRACTION, DARK_BAND_OUTER_FRACTION, needleDeg, darkAnnulus,
  );
  let redMass = 0;
  for (let i = 0; i < redN; i += 1) {
    const chroma = redAnnulus.chroma[i];
    if (chroma < CHROMA_MIN) continue;
    const bin = Math.round(redAnnulus.deg[i] / BIN_DEG) % BINS;
    red[bin] += chroma;
    redMass += chroma;
  }
  let darkMass = 0;
  if (darkN) {
    const lumSort = darkAnnulus.lumSort;
    for (let i = 0; i < darkN; i += 1) lumSort[i] = darkAnnulus.lum[i];
    lumSort.subarray(0, darkN).sort((a, b) => a - b);
    const darkCut = lumSort[Math.floor(darkN / 2)] * 0.62;
    for (let i = 0; i < darkN; i += 1) {
      const chroma = darkAnnulus.chroma[i];
      const lum = darkAnnulus.lum[i];
      if (chroma >= CHROMA_MIN || lum > darkCut) continue;
      const bin = Math.round(darkAnnulus.deg[i] / BIN_DEG) % BINS;
      dark[bin] += 1;
      darkMass += 1;
    }
  }
  // The script is dark and wide, inside the red block. A bright end of the
  // espresso sector pulls the red centroid; the script does not.
  const logoHist = new Float32Array(BINS);
  const logoN = sampleAnnulus(image, cx, cy, radius, 0.28, 0.48, needleDeg, darkAnnulus);
  let logoMass = 0;
  if (logoN) {
    const lumSort = darkAnnulus.lumSort;
    for (let i = 0; i < logoN; i += 1) lumSort[i] = darkAnnulus.lum[i];
    lumSort.subarray(0, logoN).sort((a, b) => a - b);
    const cut = lumSort[Math.floor(logoN / 2)] * 0.75;
    for (let i = 0; i < logoN; i += 1) {
      if (darkAnnulus.chroma[i] >= CHROMA_MIN || darkAnnulus.lum[i] > cut) continue;
      const bin = Math.round(darkAnnulus.deg[i] / BIN_DEG) % BINS;
      logoHist[bin] += 1;
      logoMass += 1;
    }
  }
  return {
    red,
    dark,
    redMass,
    darkMass,
    samples: redN + darkN + logoN,
    logoDeg: logoMass >= 6 ? wideDarkMidpoint(logoHist) : null,
  };
}

function inSector(deg, startDeg, endDeg) {
  return wrap360(deg - startDeg) <= wrap360(endDeg - startDeg);
}

/** Midpoint of the widest dark run that is a script, not a thin pointer or a shadow. */
function wideDarkMidpoint(hist) {
  let max = 0;
  for (let i = 0; i < BINS; i += 1) if (hist[i] > max) max = hist[i];
  if (max <= 0) return null;
  const floor = max * 0.35;
  const active = [];
  for (let i = 0; i < BINS; i += 1) active.push(hist[i] >= floor);
  let origin = 0;
  while (origin < BINS && active[origin]) origin += 1;
  if (origin === BINS) return null;
  let best = null;
  for (let k = 0; k < BINS; k += 1) {
    const i = (origin + k) % BINS;
    if (!active[i] || active[(i - 1 + BINS) % BINS]) continue;
    let width = 0;
    for (let t = 0; t < BINS; t += 1) {
      if (!active[(i + t) % BINS]) break;
      width += 1;
    }
    const widthDeg = width * BIN_DEG;
    if (widthDeg < 18 || widthDeg > 70) continue;
    if (!best || width > best.width) {
      best = { width, deg: wrap360(i * BIN_DEG + widthDeg / 2) };
    }
  }
  return best ? best.deg : null;
}

function massNearSector(hist, startDeg, endDeg, padDeg) {
  let inside = 0;
  let total = 0;
  for (let i = 0; i < BINS; i += 1) {
    const weight = hist[i];
    if (weight <= 0) continue;
    total += weight;
    if (inSector(i * BIN_DEG, startDeg - padDeg, endDeg + padDeg)) inside += weight;
  }
  return total > 0 ? inside / total : 0;
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
    let gap = 0;
    // A pointer on the block opens a short hole. Bridge it. The Flair script
    // sits far from the block, so a long gap still ends the run.
    const maxGap = 4;
    for (let t = 0; t < BINS; t += 1) {
      const j = (i + t) % BINS;
      if (!active[j]) {
        gap += 1;
        if (gap > maxGap) break;
        continue;
      }
      gap = 0;
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
  let rotationDeg = wrap360(red.deg - ESPRESSO_MID);
  // The red centroid is the bright end of the block when one side is in shadow.
  // The script is a fixed offset from zero, so it wins when the two disagree
  // and the block still sits on that same rotation.
  if (Number.isFinite(bands.logoDeg)) {
    const fromScript = wrap360(bands.logoDeg - FLAIR_LOGO_ANGLE_DEG);
    const pulled = Math.abs(wrapDelta(fromScript, rotationDeg));
    const cover = massNearSector(
      bands.red,
      ESPRESSO_SECTOR.startDeg + fromScript,
      ESPRESSO_SECTOR.endDeg + fromScript,
      40,
    );
    if (pulled > 25 && cover >= 0.45) rotationDeg = fromScript;
  }
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
