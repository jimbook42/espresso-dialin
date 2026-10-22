/**
 * Offline geometry check. Reads a few training frames, runs the rectify /
 * needle / registration path, and writes overlay PNGs. Not used at runtime.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setOpenCvForTests } from '../../src/flairPressureLab/opencvRuntime.js';
import { rectifyGaugeFace } from '../../src/flairPressureLab/faceRectify.js';
import {
  discoverGaugeInFrame,
  measureRimProfile,
  matchGaugeRotation,
  registerDialRotationFromProfile,
} from '../../src/flairPressureLab/gaugeTrack.js';
import { detectNeedleAngle, refineNeedleAngle } from '../../src/flairPressureLab/needleFromFrame.js';
import { prepareEdges } from '../../src/flairPressureLab/framePrep.js';
import { measureDialColorBands, registerDialFromColorBands } from '../../src/flairPressureLab/colorRegistration.js';
import {
  FLAIR_58_SCALE,
  OUTER_RADIUS_RATIO,
  TIP_INNER_RATIO,
  angleToBar,
  wrap360,
} from '../../src/flairPressureLab/gaugeConfig.js';
import {
  CANONICAL_ZERO_BAR_ANGLE_DEG,
  FLAIR_STATELESS_SESSION,
  buildFlairCanonicalDialProfile,
} from '../../src/flairPressureLab/canonicalDial.js';

const require = createRequire(new URL('../../package.json', import.meta.url));
let cv = require('@techstark/opencv-js');
if (typeof cv?.then === 'function') cv = await cv;
if (!cv.Mat) await new Promise((resolve) => { cv.onRuntimeInitialized = resolve; });
setOpenCvForTests(cv);

const OUT = '/workspace/pl-state/diag';
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { clip: '20261018_160844', phase: 'rest', t: 6, expect: 0 },
  { clip: '20261018_160844', phase: 'pi', t: 16, expect: 2 },
  { clip: '20261018_160844', phase: 'peak', t: 20, expect: 8 },
  { clip: '20261017_084814', phase: 'rest', t: 4, expect: 0 },
  { clip: '20261017_084814', phase: 'peak', t: 22, expect: 8 },
];

function grab(file, t) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-noautorotate',
    '-i', file, '-ss', String(t), '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
  ], { maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0 || result.stdout.length !== 1280 * 720 * 4) {
    throw new Error(`frame ${file} @ ${t}s is ${result.stdout?.length || 0} bytes`);
  }
  return {
    width: 1280,
    height: 720,
    data: new Uint8ClampedArray(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength),
  };
}

function barOf(relative, clockwise) {
  return angleToBar(relative, { ...FLAIR_STATELESS_SESSION, clockwise });
}

function setPx(buf, w, h, x, y, rgb) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= w || yi >= h) return;
  const o = (yi * w + xi) * 4;
  buf[o] = rgb[0];
  buf[o + 1] = rgb[1];
  buf[o + 2] = rgb[2];
  buf[o + 3] = 255;
}

function line(buf, w, h, x0, y0, x1, y1, rgb) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    setPx(buf, w, h, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, rgb);
  }
}

function ray(buf, w, h, cx, cy, radius, deg, from, to, rgb) {
  const rad = (deg * Math.PI) / 180;
  line(
    buf, w, h,
    cx + radius * from * Math.cos(rad),
    cy + radius * from * Math.sin(rad),
    cx + radius * to * Math.cos(rad),
    cy + radius * to * Math.sin(rad),
    rgb,
  );
}

function blit(dst, dw, dh, dx, dy, src) {
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const sx = dx + x;
      const sy = dy + y;
      if (sx < 0 || sy < 0 || sx >= dw || sy >= dh) continue;
      const so = (y * src.width + x) * 4;
      const dO = (sy * dw + sx) * 4;
      dst[dO] = src.data[so];
      dst[dO + 1] = src.data[so + 1];
      dst[dO + 2] = src.data[so + 2];
      dst[dO + 3] = 255;
    }
  }
}

function darkReach(image, cx, cy, radius, deg) {
  const rad = (deg * Math.PI) / 180;
  let far = 0;
  for (let f = 0.2; f <= 0.9; f += 0.02) {
    const x = Math.round(cx + radius * f * Math.cos(rad));
    const y = Math.round(cy + radius * f * Math.sin(rad));
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) break;
    const o = (y * image.width + x) * 4;
    const luma = image.data[o] * 0.299 + image.data[o + 1] * 0.587 + image.data[o + 2] * 0.114;
    if (luma < 90) far = f;
  }
  return Math.round(far * 100) / 100;
}

function savePng(path, rgba, w, h) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', '-',
    path,
  ], { input: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength) });
  if (result.status !== 0) throw new Error(result.stderr?.toString() || 'png encode failed');
}

const rows = [];
for (const shot of SHOTS) {
  const image = grab(`/workspace/flair-train/real/${shot.clip}.mp4`, shot.t);
  const found = discoverGaugeInFrame(image);
  if (!found?.ok) {
    rows.push({ ...shot, error: 'no gauge' });
    continue;
  }
  const face = rectifyGaugeFace(cv, image, found);
  if (!face?.ok) {
    rows.push({ ...shot, error: 'rectify failed', centre: found });
    continue;
  }
  const needle = detectNeedleAngle(
    face.image, face.cx, face.cy,
    face.radius * TIP_INNER_RATIO, face.radius * OUTER_RADIUS_RATIO,
  );
  needle.angleDeg = refineNeedleAngle(
    face.image, face.cx, face.cy,
    face.radius * TIP_INNER_RATIO, face.radius * OUTER_RADIUS_RATIO,
    needle.angleDeg,
  );
  const edges = prepareEdges(face.image, {
    contrastRadius: Math.max(2, Math.round(face.radius * 0.05)),
  }).edges;
  const profile = measureRimProfile(
    edges, face.image.width, face.image.height, face.cx, face.cy, face.radius,
    { bins: 360, innerRatio: 0.76, outerRatio: 0.88 },
  );
  const reg = registerDialRotationFromProfile(profile, needle.angleDeg);
  const arc = matchGaugeRotation(
    buildFlairCanonicalDialProfile(profile.length),
    profile,
    { maxShiftDeg: 360, needleDeg: needle.angleDeg },
  );
  const rot = reg.ok ? reg.rotationDeg : (arc.estimateDeg ?? 0);
  const relative = wrap360(needle.angleDeg - rot);
  const flipped = wrap360(needle.angleDeg + 180 - rot);
  const swapped = wrap360(rot - needle.angleDeg);
  const spacing = FLAIR_58_SCALE.sweepDeg / 20;
  const zeroRay = wrap360(rot + CANONICAL_ZERO_BAR_ANGLE_DEG);

  const panelW = face.image.width;
  const panelH = face.image.height;
  const canvasW = panelW * 2 + 8;
  const canvas = new Uint8ClampedArray(canvasW * panelH * 4);
  canvas.fill(12);
  const cropR = Math.round(found.radius * 1.3);
  const crop = {
    data: new Uint8ClampedArray(panelW * panelH * 4),
    width: panelW,
    height: panelH,
  };
  for (let y = 0; y < panelH; y += 1) {
    for (let x = 0; x < panelW; x += 1) {
      const sx = Math.round(found.cx + ((x / panelW) - 0.5) * cropR * 2);
      const sy = Math.round(found.cy + ((y / panelH) - 0.5) * cropR * 2);
      const o = (y * panelW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
      const s = (sy * image.width + sx) * 4;
      crop.data[o] = image.data[s];
      crop.data[o + 1] = image.data[s + 1];
      crop.data[o + 2] = image.data[s + 2];
      crop.data[o + 3] = 255;
    }
  }
  blit(canvas, canvasW, panelH, 0, 0, crop);
  blit(canvas, canvasW, panelH, panelW + 8, 0, face.image);
  const right = panelW + 8;
  ray(canvas, canvasW, panelH, right + face.cx, face.cy, face.radius, zeroRay, 0.15, 0.95, [0, 220, 255]);
  for (let k = 0; k <= 20; k += 1) {
    ray(canvas, canvasW, panelH, right + face.cx, face.cy, face.radius, zeroRay + k * spacing, 0.72, 0.9, [255, 255, 255]);
  }
  ray(canvas, canvasW, panelH, right + face.cx, face.cy, face.radius, needle.angleDeg, 0.2, 0.82, [255, 220, 0]);
  ray(canvas, canvasW, panelH, right + face.cx, face.cy, face.radius, needle.angleDeg + 180, 0.12, 0.4, [255, 40, 140]);
  setPx(canvas, canvasW, panelH, right + face.cx, face.cy, [0, 255, 80]);
  const ell = face.ellipse;
  if (ell) {
    for (let i = 0; i < 180; i += 1) {
      const a = (i / 180) * Math.PI * 2;
      const px = (ell.width / 2) * Math.cos(a);
      const py = (ell.height / 2) * Math.sin(a);
      const phi = (ell.angleDeg * Math.PI) / 180;
      const x = ell.cx + px * Math.cos(phi) - py * Math.sin(phi);
      const y = ell.cy + px * Math.sin(phi) + py * Math.cos(phi);
      const scale = panelW / (cropR * 2);
      const sx = (x - found.cx) * scale + panelW / 2;
      const sy = (y - found.cy) * scale + panelH / 2;
      setPx(canvas, canvasW, panelH, sx, sy, [0, 255, 80]);
    }
  }
  const png = `${OUT}/${shot.clip}-${shot.phase}.png`;
  savePng(png, canvas, canvasW, panelH);

  const row = {
    clip: shot.clip,
    phase: shot.phase,
    t: shot.t,
    expect: shot.expect,
    centre: {
      x: Math.round(face.ellipse?.cx ?? found.cx),
      y: Math.round(face.ellipse?.cy ?? found.cy),
      w: Math.round(face.ellipse?.width ?? 0),
      h: Math.round(face.ellipse?.height ?? 0),
    },
    zeroDeg: CANONICAL_ZERO_BAR_ANGLE_DEG,
    sweep: FLAIR_58_SCALE.clockwise ? 'clockwise' : 'counterclockwise',
    needleDeg: Math.round(needle.angleDeg * 10) / 10,
    tailDeg: Math.round(wrap360(needle.angleDeg + 180) * 10) / 10,
    needleEnd: needle.needleEnd,
    hub: needle.hub,
    tipReach: darkReach(face.image, face.cx, face.cy, face.radius, needle.angleDeg),
    tailReach: darkReach(face.image, face.cx, face.cy, face.radius, needle.angleDeg + 180),
    colorRot: (() => {
      const bands = measureDialColorBands(face.image, face.cx, face.cy, face.radius, needle.angleDeg);
      const color = registerDialFromColorBands(bands);
      const rel = wrap360(needle.angleDeg - (color.rotationDeg || 0));
      return {
        ok: color.ok,
        rot: Math.round((color.rotationDeg || 0) * 10) / 10,
        bar: barOf(rel, true),
        barFlip: barOf(wrap360(needle.angleDeg + 180 - (color.rotationDeg || 0)), true),
      };
    })(),
    rotDeg: Math.round(rot * 10) / 10,
    regOk: reg.ok,
    zeroRayDeg: Math.round(zeroRay * 10) / 10,
    bar: barOf(relative, true),
    barFlip: barOf(flipped, true),
    barSwap: barOf(swapped, true),
    barCcw: barOf(relative, false),
    png,
  };
  rows.push(row);
  process.stderr.write(`${shot.clip} ${shot.phase} bar=${row.bar} flip=${row.barFlip} swap=${row.barSwap} ccw=${row.barCcw} end=${row.needleEnd}\n`);
}

writeFileSync(`${OUT}/readings.json`, `${JSON.stringify(rows, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
