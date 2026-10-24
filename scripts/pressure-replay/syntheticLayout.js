/**
 * Seeded layout for the small-gauge synthetic set.
 * Positions are for the generator only. The object handed to replay scoring
 * has the source clip's expected bar and no centre, radius, or placement.
 */

export const SYNTHETIC_WIDTH = 1280;
export const SYNTHETIC_HEIGHT = 720;
export const DIAMETER_MIN_PX = 120;
export const DIAMETER_MAX_PX = 180;

export function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Place measured dial sightings into a 1280×720 frame at a seeded off-centre
 * spot, with a mild from-below warp, a bright ellipse, and a dark occluder.
 * Sightings are source-frame pixels used only to build the picture.
 */
export function planSmallGaugeVariant({
  clipId,
  frameWidth,
  frameHeight,
  dialCx,
  dialCy,
  dialRadius,
  observations = null,
}) {
  const sightings = observations?.length
    ? observations
    : [{ cx: dialCx, cy: dialCy, radius: dialRadius }];
  const radius = median(sightings.map((item) => item.radius));
  if (!(radius > 4) || !(frameWidth > 0) || !(frameHeight > 0)) {
    throw new Error(`cannot place a dial for ${clipId}`);
  }
  const rand = mulberry32(hashSeed(`small-gauge:${clipId}`));
  let diameter = DIAMETER_MIN_PX + rand() * (DIAMETER_MAX_PX - DIAMETER_MIN_PX);
  const pad = radius * 2.6;
  const cropX = Math.round(clamp(Math.min(...sightings.map((item) => item.cx)) - pad, 0, frameWidth - 16));
  const cropY = Math.round(clamp(Math.min(...sightings.map((item) => item.cy)) - pad, 0, frameHeight - 16));
  const cropRight = Math.round(clamp(Math.max(...sightings.map((item) => item.cx)) + pad, cropX + 16, frameWidth));
  const cropBottom = Math.round(clamp(Math.max(...sightings.map((item) => item.cy)) + pad, cropY + 16, frameHeight));
  const cropW = cropRight - cropX;
  const cropH = cropBottom - cropY;
  let scale = diameter / (radius * 2);
  const fit = Math.min((SYNTHETIC_WIDTH - 80) / cropW, (SYNTHETIC_HEIGHT - 80) / cropH, scale);
  scale = Math.max(0.2, fit);
  diameter = radius * 2 * scale;
  const outW = Math.max(16, Math.round(cropW * scale));
  const outH = Math.max(16, Math.round(cropH * scale));
  const anchor = sightings[0];
  const localCx = (anchor.cx - cropX) * scale;
  const localCy = (anchor.cy - cropY) * scale;
  const pinch = 0.035 + rand() * 0.025;
  const maxX = Math.max(0, SYNTHETIC_WIDTH - outW);
  const maxY = Math.max(0, SYNTHETIC_HEIGHT - outH);
  let originX = Math.round(rand() * maxX);
  let originY = Math.round(rand() * maxY);
  const frameCx = SYNTHETIC_WIDTH / 2;
  const frameCy = SYNTHETIC_HEIGHT / 2;
  const centreX = originX + localCx;
  const centreY = originY + localCy;
  if (Math.hypot(centreX - frameCx, centreY - frameCy) < Math.min(SYNTHETIC_WIDTH, SYNTHETIC_HEIGHT) * 0.12) {
    originX = centreX < frameCx ? Math.min(maxX, originX + Math.round(outW * 0.35)) : Math.max(0, originX - Math.round(outW * 0.35));
    originY = centreY < frameCy ? Math.min(maxY, originY + Math.round(outH * 0.35)) : Math.max(0, originY - Math.round(outH * 0.35));
  }
  const placedCx = originX + localCx;
  const placedCy = originY + localCy;
  const hotspotAngle = rand() * Math.PI * 2;
  const hotspotDist = diameter * (0.35 + rand() * 0.35);
  const occluderAngle = hotspotAngle + Math.PI * (0.55 + rand() * 0.4);
  const occluderDist = diameter * (0.4 + rand() * 0.35);
  return {
    compositing: {
      cropX,
      cropY,
      cropW,
      cropH,
      outW,
      outH,
      originX,
      originY,
      pinch,
      diameter,
      hotspot: {
        cx: placedCx + Math.cos(hotspotAngle) * hotspotDist,
        cy: placedCy + Math.sin(hotspotAngle) * hotspotDist,
        rx: diameter * (0.18 + rand() * 0.16),
        ry: diameter * (0.1 + rand() * 0.1),
      },
      occluder: {
        cx: placedCx + Math.cos(occluderAngle) * occluderDist,
        cy: placedCy + Math.sin(occluderAngle) * occluderDist,
        rx: diameter * (0.16 + rand() * 0.14),
        ry: diameter * (0.22 + rand() * 0.16),
      },
    },
    scoring: {
      id: `${clipId}-small`,
      sourceId: clipId,
    },
  };
}

/** Scoring row for the replay manifest. Placement stays out of this object. */
export function scoringClip(sourceClip, plan) {
  return {
    id: plan.scoring.id,
    file: `${plan.scoring.id}.mp4`,
    description: `Small off-centre variant of ${sourceClip.id}`,
    expectedBar: sourceClip.expectedBar,
    expectedPeakBar: sourceClip.expectedPeakBar ?? null,
    tolerance: sourceClip.tolerance ?? 0.5,
    notes: 'Synthetic. Placement is not a CV input.',
  };
}
