import { NEEDLE_TRACK_QUALITY, PROCESS_INTERVAL_MS } from './gaugeConfig.js';
import {
  createClassicalReaderR6,
  regularizeReplayAnchors,
} from './classicalReaderR6.js';
import { initialTemporalState, stepTemporalGate } from './temporalGate.js';
import { gateConfigR7, loadR7Config } from './r7Config.js';
import { publishTapBar } from './tapCalibrate.js';
import { createTapReadingPublisher } from './tapReadingPublisher.js';
import { createPressureCurveFilter } from './pressureCurveFilter.js';

export const SHOT_LAB_R7_FRAME_MS = PROCESS_INTERVAL_MS;

/**
 * Live tap observations with registered model recovery and explicit display holds.
 * The legacy R6/TemporalGate path and shared rate limits use frozen r7_config.
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
  let gateState = initialTemporalState();
  let shotT0 = 0;
  let lastOut = null;

  const reset = () => {
    classical.reset();
    gateState = initialTemporalState();
    shotT0 = 0;
    lastOut = null;
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
    const { nowMs = Date.now(), read, r5Bar = null, r5Conf = null, r5Angle = null } = frame;
    if (!anchors) {
      return { bar: null, uncertain: true, reason: 'no-anchors', classicalStep: null };
    }
    const t = (nowMs - shotT0) / 1000;
    const tracking = read.lost ? 'LOST' : read.ok ? 'TRACKING' : 'UNCERTAIN';
    const rest =
      read.bar != null
      && read.bar <= 0.15
      && (read.needleQuality ?? 0) >= NEEDLE_TRACK_QUALITY;
    const zeroDeg = !legacyScale && read.zeroDeg != null ? read.zeroDeg : anchors.zeroAngleDeg;
    const tenDeg = !legacyScale && read.tenDeg != null ? read.tenDeg : anchors.tenAngleDeg;
    const classicalStep = classical.processFrame({
      t,
      tracking,
      needleDeg: read.needleDeg,
      rest,
      zeroDeg,
      tenDeg,
      r5Bar,
      r5Conf,
    });
    if (!legacyScale) {
      const observation = tapPublisher.step({ ...frame, nowMs });
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
    const tapSure = !legacyScale && read.ok && read.bar != null && !read.lost;
    let classicalBar = classicalStep.published ? classicalStep.bar : null;
    // The tap reader's bar is piecewise through the user's 5 and 10, and it
    // already refused a 10 that was not climbed to. The linear classical span
    // is the v4.13.21 scale.
    if (tapSure) classicalBar = read.bar;
    const classicalConfidence =
      classicalBar != null && (tapSure || classicalStep.published) ? NEEDLE_TRACK_QUALITY : null;
    // The classical reader already says when it is guessing: it did not publish,
    // or it is holding the last bar through an UNCERTAIN stretch.
    const classicalUnsure = tapSure
      ? false
      : (!classicalStep.published || classicalStep.reason === 'uncertain-hold');
    const gated = stepTemporalGate(gateState, {
      t,
      r2Bar: r5Bar,
      r2Conf: r5Conf,
      r2Angle: r5Angle,
      classicalBar,
      classicalAngle: classicalStep.needleDeg,
      classicalConfidence,
      classicalUnsure,
      rest,
    }, gateCfg);
    gateState = gated.state;
    let bar = gated.bar;
    if (!legacyScale) {
      bar = publishTapBar({
        bar,
        needleDeg: read.needleDeg,
        tenDeg,
        previousBar: lastOut,
      });
      // A missed needle used to publish the classical hold, which sits below
      // the last good bar while the lever is still rising.
      if (read.bar == null && bar != null && lastOut != null && bar < lastOut - 0.15) {
        bar = lastOut;
      }
    }
    if (bar != null) lastOut = bar;
    const uncertain = bar == null;
    const held = bar != null && (bar !== gated.bar || gated.reason === 'hold'
      || classicalStep.reason === 'uncertain-hold');
    return {
      bar,
      uncertain,
      fresh: bar != null && !held,
      held,
      measuredAtMs: bar != null && !held ? nowMs : null,
      reason: bar != null && bar !== gated.bar ? 'hold-max' : gated.reason,
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
