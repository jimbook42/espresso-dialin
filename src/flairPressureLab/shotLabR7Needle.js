import { rectifyGaugeFace } from './faceRectify.js';
import { getOpenCvSync } from './opencvRuntime.js';
import { predictRegisteredNeedle, loadNeedleModel, isNeedleModelReady } from './needleModel.js';

/**
 * R5 ONNX sample from a tap-tracked frame (null when model unavailable).
 */
export async function r5SampleFromTapFrame(image, read) {
  if (!image || !read?.hub || read.lost) return { r5Bar: null, r5Conf: null, r5Angle: null };
  if (!isNeedleModelReady()) {
    await loadNeedleModel();
  }
  if (!isNeedleModelReady()) {
    return { r5Bar: null, r5Conf: null, r5Angle: null };
  }
  const cv = getOpenCvSync();
  if (!cv) return { r5Bar: null, r5Conf: null, r5Angle: null };
  const candidate = {
    cx: read.hub.x,
    cy: read.hub.y,
    radius: read.radius ?? read.hub.radius ?? 60,
    rotationDeg: read.shiftDeg ?? 0,
  };
  const face = rectifyGaugeFace(cv, image, candidate, { track: false });
  if (!face?.ok) return { r5Bar: null, r5Conf: null, r5Angle: null };
  const pred = await predictRegisteredNeedle({
    image: face.image,
    cx: face.cx,
    cy: face.cy,
    radius: face.radius,
    rotationDeg: candidate.rotationDeg,
  });
  if (!pred?.ok || pred.bar == null) {
    return { r5Bar: null, r5Conf: pred?.confidence ?? null, r5Angle: pred?.angleDeg ?? null };
  }
  return {
    r5Bar: pred.bar,
    r5Conf: pred.confidence ?? null,
    r5Angle: pred.angleDeg ?? null,
  };
}
