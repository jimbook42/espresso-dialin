import { loadNeedleModel, isNeedleModelReady, predictNeedleInput, NEEDLE_CONFIDENCE_MIN } from './needleModel.js';
import { prepareTapNeedleInput, tapNeedleModelPose, tapNeedlePrediction } from './tapNeedleModel.js';
import { matchTipAngle } from './tapCalibrate.js';
import { wrapDelta } from './gaugeConfig.js';

/**
 * The model and its confirming pixels belong to the same captured frame.
 */
export async function r5SampleFromTapFrame(image, read, calibration, capturedAtMs = Date.now()) {
  const empty = { r5Bar: null, r5Conf: null, r5Angle: null };
  const pose = tapNeedleModelPose(calibration, read);
  if (!image || !pose) return empty;
  // Prepare before awaiting: an async result keeps its original pose/crop.
  const data = prepareTapNeedleInput(image, pose);
  if (!isNeedleModelReady()) await loadNeedleModel();
  if (!isNeedleModelReady()) return empty;
  const prediction = await predictNeedleInput(data);
  const mapped = tapNeedlePrediction(prediction, pose);
  if (!mapped || mapped.bar == null || !(prediction.confidence >= NEEDLE_CONFIDENCE_MIN)) return empty;
  const tip = calibration.legacyScale ? matchTipAngle(image, read.hub.x, read.hub.y, read.radius,
    calibration.needleTemplate, read.zeroDeg, read.tenDeg, mapped.angleDeg, 0,
    { maxOffset: Math.max(4, Math.min(20, Math.ceil(read.radius * 0.09) * 2)) })
    : read.pointerVerified ? { angleDeg: read.needleDeg } : null;
  const corroborated = tip != null && Math.abs(wrapDelta(tip.angleDeg, mapped.angleDeg)) <= 5;
  return { r5Bar: mapped.bar, r5Conf: prediction.confidence, r5Angle: mapped.angleDeg,
    r5Registered: true, r5Corroborated: corroborated, r5CapturedAtMs: capturedAtMs,
    r5Pose: { hub: pose.hub, radius: pose.radius, shiftDeg: pose.shiftDeg } };
}
