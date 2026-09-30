import { TIP_INNER_RATIO, OUTER_RADIUS_RATIO, wrap360, wrapDelta } from './gaugeConfig.js';
import { prepareEdges } from './framePrep.js';
import { detectNeedleAngle } from './needleFromFrame.js';

/**
 * Gauge pose for the pressure lab.
 *
 * Position comes from the circular rim: edge gradients on a real dial point
 * outward all the way around, so a translated gauge moves the circle and a
 * rotating needle does not. Orientation comes from the fixed tick/numeral
 * pattern, with the needle sector ignored, so a lever twist is not read as
 * pressure. Pressure uses needle angle minus that gauge rotation.
 *
 * Modest motion only. The search stays near the last pose. A weak rim score
 * holds the last pose instead of inventing a new one.
 * Centre, radius, and rotation are one pose. A large change has to be the same
 * pose again on the next frame. The needle is masked out of the dial match, so
 * it cannot turn or translate the gauge.
 */

const RIM_BINS = 48;
const PROFILE_BINS = 72;
const CONFIDENCE_MIN = 0.3;
const ORIENT_MIN = 0.34;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sampleRadial(edges, width, height, x, y, cos, sin) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 1 || yi < 1 || xi >= width - 1 || yi >= height - 1) return 0;
  const index = yi * width + xi;
  return Math.abs(edges.gx[index] * cos + edges.gy[index] * sin);
}

/** How strongly edges at `radius` point at `(cx, cy)`. 0 if the circle does not fit. */
export function scoreRim(edges, width, height, cx, cy, radius) {
  if (radius < 8) return 0;
  let sum = 0;
  let lit = 0;
  for (let i = 0; i < RIM_BINS; i += 1) {
    const angle = (i / RIM_BINS) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let local = 0;
    for (let dr = -3; dr <= 3; dr += 1.5) {
      local = Math.max(local, sampleRadial(edges, width, height, cx + (radius + dr) * cos, cy + (radius + dr) * sin, cos, sin));
    }
    sum += local;
    if (local > 0.4) lit += 1;
  }
  if (lit < RIM_BINS * 0.35) return 0;
  return (sum / RIM_BINS) * (lit / RIM_BINS);
}

function offsetScore(edges, width, height, cx, cy, radius) {
  const shift = radius * 0.34;
  let hardest = 0;
  let compared = 0;
  for (const [dx, dy] of [[shift, 0], [-shift, 0], [0, shift], [0, -shift]]) {
    const score = scoreRim(edges, width, height, cx + dx, cy + dy, radius);
    if (score <= 0) continue;
    compared += 1;
    if (score > hardest) hardest = score;
  }
  if (!compared) return null;
  return hardest;
}

/**
 * Search a window around the previous circle. `prior` is in image pixels.
 * Returns the unsmoothed centre. `edges` is reused for the dial profile.
 */
export function locateGauge(image, prior, { searchFraction = 0.46 } = {}) {
  const { width, height } = image;
  const contrastRadius = Math.max(3, Math.round(prior.radius / 6));
  const { edges } = prepareEdges(image, { contrastRadius });
  const extent = Math.max(6, prior.radius * searchFraction);
  const step = Math.max(2, Math.round(extent / 6));
  let best = { score: -1, cx: prior.cx, cy: prior.cy, radius: prior.radius };

  const consider = (cx, cy, radius) => {
    if (radius < 8) return;
    if (cx - radius < 1 || cy - radius < 1 || cx + radius >= width - 1 || cy + radius >= height - 1) return;
    const score = scoreRim(edges, width, height, cx, cy, radius);
    if (score > best.score) best = { score, cx, cy, radius };
  };

  for (let dy = -extent; dy <= extent; dy += step) {
    for (let dx = -extent; dx <= extent; dx += step) {
      const cx = prior.cx + dx;
      const cy = prior.cy + dy;
      consider(cx, cy, prior.radius * 0.96);
      consider(cx, cy, prior.radius);
      consider(cx, cy, prior.radius * 1.04);
    }
  }

  const refine = Math.max(2, step);
  const coarse = best;
  for (let dy = -refine; dy <= refine; dy += 1) {
    for (let dx = -refine; dx <= refine; dx += 1) {
      consider(coarse.cx + dx, coarse.cy + dy, coarse.radius);
    }
  }
  for (const scale of [0.94, 0.97, 1, 1.03, 1.06]) {
    consider(best.cx, best.cy, prior.radius * scale);
  }

  const off = offsetScore(edges, width, height, best.cx, best.cy, best.radius);
  const confidence = best.score > 1e-3 && off != null
    ? clamp((best.score - off) / best.score, 0, 1)
    : 0;
  const ok = confidence >= CONFIDENCE_MIN && best.score > 1e-3;
  return {
    ok,
    confidence: ok ? confidence : confidence * 0.5,
    cx: ok ? best.cx : prior.cx,
    cy: ok ? best.cy : prior.cy,
    radius: ok ? best.radius : prior.radius,
    score: best.score,
    edges: ok ? edges : null,
    width,
    height,
  };
}

function nearNeedle(deg, needleDeg, halfWidth) {
  if (needleDeg == null) return false;
  return Math.abs(wrapDelta(needleDeg, deg)) <= halfWidth
    || Math.abs(wrapDelta(wrap360(needleDeg + 180), deg)) <= halfWidth;
}

/** Fixed dial markings around the rim. The needle is masked later. */
export function measureRimProfile(edges, width, height, cx, cy, radius) {
  const profile = new Float32Array(PROFILE_BINS);
  const counts = new Float32Array(PROFILE_BINS);
  const inner = radius * 0.72;
  const outer = radius * 0.94;
  for (let r = inner; r <= outer; r += 1.5) {
    for (let i = 0; i < PROFILE_BINS; i += 1) {
      const angle = (i / PROFILE_BINS) * Math.PI * 2;
      const x = Math.round(cx + r * Math.cos(angle));
      const y = Math.round(cy + r * Math.sin(angle));
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      profile[i] += edges.mag[y * width + x];
      counts[i] += 1;
    }
  }
  for (let i = 0; i < PROFILE_BINS; i += 1) {
    if (counts[i]) profile[i] /= counts[i];
  }
  return profile;
}

function cosineCentered(left, right) {
  let meanL = 0;
  let meanR = 0;
  for (let i = 0; i < left.length; i += 1) {
    meanL += left[i];
    meanR += right[i];
  }
  meanL /= left.length;
  meanR /= right.length;
  let dot = 0;
  let a2 = 0;
  let b2 = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i] - meanL;
    const b = right[i] - meanR;
    dot += a * b;
    a2 += a * a;
    b2 += b * b;
  }
  if (a2 < 1e-6 || b2 < 1e-6) return 0;
  return dot / Math.sqrt(a2 * b2);
}

/**
 * Rotation of `current` relative to `reference`, in degrees clockwise.
 * Bins on the needle and its tail are left out so the pointer cannot rotate the gauge.
 */
export function matchGaugeRotation(reference, current, {
  previousDeg = 0,
  needleDeg = null,
  alsoNeedleDeg = null,
  referenceNeedleDeg = null,
  maxShiftDeg = 18,
} = {}) {
  if (!reference || !current || reference.length !== current.length) {
    return { ok: false, rotationDeg: previousDeg, confidence: 0 };
  }
  const bins = reference.length;
  const step = 360 / bins;
  const half = Math.max(1, Math.round(maxShiftDeg / step));
  const centerBin = Math.round(previousDeg / step);
  const ranked = [];

  for (let shift = centerBin - half; shift <= centerBin + half; shift += 1) {
    const refVals = [];
    const curVals = [];
    for (let i = 0; i < bins; i += 1) {
      const curDeg = i * step;
      const refIndex = ((i - shift) % bins + bins) % bins;
      const refDeg = refIndex * step;
      if (nearNeedle(curDeg, needleDeg, 16) || nearNeedle(curDeg, alsoNeedleDeg, 16)) continue;
      if (nearNeedle(refDeg, referenceNeedleDeg, 16)) continue;
      refVals.push(reference[refIndex]);
      curVals.push(current[i]);
    }
    if (refVals.length < bins * 0.45) continue;
    ranked.push({ shift, corr: cosineCentered(refVals, curVals) });
  }

  if (!ranked.length) return { ok: false, rotationDeg: previousDeg, confidence: 0, margin: 0 };
  ranked.sort((a, b) => b.corr - a.corr);
  const best = ranked[0];
  const second = ranked.find((item) => Math.abs(wrapDelta(best.shift * step, item.shift * step)) >= 12);
  const rotationDeg = wrap360(best.shift * step);
  const margin = second ? best.corr - second.corr : best.corr;
  const median = ranked[Math.floor(ranked.length / 2)].corr;
  const peaked = best.corr - median >= 0.05;
  const ok = best.corr >= ORIENT_MIN && margin >= 0.02 && peaked;
  return {
    ok,
    rotationDeg: ok ? rotationDeg : previousDeg,
    confidence: clamp(best.corr, 0, 1),
    margin,
    estimateDeg: rotationDeg,
  };
}

/**
 * Stillness gates, measured on a frozen crop of a stationary synthetic dial.
 * A fixed hub keeps the needle angle constant even when the rim score wanders.
 * The old blend (half of every centre error, 0.35 of every radius error) moved
 * the crop on identical frames, and the needle then jumped several degrees.
 * Fractions are of the gauge radius, which is how the error scales in the
 * 188px search image. Centre and rotation are gated separately.
 * A centre shift inside the quiet band is ignored. A larger shift under
 * one tenth of the radius has to agree for three frames, and only when the
 * dial at that circle still matches the current rotation. A bigger jump, or a
 * jump that only matches after a large spin, has to be the same pose twice.
 * Rotation under one degree is ignored. One dial bin can repeat and then
 * keep turning. Anything larger is held until the same angle comes back,
 * so one bad frame cannot walk the pressure reading.
 */
const CENTRE_QUIET_FRACTION = 0.03;
const CENTRE_IMMEDIATE_FRACTION = 0.1;
const CENTRE_AGREE_FRACTION = 0.035;
const RADIUS_QUIET_FRACTION = 0.05;
const RADIUS_IMMEDIATE_FRACTION = 0.12;
const ROTATION_QUIET_DEG = 1;
const ROTATION_BIN_DEG = 5.5;
const ROTATION_AGREE_DEG = 4;
const ROTATION_RIGID_DEG = 6;

export function createGaugeTracker() {
  let pose = null;
  let baseRadius = 0;
  let reference = null;
  let referenceNeedleDeg = null;
  let recovering = false;
  let centreCandidate = null;
  let radiusCandidate = null;
  let rotationCandidate = null;
  let rotationVelocity = 0;
  let trustedRotationDeg = null;
  let poseCandidate = null;
  let maskNeedleDeg = null;

  const clearPoseMemory = () => {
    centreCandidate = null;
    radiusCandidate = null;
    rotationCandidate = null;
    rotationVelocity = 0;
    trustedRotationDeg = null;
    poseCandidate = null;
    maskNeedleDeg = null;
  };

  return {
    reset() {
      pose = null;
      baseRadius = 0;
      reference = null;
      referenceNeedleDeg = null;
      recovering = false;
      clearPoseMemory();
    },
    seed({ cx, cy, radius }) {
      pose = { cx, cy, radius, rotationDeg: 0 };
      baseRadius = radius;
      reference = null;
      referenceNeedleDeg = null;
      recovering = false;
      clearPoseMemory();
    },
    getPose() {
      return pose ? { ...pose } : null;
    },
    /**
     * @param mapping image pixel = (video pixel - origin) * scale
     */
    trackPosition(image, mapping) {
      if (!pose) return null;
      const localPrior = {
        cx: (pose.cx - mapping.originX) * mapping.scale,
        cy: (pose.cy - mapping.originY) * mapping.scale,
        radius: pose.radius * mapping.scale,
      };
      const found = locateGauge(image, localPrior, {
        searchFraction: recovering ? 0.62 : 0.46,
      });
      if (!found.ok) {
        recovering = true;
        poseCandidate = null;
        return {
          held: true,
          confidence: found.confidence,
          pose: { ...pose },
          profile: null,
          poseQuality: null,
          poseRejectReason: 'rim-weak',
          posePending: false,
          poseDeltaPx: 0,
        };
      }
      const video = {
        cx: mapping.originX + found.cx / mapping.scale,
        cy: mapping.originY + found.cy / mapping.scale,
        radius: found.radius / mapping.scale,
      };
      const dx = video.cx - pose.cx;
      const dy = video.cy - pose.cy;
      const shift = Math.hypot(dx, dy);
      if (shift > pose.radius * 0.5 && found.confidence < 0.55) {
        recovering = true;
        centreCandidate = null;
        radiusCandidate = null;
        poseCandidate = null;
        return {
          held: true,
          confidence: found.confidence,
          pose: { ...pose },
          profile: null,
          reacquired: false,
          rawCx: video.cx,
          rawCy: video.cy,
          rawRadius: video.radius,
          poseQuality: null,
          poseRejectReason: 'centre-rejected',
          posePending: false,
          poseDeltaPx: 0,
        };
      }

      let dial = null;
      if (reference && found.edges) {
        const candidateProfile = measureRimProfile(
          found.edges,
          found.width,
          found.height,
          found.cx,
          found.cy,
          found.radius,
        );
        dial = matchGaugeRotation(reference, candidateProfile, {
          previousDeg: pose.rotationDeg,
          needleDeg: maskNeedleDeg,
          referenceNeedleDeg,
          maxShiftDeg: 18,
        });
      }
      const proposedRotation = dial?.estimateDeg ?? pose.rotationDeg;
      const rotDelta = Math.abs(wrapDelta(pose.rotationDeg, proposedRotation));
      const dialOk = Boolean(dial?.ok);
      const surprisingSpin = Boolean(reference) && dialOk && rotDelta > ROTATION_BIN_DEG;
      const unrecognized = Boolean(reference) && !dialOk;
      const quiet = Math.max(1.25, pose.radius * CENTRE_QUIET_FRACTION);
      const immediate = pose.radius * CENTRE_IMMEDIATE_FRACTION;
      const beforeCx = pose.cx;
      const beforeCy = pose.cy;
      let poseRejectReason = null;
      let posePending = false;
      let geometryHeld = false;
      let skipNormal = false;
      const needsJoint = Boolean(reference) && shift >= quiet && (surprisingSpin || (unrecognized && shift >= immediate));
      if (needsJoint) {
        const proposal = {
          cx: video.cx,
          cy: video.cy,
          radius: video.radius,
          rotationDeg: proposedRotation,
        };
        const agree = pose.radius * CENTRE_AGREE_FRACTION;
        const same = poseCandidate
          && Math.hypot(video.cx - poseCandidate.cx, video.cy - poseCandidate.cy) <= agree
          && Math.abs(video.radius - poseCandidate.radius) <= pose.radius * RADIUS_QUIET_FRACTION
          && Math.abs(wrapDelta(poseCandidate.rotationDeg, proposedRotation)) <= ROTATION_AGREE_DEG;
        poseCandidate = same
          ? { ...proposal, hits: poseCandidate.hits + 1 }
          : { ...proposal, hits: 1 };
        let spinOk = !surprisingSpin;
        // The dial proposed a spin. The needle can veto it, not create it.
        if (surprisingSpin && poseCandidate.hits >= 2) {
          const coarse = detectNeedleAngle(
            image,
            found.cx,
            found.cy,
            found.radius * TIP_INNER_RATIO,
            found.radius * OUTER_RADIUS_RATIO,
          );
          const needleStep = wrapDelta(maskNeedleDeg ?? coarse.angleDeg, coarse.angleDeg);
          const rotationStep = wrapDelta(pose.rotationDeg, proposedRotation);
          spinOk = coarse.quality >= 0.18
            && Math.abs(wrapDelta(needleStep, rotationStep)) <= ROTATION_RIGID_DEG;
        }
        if (poseCandidate.hits >= 2 && spinOk) {
          pose = {
            cx: video.cx,
            cy: video.cy,
            radius: clamp(video.radius, baseRadius * 0.82, baseRadius * 1.2),
            rotationDeg: pose.rotationDeg,
          };
          if (dialOk) trustedRotationDeg = dial.estimateDeg;
          poseCandidate = null;
          centreCandidate = null;
          radiusCandidate = null;
        } else {
          posePending = true;
          poseRejectReason = surprisingSpin ? 'pose-inconsistent' : 'dial-unrecognized';
          geometryHeld = shift >= immediate;
          centreCandidate = null;
          radiusCandidate = null;
        }
        skipNormal = true;
      }

      if (!skipNormal) {
        poseCandidate = null;
        let nextCx = pose.cx;
        let nextCy = pose.cy;
        if (shift >= immediate) {
          nextCx = pose.cx + 0.85 * dx;
          nextCy = pose.cy + 0.85 * dy;
          centreCandidate = null;
        } else if (shift >= quiet) {
          const agree = pose.radius * CENTRE_AGREE_FRACTION;
          if (centreCandidate && Math.hypot(video.cx - centreCandidate.cx, video.cy - centreCandidate.cy) <= agree) {
            centreCandidate = { cx: video.cx, cy: video.cy, hits: centreCandidate.hits + 1 };
          } else {
            centreCandidate = { cx: video.cx, cy: video.cy, hits: 1 };
          }
          if (centreCandidate.hits >= 3) {
            nextCx = pose.cx + 0.6 * (centreCandidate.cx - pose.cx);
            nextCy = pose.cy + 0.6 * (centreCandidate.cy - pose.cy);
            centreCandidate = null;
          }
        } else {
          centreCandidate = null;
        }

        const radiusDelta = video.radius - pose.radius;
        const radiusQuiet = pose.radius * RADIUS_QUIET_FRACTION;
        const radiusImmediate = pose.radius * RADIUS_IMMEDIATE_FRACTION;
        let nextRadius = pose.radius;
        if (Math.abs(radiusDelta) >= radiusImmediate) {
          nextRadius = clamp(pose.radius + 0.45 * radiusDelta, baseRadius * 0.82, baseRadius * 1.2);
          radiusCandidate = null;
        } else if (Math.abs(radiusDelta) >= radiusQuiet) {
          if (radiusCandidate != null && Math.abs(video.radius - radiusCandidate) <= radiusQuiet) {
            nextRadius = clamp(pose.radius + 0.4 * radiusDelta, baseRadius * 0.82, baseRadius * 1.2);
            radiusCandidate = null;
          } else {
            radiusCandidate = video.radius;
          }
        } else {
          radiusCandidate = null;
        }
        pose = {
          cx: nextCx,
          cy: nextCy,
          radius: nextRadius,
          rotationDeg: pose.rotationDeg,
        };
      }

      const reacquired = recovering;
      recovering = false;
      const profile = measureRimProfile(
        found.edges,
        found.width,
        found.height,
        (pose.cx - mapping.originX) * mapping.scale,
        (pose.cy - mapping.originY) * mapping.scale,
        pose.radius * mapping.scale,
      );
      return {
        held: geometryHeld,
        confidence: found.confidence,
        pose: { ...pose },
        profile,
        reacquired,
        rawCx: video.cx,
        rawCy: video.cy,
        rawRadius: video.radius,
        poseQuality: dial?.confidence ?? null,
        poseRejectReason,
        posePending,
        poseDeltaPx: Math.hypot(pose.cx - beforeCx, pose.cy - beforeCy),
      };
    },
    trackOrientation(profile, needleDeg, { positionHeld = false, reacquired = false } = {}) {
      const trusted = trustedRotationDeg;
      trustedRotationDeg = null;
      const rememberNeedle = () => {
        if (needleDeg == null) return;
        if (maskNeedleDeg == null || Math.abs(wrapDelta(maskNeedleDeg, needleDeg)) <= 30) {
          maskNeedleDeg = needleDeg;
        }
      };
      if (!pose || positionHeld || !profile || needleDeg == null) {
        rotationCandidate = null;
        return {
          rotationDeg: pose ? pose.rotationDeg : 0,
          rawRotationDeg: pose ? pose.rotationDeg : 0,
          confidence: 0,
          held: true,
          poseBlocked: false,
          posePending: false,
          poseRejectReason: null,
          poseQuality: null,
          poseDeltaRot: 0,
        };
      }
      if (!reference) {
        reference = profile.slice();
        referenceNeedleDeg = needleDeg;
        rememberNeedle();
        rotationCandidate = null;
        rotationVelocity = 0;
        pose = { ...pose, rotationDeg: 0 };
        return {
          rotationDeg: 0,
          rawRotationDeg: 0,
          confidence: 1,
          held: false,
          captured: true,
          poseBlocked: false,
          posePending: false,
          poseRejectReason: null,
          poseQuality: 1,
          poseDeltaRot: 0,
        };
      }
      const match = matchGaugeRotation(reference, profile, {
        previousDeg: pose.rotationDeg,
        needleDeg: maskNeedleDeg,
        alsoNeedleDeg: needleDeg,
        referenceNeedleDeg,
        maxShiftDeg: reacquired ? 32 : 18,
      });
      if (!match.ok) {
        rotationCandidate = null;
        rotationVelocity *= 0.5;
        rememberNeedle();
        return {
          rotationDeg: pose.rotationDeg,
          rawRotationDeg: match.estimateDeg ?? pose.rotationDeg,
          confidence: match.confidence,
          held: true,
          poseBlocked: false,
          posePending: false,
          poseRejectReason: null,
          poseQuality: match.confidence,
          poseDeltaRot: 0,
        };
      }
      const estimate = match.estimateDeg;
      const step = wrapDelta(pose.rotationDeg, estimate);
      const magnitude = Math.abs(step);
      const needleStep = wrapDelta(maskNeedleDeg ?? needleDeg, needleDeg);
      const rigid = Math.abs(wrapDelta(needleStep, step)) <= ROTATION_RIGID_DEG;
      let next = pose.rotationDeg;
      let poseBlocked = false;
      let posePending = false;
      let poseRejectReason = null;
      const continuing = Math.abs(rotationVelocity) >= 1
        && magnitude <= ROTATION_BIN_DEG
        && Math.abs(wrapDelta(rotationVelocity, step)) <= ROTATION_AGREE_DEG;
      const trustedOk = trusted != null && Math.abs(wrapDelta(trusted, estimate)) <= ROTATION_AGREE_DEG;
      const repeated = rotationCandidate != null && Math.abs(wrapDelta(rotationCandidate, estimate)) <= ROTATION_AGREE_DEG;
      const large = magnitude > ROTATION_BIN_DEG;
      if (magnitude < ROTATION_QUIET_DEG) {
        rotationCandidate = null;
        rotationVelocity *= 0.5;
      } else if ((!large && (continuing || repeated)) || (large && rigid && (trustedOk || repeated))) {
        next = estimate;
        rotationVelocity = wrapDelta(pose.rotationDeg, next);
        rotationCandidate = null;
      } else {
        rotationCandidate = estimate;
        rotationVelocity *= 0.5;
        posePending = true;
        poseRejectReason = 'rotation-unconfirmed';
        poseBlocked = large;
      }
      const poseDeltaRot = wrapDelta(pose.rotationDeg, next);
      pose = { ...pose, rotationDeg: next };
      if (!poseBlocked) rememberNeedle();
      return {
        rotationDeg: next,
        rawRotationDeg: estimate,
        confidence: match.confidence,
        held: false,
        poseBlocked,
        posePending,
        poseRejectReason,
        poseQuality: match.confidence,
        poseDeltaRot,
      };
    },
  };
}

function squareCrop(videoW, videoH, cx, cy, pad) {
  let size = Math.round(pad * 2);
  size = Math.min(size, videoW, videoH);
  if (size < 16) return null;
  const originX = clamp(Math.round(cx - size / 2), 0, videoW - size);
  const originY = clamp(Math.round(cy - size / 2), 0, videoH - size);
  return { originX, originY, size };
}

function resampleCrop(image, crop, maxOutput) {
  const output = Math.min(crop.size, maxOutput);
  const scale = output / crop.size;
  const data = new Uint8ClampedArray(output * output * 4);
  for (let y = 0; y < output; y += 1) {
    for (let x = 0; x < output; x += 1) {
      const sx = Math.min(image.width - 1, crop.originX + Math.floor(x / scale));
      const sy = Math.min(image.height - 1, crop.originY + Math.floor(y / scale));
      const src = (sy * image.width + sx) * 4;
      const dst = (y * output + x) * 4;
      data[dst] = image.data[src];
      data[dst + 1] = image.data[src + 1];
      data[dst + 2] = image.data[src + 2];
      data[dst + 3] = 255;
    }
  }
  return { image: { data, width: output, height: output }, scale };
}

function drawCrop(video, canvas, crop, maxOutput) {
  const output = Math.min(crop.size, maxOutput);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = output;
  canvas.height = output;
  context.drawImage(video, crop.originX, crop.originY, crop.size, crop.size, 0, 0, output, output);
  return {
    image: context.getImageData(0, 0, output, output),
    scale: output / crop.size,
  };
}

function completeReading({
  videoWidth,
  videoHeight,
  position,
  tracker,
  needleImage,
  needleCrop,
  needleScale,
}) {
  const center = position.pose;
  const localRadius = center.radius * needleScale;
  const detection = detectNeedleAngle(
    needleImage,
    (center.cx - needleCrop.originX) * needleScale,
    (center.cy - needleCrop.originY) * needleScale,
    localRadius * TIP_INNER_RATIO,
    localRadius * OUTER_RADIUS_RATIO,
  );
  const orientation = tracker.trackOrientation(position.profile, detection.angleDeg, {
    positionHeld: position.held,
    reacquired: Boolean(position.reacquired),
  });
  const settled = tracker.getPose() || center;
  const minDim = Math.min(videoWidth, videoHeight);
  return {
    ...detection,
    relativeAngleDeg: wrap360(detection.angleDeg - orientation.rotationDeg),
    videoWidth,
    videoHeight,
    gauge: {
      nx: settled.cx / videoWidth,
      ny: settled.cy / videoHeight,
      nr: settled.radius / minDim,
      cx: settled.cx,
      cy: settled.cy,
      radius: settled.radius,
      rotationDeg: orientation.rotationDeg,
      rawCx: position.rawCx ?? null,
      rawCy: position.rawCy ?? null,
      rawRadius: position.rawRadius ?? null,
      rawRotationDeg: orientation.rawRotationDeg ?? orientation.rotationDeg,
      confidence: position.confidence,
      orientationConfidence: orientation.confidence,
      held: Boolean(position.held || orientation.poseBlocked),
      poseQuality: orientation.poseQuality ?? position.poseQuality ?? null,
      poseRejectReason: position.poseRejectReason || orientation.poseRejectReason || null,
      posePending: Boolean(position.posePending || orientation.posePending),
      poseDeltaPx: position.poseDeltaPx ?? 0,
      poseDeltaRot: orientation.poseDeltaRot ?? 0,
    },
  };
}

/** Same crop-and-read path as the camera, for tests on a full frame. */
export function analyzeGaugeImage(image, tracker) {
  const videoWidth = image.width;
  const videoHeight = image.height;
  if (!videoWidth || !videoHeight || !tracker.getPose()) return null;
  const pose = tracker.getPose();
  const trackCrop = squareCrop(videoWidth, videoHeight, pose.cx, pose.cy, pose.radius * 1.9);
  if (!trackCrop) return null;
  const tracked = resampleCrop(image, trackCrop, 188);
  const position = tracker.trackPosition(tracked.image, {
    originX: trackCrop.originX,
    originY: trackCrop.originY,
    scale: tracked.scale,
  });
  if (!position) return null;
  const center = position.pose;
  const needleCrop = squareCrop(videoWidth, videoHeight, center.cx, center.cy, center.radius * 1.08);
  if (!needleCrop) return null;
  const needle = resampleCrop(image, needleCrop, 420);
  return completeReading({
    videoWidth,
    videoHeight,
    position,
    tracker,
    needleImage: needle.image,
    needleCrop,
    needleScale: needle.scale,
  });
}

/** Crop around the tracked gauge, update its pose, then read the needle from that pose. */
export function readTrackedGauge(video, canvas, region, tracker) {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight || !region) return null;
  if (!tracker.getPose()) {
    tracker.seed({
      cx: region.nx * videoWidth,
      cy: region.ny * videoHeight,
      radius: region.nr * Math.min(videoWidth, videoHeight),
    });
  }

  const pose = tracker.getPose();
  const trackCrop = squareCrop(videoWidth, videoHeight, pose.cx, pose.cy, pose.radius * 1.9);
  if (!trackCrop) return null;
  const tracked = drawCrop(video, canvas, trackCrop, 188);
  const position = tracker.trackPosition(tracked.image, {
    originX: trackCrop.originX,
    originY: trackCrop.originY,
    scale: tracked.scale,
  });
  if (!position) return null;

  const center = position.pose;
  const needleCrop = squareCrop(videoWidth, videoHeight, center.cx, center.cy, center.radius * 1.08);
  if (!needleCrop) return null;
  const needle = drawCrop(video, canvas, needleCrop, 420);
  return completeReading({
    videoWidth,
    videoHeight,
    position,
    tracker,
    needleImage: needle.image,
    needleCrop,
    needleScale: needle.scale,
  });
}
