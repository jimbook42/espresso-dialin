import { NEEDLE_TRACK_QUALITY, PROCESS_INTERVAL_MS, wrapDelta } from './gaugeConfig.js';
import {
  createClassicalReaderR6,
  regularizeReplayAnchors,
} from './classicalReaderR6.js';
import { gateConfigR7, loadR7Config } from './r7Config.js';
import { createTapReadingPublisher, currentTapModel } from './tapReadingPublisher.js';
import { createPressureCurveFilter } from './pressureCurveFilter.js';
import { isVerifiedGaugeCalibration } from './gaugeCompatibility.js';

export const SHOT_LAB_R7_FRAME_MS = PROCESS_INTERVAL_MS;
const MODEL_COMPARISON_MAX_DEG = 12;

/**
 * Live tap observations and explicit display holds. The classical and model
 * comparison is diagnostic only. The selected tap scale remains unchanged.
 */
export function createShotLabR7Publisher(tapCalibration, options = {}) {
  const bundle = loadR7Config();
  const gateCfg = gateConfigR7(bundle);
  if (options.modelTiebreak === false) gateCfg.modelTiebreak = false;
  const legacyScale = options.legacyScale === true || tapCalibration?.legacyScale === true;
  const { anchors } = regularizeReplayAnchors(tapCalibration, bundle.reader);
  const classical = createClassicalReaderR6(bundle.reader);
  const tapPublisher = createTapReadingPublisher(gateCfg);
  const curveFilter = createPressureCurveFilter();
  let lastDisplayBar = null;
  let shotT0 = 0;

  const reset = () => {
    classical.reset();
    shotT0 = 0;
    tapPublisher.reset();
    curveFilter.reset();
    lastDisplayBar = null;
  };

  const beginShot = (epochMs = Date.now()) => {
    reset();
    shotT0 = epochMs;
    tapPublisher.beginShot(epochMs);
  };

  /**
   * @param {{
   *   nowMs?: number,
   *   read: import('./tapCalibrate.js').TapCalibratedRead,
   *   r5Bar?: number | null,
   *   r5Conf?: number | null,
   *   r5Angle?: number | null,
   * }} frame
   */
  const stepFrame = (frame) => {
    const { nowMs = Date.now(), read } = frame;
    if (!anchors || !isVerifiedGaugeCalibration(tapCalibration)) {
      return { bar: null, fresh: false, held: false, uncertain: true,
        reason: 'gauge-unverified', classicalStep: null };
    }
    const t = (nowMs - shotT0) / 1000;
    const tracking = read.lost ? 'LOST' : read.ok ? 'TRACKING' : 'UNCERTAIN';
    const rest =
      read.bar != null
      && read.bar <= 0.15
      && (read.needleQuality ?? 0) >= NEEDLE_TRACK_QUALITY;
    const zeroDeg = !legacyScale && read.zeroDeg != null ? read.zeroDeg : anchors.zeroAngleDeg;
    const tenDeg = !legacyScale && read.tenDeg != null ? read.tenDeg : anchors.tenAngleDeg;
    const observation = tapPublisher.step({ ...frame, nowMs });
    const model = currentTapModel({ ...frame, nowMs }, shotT0);
    const agrees = observation.fresh && Number.isFinite(model?.angle)
      && Math.abs(wrapDelta(model.angle, read.needleDeg)) <= MODEL_COMPARISON_MAX_DEG;
    const classicalStep = classical.processFrame({
      t,
      tracking,
      needleDeg: read.needleDeg,
      rest,
      zeroDeg,
      tenDeg,
      r5Bar: agrees ? model.bar : null,
      r5Conf: agrees ? frame.r5Conf : null,
    });
    if (!legacyScale) {
      // bar and its freshness/timestamp remain the measured, unsmoothed value.
      // Never feed display output back into acceptance, rate or tracking gates.
      let displayBar = null;
      if (observation.fresh) {
        displayBar = curveFilter.step(observation.bar, observation.measuredAtMs,
          read.needleTrackingReset === true);
        lastDisplayBar = displayBar;
      } else {
        curveFilter.reset();
        if (observation.held) displayBar = lastDisplayBar;
        else lastDisplayBar = null;
      }
      return { ...observation, displayBar, classicalStep };
    }
    return { ...observation, classicalStep };
  };

  return {
    reset,
    beginShot,
    stepFrame,
    gateConfig: gateCfg,
    readerConfig: bundle.reader,
    anchors,
    rejectionCounts: tapPublisher.rejectionCounts,
  };
}
