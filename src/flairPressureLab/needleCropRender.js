import { mulberry32 } from '../../scripts/pressure-replay/syntheticLayout.js';
import {
  CANONICAL_ZERO_BAR_ANGLE_DEG,
  DARK_BAND_INNER_FRACTION,
  DARK_BAND_OUTER_FRACTION,
  ESPRESSO_SECTOR,
  FLAIR_LOGO_ANGLE_DEG,
  RED_BAND_INNER_FRACTION,
  RED_BAND_OUTER_FRACTION,
  REGISTRATION_PINS,
  STOP_SECTOR,
  barToDialAngle,
} from './dialFaceTemplate.js';
import { FLAIR_58_SCALE, OUTER_RADIUS_RATIO, TIP_INNER_RATIO, wrap360 } from './gaugeConfig.js';
import { NEEDLE_CROP_HALF_SCALE, NEEDLE_INPUT_SIZE } from './needleModel.js';

/**
 * Synthetic registered-face crops for the needle model.
 * Tick count, sweep, sectors, and needle span come from the measured template.
 * Pixel size is the model input. A 2× paint is averaged down so a thin needle survives.
 * Seeds pick appearance. They are not frame positions from a clip.
 */

const OUT = NEEDLE_INPUT_SIZE;
const SS = 2;
const HI = OUT * SS;
const HALF = NEEDLE_CROP_HALF_SCALE;
const TICK_COUNT = 21;
const SWEEP = FLAIR_58_SCALE.sweepDeg;
const SPACING = SWEEP / (TICK_COUNT - 1);

function clampByte(value) {
  return Math.max(0, Math.min(255, value));
}

function inSector(deg, startDeg, endDeg) {
  const span = ((endDeg - startDeg) % 360 + 360) % 360;
  const offset = ((deg - startDeg) % 360 + 360) % 360;
  return offset <= span;
}

function lerp(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

/**
 * Needle direction in the crop after residual rotation and a slight ellipse stretch.
 * Translation of the hub does not change that direction.
 */
export function imageNeedleAngleDeg(canonDeg, { residualDeg = 0, aspect = 1 } = {}) {
  const canon = (canonDeg * Math.PI) / 180;
  const theta = (residualDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const xd = Math.cos(canon);
  const yd = Math.sin(canon);
  const x = (xd * cos - yd * sin) * aspect;
  const y = xd * sin + yd * cos;
  return wrap360((Math.atan2(y, x) * 180) / Math.PI);
}

function imageToDial(x, y, p) {
  const dx = (x - p.tx) / (p.scale * p.aspect);
  const dy = (y - p.ty) / p.scale;
  return [
    p.cos * dx + p.sin * dy,
    -p.sin * dx + p.cos * dy,
  ];
}

function paintDial(rgb, mask, p) {
  const needleRad = (p.canonDeg * Math.PI) / 180;
  const nCos = Math.cos(needleRad);
  const nSin = Math.sin(needleRad);
  for (let j = 0; j < HI; j += 1) {
    const y = ((j + 0.5) / HI - 0.5) * 2 * HALF;
    for (let i = 0; i < HI; i += 1) {
      const x = ((i + 0.5) / HI - 0.5) * 2 * HALF;
      const [xd, yd] = imageToDial(x, y, p);
      const r = Math.hypot(xd, yd);
      const ang = wrap360((Math.atan2(yd, xd) * 180) / Math.PI);
      let color = p.outside;
      if (r <= 1.06) color = p.bezel;
      if (r <= 0.96) color = p.face;
      if (r >= RED_BAND_INNER_FRACTION && r <= RED_BAND_OUTER_FRACTION
        && inSector(ang, ESPRESSO_SECTOR.startDeg, ESPRESSO_SECTOR.endDeg)) {
        color = p.red;
      }
      if (r >= DARK_BAND_INNER_FRACTION && r <= DARK_BAND_OUTER_FRACTION
        && inSector(ang, STOP_SECTOR.startDeg, STOP_SECTOR.endDeg)) {
        color = p.stop;
      }
      const logoR = Math.hypot(xd - p.logoX, yd - p.logoY);
      if (logoR < 0.07) color = p.red;
      if (r > 0.68 && r < 0.98) {
        const rel = wrap360(ang - CANONICAL_ZERO_BAR_ANGLE_DEG);
        if (rel <= SWEEP + 3) {
          const k = Math.round(rel / SPACING);
          if (k >= 0 && k < TICK_COUNT) {
            const tickDeg = CANONICAL_ZERO_BAR_ANGLE_DEG + k * SPACING;
            const delta = ((ang - tickDeg + 540) % 360) - 180;
            const cross = Math.abs(delta * Math.PI / 180) * r;
            const major = k % 2 === 0;
            const inner = major ? 0.70 : 0.80;
            const limit = major ? 0.02 : 0.013;
            if (r >= inner && r <= 0.96 && cross < limit) color = p.tick;
          }
        }
      }
      for (let pin = 0; pin < REGISTRATION_PINS.length; pin += 1) {
        const pinRad = (REGISTRATION_PINS[pin].angleDeg * Math.PI) / 180;
        const px = REGISTRATION_PINS[pin].radiusFraction * Math.cos(pinRad);
        const py = REGISTRATION_PINS[pin].radiusFraction * Math.sin(pinRad);
        if (Math.hypot(xd - px, yd - py) < 0.035) color = p.pin;
      }
      let onNeedle = false;
      if (p.drawNeedle) {
        const along = xd * nCos + yd * nSin;
        const cross = -xd * nSin + yd * nCos;
        const pointer = along > TIP_INNER_RATIO && along < OUTER_RADIUS_RATIO
          && Math.abs(cross) < p.needleHalf;
        const tail = along < -0.08 && along > -0.28 && Math.abs(cross) < p.needleHalf * 0.65;
        if (pointer || tail) {
          color = p.needle;
          onNeedle = pointer;
        }
      }
      if (r < 0.13) color = p.hub;
      const o = (j * HI + i) * 3;
      rgb[o] = color[0];
      rgb[o + 1] = color[1];
      rgb[o + 2] = color[2];
      if (onNeedle && r >= 0.13) mask[j * HI + i] = 1;
    }
  }
}

function blendDisc(rgb, mask, cx, cy, rx, ry, color, cover) {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(HI - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(HI - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const o = (y * HI + x) * 3;
      rgb[o] = color[0];
      rgb[o + 1] = color[1];
      rgb[o + 2] = color[2];
      if (cover && mask[y * HI + x] === 1) mask[y * HI + x] = 2;
    }
  }
}

function addGlare(rgb, mask, rng) {
  const cx = lerp(rng, HI * 0.15, HI * 0.85);
  const cy = lerp(rng, HI * 0.15, HI * 0.85);
  const rx = lerp(rng, HI * 0.08, HI * 0.28);
  const ry = lerp(rng, HI * 0.05, HI * 0.2);
  const gain = lerp(rng, 70, 180);
  for (let y = 0; y < HI; y += 1) {
    for (let x = 0; x < HI; x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const add = gain * (1 - d2);
      const o = (y * HI + x) * 3;
      rgb[o] = clampByte(rgb[o] + add);
      rgb[o + 1] = clampByte(rgb[o + 1] + add);
      rgb[o + 2] = clampByte(rgb[o + 2] + add * 0.92);
      if (mask[y * HI + x] === 1 && rgb[o] > 235 && rgb[o + 1] > 235) mask[y * HI + x] = 2;
    }
  }
}

function downsample(rgb) {
  const out = new Uint8ClampedArray(OUT * OUT * 4);
  for (let y = 0; y < OUT; y += 1) {
    for (let x = 0; x < OUT; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SS; dy += 1) {
        for (let dx = 0; dx < SS; dx += 1) {
          const o = ((y * SS + dy) * HI + (x * SS + dx)) * 3;
          r += rgb[o];
          g += rgb[o + 1];
          b += rgb[o + 2];
        }
      }
      const p = (y * OUT + x) * 4;
      out[p] = r / 4;
      out[p + 1] = g / 4;
      out[p + 2] = b / 4;
      out[p + 3] = 255;
    }
  }
  return out;
}

function countMask(mask) {
  let visible = 0;
  let hidden = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] === 1) visible += 1;
    else if (mask[i] === 2) hidden += 1;
  }
  return { visible, hidden };
}

/**
 * One 64×64 RGBA crop.
 * `bar` is the printed pressure before residual rotation. The returned angle is the
 * needle direction in the image, which is what the network is asked to read.
 */
export function renderNeedleCrop({
  seed = 1,
  bar = null,
  negative = false,
  clean = false,
  residualDeg = null,
  aspect = null,
} = {}) {
  const rng = mulberry32(seed >>> 0);
  const blank = negative && rng() < 0.42;
  const noNeedle = negative && !blank && rng() < 0.55;
  const covered = negative && !blank && !noNeedle;
  const drawnBar = bar != null
    ? bar
    : lerp(rng, -0.45, FLAIR_58_SCALE.maxBar + 0.45);
  const canonDeg = barToDialAngle(drawnBar);
  const residual = residualDeg != null
    ? residualDeg
    : (clean ? lerp(rng, -1.2, 1.2) : lerp(rng, -10, 10));
  const stretch = aspect != null
    ? aspect
    : (clean ? lerp(rng, 0.97, 1.03) : lerp(rng, 0.86, 1.16));
  const theta = (residual * Math.PI) / 180;
  const logoRad = (FLAIR_LOGO_ANGLE_DEG * Math.PI) / 180;
  const params = {
    canonDeg,
    residualDeg: residual,
    aspect: stretch,
    scale: clean ? lerp(rng, 0.98, 1.02) : lerp(rng, 0.9, 1.1),
    tx: clean ? lerp(rng, -0.02, 0.02) : lerp(rng, -0.06, 0.06),
    ty: clean ? lerp(rng, -0.02, 0.02) : lerp(rng, -0.06, 0.06),
    cos: Math.cos(theta),
    sin: Math.sin(theta),
    drawNeedle: !blank && !noNeedle,
    needleHalf: clean ? 0.05 : lerp(rng, 0.038, 0.07),
    face: [lerp(rng, 176, 236), lerp(rng, 170, 228), lerp(rng, 160, 214)],
    bezel: [lerp(rng, 28, 80), lerp(rng, 28, 76), lerp(rng, 30, 78)],
    outside: [lerp(rng, 12, 48), lerp(rng, 12, 44), lerp(rng, 12, 42)],
    red: [lerp(rng, 150, 210), lerp(rng, 28, 70), lerp(rng, 28, 64)],
    stop: [lerp(rng, 8, 36), lerp(rng, 8, 32), lerp(rng, 8, 30)],
    tick: [lerp(rng, 8, 40), lerp(rng, 8, 36), lerp(rng, 8, 34)],
    needle: [lerp(rng, 4, 36), lerp(rng, 4, 32), lerp(rng, 4, 30)],
    hub: [lerp(rng, 70, 130), lerp(rng, 70, 126), lerp(rng, 72, 124)],
    pin: [lerp(rng, 190, 240), lerp(rng, 190, 236), lerp(rng, 188, 230)],
    logoX: 0.50 * Math.cos(logoRad),
    logoY: 0.50 * Math.sin(logoRad),
  };
  const rgb = new Uint8Array(HI * HI * 3);
  const mask = new Uint8Array(HI * HI);
  if (blank) {
    for (let i = 0; i < rgb.length; i += 3) {
      const n = lerp(rng, 0, 255);
      rgb[i] = n;
      rgb[i + 1] = lerp(rng, 0, 255);
      rgb[i + 2] = lerp(rng, 0, 255);
    }
  } else {
    paintDial(rgb, mask, params);
    if (!clean && rng() < 0.55) addGlare(rgb, mask, rng);
    if (covered) {
      blendDisc(rgb, mask, HI * 0.5, HI * 0.5, HI * 0.46, HI * 0.42, [20, 16, 14], true);
    } else if (!clean && rng() < 0.45) {
      const hands = 1 + (rng() < 0.4 ? 1 : 0);
      for (let h = 0; h < hands; h += 1) {
        blendDisc(
          rgb,
          mask,
          lerp(rng, 0, HI),
          lerp(rng, 0, HI),
          lerp(rng, HI * 0.08, HI * 0.28),
          lerp(rng, HI * 0.05, HI * 0.2),
          [lerp(rng, 30, 90), lerp(rng, 24, 60), lerp(rng, 20, 50)],
          true,
        );
      }
    }
    if (!clean) {
      const gain = lerp(rng, 0.72, 1.28);
      const bias = lerp(rng, -18, 18);
      for (let i = 0; i < rgb.length; i += 1) {
        const noise = lerp(rng, -10, 10);
        rgb[i] = clampByte(rgb[i] * gain + bias + noise);
      }
    }
  }
  const { visible, hidden } = countMask(mask);
  const total = visible + hidden;
  let confidence = 0;
  if (!negative && total > 0) {
    confidence = visible / total;
    if (confidence < 0.35) confidence = 0;
  }
  const angleDeg = params.drawNeedle
    ? imageNeedleAngleDeg(canonDeg, params)
    : 0;
  return {
    rgba: downsample(rgb),
    size: OUT,
    angleDeg,
    bar: drawnBar,
    confidence,
    negative: negative || confidence === 0,
    easy: clean && !negative && confidence > 0.85,
    residualDeg: residual,
  };
}
