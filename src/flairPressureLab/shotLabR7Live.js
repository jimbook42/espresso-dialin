import { NEEDLE_TRACK_QUALITY, PROCESS_INTERVAL_MS } from './gaugeConfig.js';
import {
  createClassicalReaderR6,
  regularizeReplayAnchors,
} from './classicalReaderR6.js';
import { initialTemporalState, stepTemporalGate } from './temporalGate.js';
import { gateConfigR7, loadR7Config } from './r7Config.js';

export const SHOT_LAB_R7_FRAME_MS = PROCESS_INTERVAL_MS;

/**
 * Live R7 publisher: tap-calibrated classical (R6-cleaned) + R5 sample + TemporalGate.
 * Reader numbers come from frozen r7_config.json only.
 */
export function createShotLabR7Publisher(tapCalibration) {
  const bundle = loadR7Config();
  const gateCfg = gateConfigR7(bundle);
  const { anchors } = regularizeReplayAnchors(tapCalibration, bundle.reader);
  const classical = createClassicalReaderR6(bundle.reader);
  let gateState = initialTemporalState();
  let shotT0 = 0;

  const reset = () => {
    classical.reset();
    gateState = initialTemporalState();
    shotT0 = 0;
  };

  const beginShot = (epochMs = Date.now()) => {
    reset();
    shotT0 = epochMs;
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
  const stepFrame = ({ nowMs = Date.now(), read, r5Bar = null, r5Conf = null, r5Angle = null }) => {
    if (!anchors) {
      return { bar: null, uncertain: true, reason: 'no-anchors', classicalStep: null };
    }
    const t = (nowMs - shotT0) / 1000;
    const tracking = read.lost ? 'LOST' : read.ok ? 'TRACKING' : 'UNCERTAIN';
    const rest =
      read.bar != null
      && read.bar <= 0.15
      && (read.needleQuality ?? 0) >= NEEDLE_TRACK_QUALITY;
    const classicalStep = classical.processFrame({
      t,
      tracking,
      needleDeg: read.needleDeg,
      rest,
      zeroDeg: anchors.zeroAngleDeg,
      tenDeg: anchors.tenAngleDeg,
      r5Bar,
      r5Conf,
    });
    const classicalBar = classicalStep.published ? classicalStep.bar : null;
    const classicalConfidence =
      classicalStep.published && classicalBar != null ? NEEDLE_TRACK_QUALITY : null;
    const gated = stepTemporalGate(gateState, {
      t,
      r2Bar: r5Bar,
      r2Conf: r5Conf,
      r2Angle: r5Angle,
      classicalBar,
      classicalAngle: classicalStep.needleDeg,
      classicalConfidence,
      rest,
    }, gateCfg);
    gateState = gated.state;
    const uncertain = gated.bar == null;
    return {
      bar: gated.bar,
      uncertain,
      reason: gated.reason,
      classicalStep,
    };
  };

  return {
    reset,
    beginShot,
    stepFrame,
    gateConfig: gateCfg,
    readerConfig: bundle.reader,
    anchors,
  };
}
