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

/**
 * Place a measured dial into a 1280×720 frame at a seeded off-centre spot,
 * with a mild from-below warp, a bright ellipse, and a dark occluder.
 * `dialCx/Cy/Radius` are source-frame pixels used only to build the picture.
 */
export function planSmallGaugeVariant({
  clipId,
  frameWidth,
  frameHeight,
  dialCx,
  dialCy,
  dialRadius,
}) {
  if (!(dialRadius > 4) || !(frameWidth > 0) || !(frameHeight > 0)) {
    throw new Error(`cannot place a dial for ${clipId}`);
  }
  const rand = mulberry32(hashSeed(`small-gauge:${clipId}`));
  const diameter = DIAMETER_MIN_PX + rand() * (DIAMETER_MAX_PX - DIAMETER_MIN_PX);
  const sourceDiameter = dialRadius * 2;
  const cropSide = Math.round(clamp(sourceDiameter * 3.4, sourceDiameter + 48, Math.min(frameWidth, frameHeight)));
  const cropX = Math.round(clamp(dialCx - cropSide / 2, 0, frameWidth - cropSide));
  const cropY = Math.round(clamp(dialCy - cropSide / 2, 0, frameHeight - cropSide));
  const scale = diameter / sourceDiameter;
  const outSide = Math.max(16, Math.round(cropSide * scale));
  const localCx = (dialCx - cropX) * scale;
  const localCy = (dialCy - cropY) * scale;
  // From below: the top edge of the crop pinches in by a few percent.
  const pinch = 0.035 + rand() * 0.025;
  const maxX = Math.max(0, SYNTHETIC_WIDTH - outSide);
  const maxY = Math.max(0, SYNTHETIC_HEIGHT - outSide);
  let originX = Math.round(rand() * maxX);
  let originY = Math.round(rand() * maxY);
  const centreX = originX + localCx;
  const centreY = originY + localCy;
  const frameCx = SYNTHETIC_WIDTH / 2;
  const frameCy = SYNTHETIC_HEIGHT / 2;
  if (Math.hypot(centreX - frameCx, centreY - frameCy) < Math.min(SYNTHETIC_WIDTH, SYNTHETIC_HEIGHT) * 0.12) {
    originX = originX < frameCx ? Math.min(maxX, originX + Math.round(outSide * 0.45)) : Math.max(0, originX - Math.round(outSide * 0.45));
    originY = originY < frameCy ? Math.min(maxY, originY + Math.round(outSide * 0.35)) : Math.max(0, originY - Math.round(outSide * 0.35));
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
      cropSide,
      outSide,
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
