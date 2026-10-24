/**
 * R6 classical reader: anchor-regularised bar, spike rejection, light smoothing,
 * and UNCERTAIN hold on fast rises. Pure stream processor for replay and live.
 */
import { PROCESS_INTERVAL_MS, wrap360, wrapDelta, FLIP_REJECT_DEG } from './gaugeConfig.js';
import {
  barFromRegularizedAnchors,
  regularizeTapAnchors,
} from './anchorRegularize.js';
import { circularMedian } from './smoothPressure.js';

export const DEFAULT_R6_CONFIG = {
  spanToleranceDeg: 4,
  fiveToTenToleranceDeg: 4,
  blendWeight: 0.75,
  spikeFlipDeg: 90,
  maxBarStep: 2.2,
  relockCount: 3,
  relockBandBar: 0.4,
  nearTenBar: 9.2,
  nearTenPrevBar: 5.5,
  nearTenAgreeCount: 3,
  medianWindow: 3,
  emaAlpha: 0.38,
  uncertainHoldMaxS: 0.45,
  uncertainMaxStepBar: 1.8,
  uncertainR5BandBar: 2,
  uncertainMinR5Conf: 0.5,
  maxGroupDelayMs: 150,
  frameIntervalMs: PROCESS_INTERVAL_MS,
  restEpsilon: 0.0001,
};

function circSep(a, b) {
  const d = Math.abs(wrap360(a) - wrap360(b)) % 360;
  return Math.min(d, 360 - d);
}

export function regularizeReplayAnchors(tapCalibration, config = DEFAULT_R6_CONFIG) {
  const anchors = tapCalibration?.anchors ?? tapCalibration;
  if (!anchors?.zeroAngleDeg || anchors.tenAngleDeg == null) {
    return { anchors: null, stats: { rejected: false, blended: false } };
  }
  const hub = anchors.centre ?? tapCalibration?.centre;
  const five = anchors.five;
  const ten = anchors.ten;
  const reg = regularizeTapAnchors(
    {
      zeroAngleDeg: anchors.zeroAngleDeg,
      fiveAngleDeg: anchors.fiveAngleDeg,
      tenAngleDeg: anchors.tenAngleDeg,
    },
    hub,
    five,
    ten,
    config,
  );
  return {
    anchors: {
      ...anchors,
      zeroAngleDeg: reg.zeroAngleDeg,
      fiveAngleDeg: reg.fiveAngleDeg,
      tenAngleDeg: reg.tenAngleDeg,
      spanDeg: reg.spanDeg,
    },
    stats: reg,
  };
}

export function createClassicalReaderR6(config = DEFAULT_R6_CONFIG) {
  const cfg = { ...DEFAULT_R6_CONFIG, ...config };
  let lastAcceptedNeedle = null;
  let lastAcceptedBar = null;
  let pendingRelock = [];
  let nearTenPending = [];
  let medianBuf = [];
  let emaBar = null;
  let holdBar = null;
  let holdNeedle = null;
  let holdUntilT = null;
  let holdEpisodeDone = false;
  let lastPublishT = null;

  const reset = () => {
    lastAcceptedNeedle = null;
    lastAcceptedBar = null;
    pendingRelock = [];
    nearTenPending = [];
    medianBuf = [];
    emaBar = null;
    holdBar = null;
    holdNeedle = null;
    holdUntilT = null;
    holdEpisodeDone = false;
    lastPublishT = null;
  };

  const pushMedian = (bar) => {
    medianBuf.push(bar);
    while (medianBuf.length > cfg.medianWindow) medianBuf.shift();
    if (medianBuf.length < cfg.medianWindow) return bar;
    return median(medianBuf);
  };

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const smoothBar = (rawBar) => {
    const med = pushMedian(rawBar);
    emaBar = emaBar == null ? med : emaBar + cfg.emaAlpha * (med - emaBar);
    return emaBar;
  };

  const isSpikeCandidate = (needleDeg, bar, rest) => {
    if (needleDeg == null || bar == null) return true;
    if (rest) return false;
    if (lastAcceptedNeedle != null && circSep(needleDeg, lastAcceptedNeedle) >= cfg.spikeFlipDeg) {
      return true;
    }
    if (lastAcceptedNeedle != null && circSep(needleDeg, lastAcceptedNeedle) >= FLIP_REJECT_DEG) {
      return true;
    }
    if (lastAcceptedBar != null && Math.abs(bar - lastAcceptedBar) > cfg.maxBarStep) {
      return true;
    }
    if (bar >= cfg.nearTenBar && (lastAcceptedBar ?? 0) < cfg.nearTenPrevBar) {
      nearTenPending.push(bar);
      if (nearTenPending.length > cfg.nearTenAgreeCount) nearTenPending.shift();
      if (nearTenPending.length < cfg.nearTenAgreeCount) return true;
      const spread = Math.max(...nearTenPending) - Math.min(...nearTenPending);
      if (spread > cfg.relockBandBar) return true;
    } else {
      nearTenPending = [];
    }
    return false;
  };

  const acceptReading = (needleDeg, bar, t) => {
    if (lastAcceptedBar != null && Math.abs(bar - lastAcceptedBar) > cfg.maxBarStep) {
      pendingRelock.push(bar);
      if (pendingRelock.length > cfg.relockCount) pendingRelock.shift();
      const spread = pendingRelock.length
        ? Math.max(...pendingRelock) - Math.min(...pendingRelock)
        : Infinity;
      if (pendingRelock.length < cfg.relockCount || spread > cfg.relockBandBar) {
        return null;
      }
      pendingRelock = [];
    } else {
      pendingRelock = [];
    }
    lastAcceptedNeedle = needleDeg;
    lastAcceptedBar = bar;
    const smoothed = smoothBar(bar);
    lastPublishT = t;
    holdBar = null;
    holdNeedle = null;
    holdUntilT = null;
    holdEpisodeDone = false;
    return smoothed;
  };

  /**
   * @param {{
   *   t: number,
   *   tracking: string,
   *   needleDeg?: number|null,
   *   rest?: boolean,
   *   zeroDeg: number,
   *   tenDeg: number,
   *   r5Bar?: number|null,
   *   r5Conf?: number|null,
   * }} frame
   */
  const processFrame = (frame) => {
    const { t, tracking, needleDeg, rest, zeroDeg, tenDeg, r5Bar, r5Conf } = frame;
    const trackingOk = tracking === 'TRACKING' && needleDeg != null;

    if (rest) {
      const bar = 0;
      lastAcceptedNeedle = needleDeg ?? lastAcceptedNeedle;
      lastAcceptedBar = 0;
      medianBuf = [0];
      emaBar = 0;
      pendingRelock = [];
      nearTenPending = [];
      holdBar = null;
      holdUntilT = null;
      return {
        bar: 0,
        needleDeg: needleDeg ?? lastAcceptedNeedle,
        published: true,
        reason: 'rest',
        rawBar: 0,
        spikeRejected: false,
      };
    }

    let rawBar = null;
    if (trackingOk) {
      if (lastAcceptedNeedle != null && circSep(needleDeg, lastAcceptedNeedle) >= cfg.spikeFlipDeg) {
        return {
          bar: null,
          needleDeg,
          published: false,
          reason: 'spike-reject',
          rawBar: null,
          spikeRejected: true,
        };
      }
      rawBar = barFromRegularizedAnchors(needleDeg, zeroDeg, tenDeg);
      if (rawBar == null) {
        return {
          bar: null,
          needleDeg,
          published: false,
          reason: 'spike-reject',
          rawBar: null,
          spikeRejected: true,
        };
      }
    }

    if (trackingOk && rawBar != null) {
      if (isSpikeCandidate(needleDeg, rawBar, false)) {
        holdBar = null;
        holdUntilT = null;
        return {
          bar: null,
          needleDeg,
          published: false,
          reason: 'spike-reject',
          rawBar,
          spikeRejected: true,
        };
      }
      const accepted = acceptReading(needleDeg, rawBar, t);
      if (accepted == null) {
        return {
          bar: null,
          needleDeg,
          published: false,
          reason: 'rate-reject',
          rawBar,
          spikeRejected: false,
        };
      }
      return {
        bar: accepted,
        needleDeg,
        published: true,
        reason: 'tracking',
        rawBar,
        spikeRejected: false,
      };
    }

    // UNCERTAIN / lost: rate-limited hold when direction still in-arc
    const canHold = lastAcceptedNeedle != null
      && lastAcceptedBar != null
      && holdUntilT == null
      && !holdEpisodeDone
      && lastPublishT != null;
    if (canHold) {
      const r5Agree = r5OkBar(r5Bar, r5Conf, lastAcceptedBar, cfg);
      const inArc = barFromRegularizedAnchors(
        lastAcceptedNeedle,
        zeroDeg,
        tenDeg,
      ) != null;
      if (inArc && (r5Agree || r5Bar == null)) {
        holdBar = lastAcceptedBar;
        holdNeedle = lastAcceptedNeedle;
        holdUntilT = t + cfg.uncertainHoldMaxS;
      }
    }
    if (holdBar != null && holdUntilT != null && t <= holdUntilT) {
      const dt = Math.max(0.001, t - (lastPublishT ?? t));
      const step = Math.min(cfg.uncertainMaxStepBar, cfg.maxBarStep * (dt / (cfg.frameIntervalMs / 1000)));
      let extrap = holdBar;
      if (r5OkBar(r5Bar, r5Conf, holdBar, cfg) && r5Bar != null) {
        extrap = holdBar + Math.max(-step, Math.min(step, r5Bar - holdBar));
      }
      return {
        bar: extrap,
        needleDeg: holdNeedle,
        published: true,
        reason: 'uncertain-hold',
        rawBar: null,
        spikeRejected: false,
      };
    }
    if (holdUntilT != null && t > holdUntilT) {
      holdEpisodeDone = true;
    }
    holdBar = null;
    holdUntilT = null;
    return {
      bar: null,
      needleDeg: needleDeg ?? null,
      published: false,
      reason: 'uncertain',
      rawBar: null,
      spikeRejected: false,
    };
  };

  return { processFrame, reset, config: cfg };
}

function r5OkBar(r5Bar, r5Conf, holdBar, cfg) {
  return r5Bar != null
    && r5Conf != null
    && r5Conf >= cfg.uncertainMinR5Conf
    && Math.abs(r5Bar - holdBar) <= cfg.uncertainR5BandBar;
}

/** Median-of-3 + EMA group delay on a step (frames × frameIntervalMs). */
export function measureSmoothingDelayMs(config = DEFAULT_R6_CONFIG) {
  const reader = createClassicalReaderR6({ ...config, maxBarStep: 99 });
  const zero = 0;
  const ten = 161;
  let t = 0;
  const dt = config.frameIntervalMs / 1000;
  const targets = [];
  for (let i = 0; i < 40; i += 1) {
    const level = i < 5 ? 0 : 5;
    const needle = zero + level * 16;
    const out = reader.processFrame({
      t,
      tracking: 'TRACKING',
      needleDeg: needle,
      rest: level === 0 && i < 5,
      zeroDeg: zero,
      tenDeg: ten,
    });
    if (out.published && out.bar != null && out.bar >= 4.5 && targets.length === 0) {
      targets.push({ t, bar: out.bar });
    }
    t += dt;
  }
  if (!targets.length) return config.medianWindow * config.frameIntervalMs;
  const hit = targets[0];
  const delayFrames = (config.medianWindow - 1) / 2 + 1 / config.emaAlpha;
  return Math.min(config.maxGroupDelayMs, delayFrames * config.frameIntervalMs);
}

/** Process a replay frame list; mutates nothing. */
export function processClassicalReplay(frames, tapCalibration, config = DEFAULT_R6_CONFIG) {
  const { anchors, stats } = regularizeReplayAnchors(tapCalibration, config);
  if (!anchors) return { frames: [], anchorStats: stats };
  const reader = createClassicalReaderR6(config);
  const zeroDeg = anchors.zeroAngleDeg;
  const tenDeg = anchors.tenAngleDeg;
  const out = frames.map((fr) => {
    const step = reader.processFrame({
      t: fr.timeS,
      tracking: fr.tracking,
      needleDeg: fr.needleAngleDeg == null ? null : Number(fr.needleAngleDeg),
      rest: Boolean(fr.rest),
      zeroDeg,
      tenDeg,
      r5Bar: fr.r5Bar ?? null,
      r5Conf: fr.r5Conf ?? null,
    });
    return { ...fr, classicalR6: step };
  });
  return { frames: out, anchorStats: stats, anchors };
}

export { circularMedian };
