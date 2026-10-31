import { NEEDLE_TRACK_QUALITY } from './gaugeConfig.js';
import { median } from './gaugeProfile.js';

/**
 * Temporal gate for an R2 bar that has already passed the arc and confidence accept.
 * One config object holds every threshold. The function is pure: pass the previous
 * state back in, and it returns the next state with the bar to publish (or null).
 *
 * A frame is withheld when the recent R2 bars flicker, when R2 disagrees with the
 * one-second median of classical TRACKING bars, when that median is missing, or
 * when the step from the last published bar is faster than the rate gate.
 * Three agreeing candidates relock a new level. A rest frame publishes 0 bar.
 *
 * The shipped object is the repair-1 gate: wide agreement, pre-lock R2, and a
 * half-second hold. Carrying the classical median another second is implemented
 * and left off, because that path pushed the wild rate over 5%.
 */
export const TEMPORAL_GATE = {
  classicalWindowS: 1,
  r2WindowS: 2,
  flickerFraction: 0.5,
  flickerJumpBar: 2,
  disagreeBar: 1.5,
  rateBarPerS: 14,
  rateSlackBar: 0.5,
  rateWindowS: 2,
  relockCount: 3,
  relockBandBar: 1,
  restBar: 0,
  /** 'off' | 'classical' | 'wide'. Wide is the R4 recovery that held the wild gate. */
  recovery: 'wide',
  wideDisagreeBar: 2,
  wideConfidence: 0.5,
  classicalConfidenceMin: NEEDLE_TRACK_QUALITY,
  /** Exam flip: a reading within 25° of 180° from the other needle. */
  flipDeg: 155,
  /** R2 alone before any classical TRACKING bar. The arc accept is the confidence gate. */
  prelock: true,
  prelockCount: 3,
  prelockBandBar: 0.5,
  /** Seconds to keep using the last classical median after the rolling window empties. */
  classicalCarryS: 0,
  /** Republish the last bar while a newer R2 stays inside holdBandBar. */
  holdGapS: 0.5,
  holdBandBar: 0.5,
  /**
   * R7: prefer cleaned classical whenever it is published.
   * modelTiebreak: a disagreement withholds only when classical is already unsure.
   * Off, the model still blocks a published classical bar past classicalDirectMaxDisagreeBar.
   */
  classicalDirect: false,
  modelTiebreak: false,
  classicalDirectMaxDisagreeBar: 2,
  classicalDirectMinConfidence: 0.18,
  /** When set, classicalDirect only runs if R2 confidence is below this (or R2 bar missing). */
  classicalDirectMaxR2Conf: null,
  classicalDirectAllowWeakR2: false,
};

export function initialTemporalState() {
  return {
    r2Hist: [],
    classicalHist: [],
    last: null,
    pending: [],
    seenClassical: false,
    carriedMedian: null,
  };
}

function trim(hist, t, windowS) {
  const kept = [];
  for (const row of hist) {
    if (t - row.t <= windowS) kept.push(row);
  }
  return kept;
}

function flickerFraction(values, jumpBar) {
  if (values.length < 2) return 0;
  let jumps = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (Math.abs(values[i] - values[i - 1]) > jumpBar) jumps += 1;
  }
  return jumps / (values.length - 1);
}

function circularSeparation(a, b) {
  const wrap = (deg) => ((deg % 360) + 360) % 360;
  const d = Math.abs(wrap(a) - wrap(b)) % 360;
  return Math.min(d, 360 - d);
}

function classicalIsConfident(sample, config) {
  const confidence = sample.classicalConfidence;
  return sample.classicalBar != null
    && confidence != null
    && Number.isFinite(confidence)
    && confidence >= config.classicalConfidenceMin;
}

function classicalIsFlip(sample, config) {
  const model = sample.r2Angle;
  const classical = sample.classicalAngle;
  if (model == null || classical == null) return false;
  if (!Number.isFinite(model) || !Number.isFinite(classical)) return false;
  return circularSeparation(model, classical) >= config.flipDeg;
}

function classicalIsPublished(sample, config) {
  return sample.classicalBar != null
    && Number.isFinite(sample.classicalBar)
    && sample.classicalConfidence != null
    && Number.isFinite(sample.classicalConfidence)
    && sample.classicalConfidence >= config.classicalDirectMinConfidence
    && !classicalIsFlip(sample, config);
}

/** When classicalDirect is on, publish classical. A model disagreement withholds only when asked. */
function preferClassicalBar(sample, config, r2Bar, currentBar) {
  if (config.classicalDirect !== true || !classicalIsPublished(sample, config)) {
    return { bar: currentBar, reason: null };
  }
  const guard = config.classicalDirectMaxDisagreeBar;
  const disagrees = r2Bar != null && Math.abs(sample.classicalBar - r2Bar) > guard;
  if (disagrees && (config.modelTiebreak !== true || sample.classicalUnsure === true)) {
    return { bar: currentBar, reason: null };
  }
  return { bar: sample.classicalBar, reason: 'classical-direct' };
}

/**
 * @param {ReturnType<typeof initialTemporalState>} state
 * @param {{
 *   t: number,
 *   r2Bar?: number|null,
 *   r2Conf?: number|null,
 *   r2Angle?: number|null,
 *   classicalBar?: number|null,
 *   classicalConfidence?: number|null,
 *   classicalAngle?: number|null,
 *   classicalUnsure?: boolean,
 *   rest?: boolean,
 * }} sample
 * @param {typeof TEMPORAL_GATE} [config]
 * @returns {{ state: ReturnType<typeof initialTemporalState>, bar: number|null, reason: string }}
 */
export function stepTemporalGate(state, sample, config = TEMPORAL_GATE) {
  const t = sample.t;
  const r2Bar = sample.r2Bar == null || !Number.isFinite(sample.r2Bar) ? null : sample.r2Bar;
  let classicalHist = trim(state.classicalHist, t, config.classicalWindowS);
  let seenClassical = state.seenClassical === true;
  if (sample.classicalBar != null && Number.isFinite(sample.classicalBar)) {
    classicalHist = classicalHist.concat({ t, bar: sample.classicalBar });
    seenClassical = true;
  }
  let r2Hist = trim(state.r2Hist, t, config.r2WindowS);
  if (r2Bar != null) r2Hist = r2Hist.concat({ t, bar: r2Bar });
  let pending = state.pending;
  let last = state.last;
  let carriedMedian = state.carriedMedian;
  let bar = null;
  let reason = 'no-r2';
  if (r2Bar != null) {
    const values = r2Hist.map((row) => row.bar);
    const flicker = flickerFraction(values, config.flickerJumpBar);
    bar = r2Bar;
    let ok = flicker <= config.flickerFraction;
    reason = ok ? null : 'flicker';
    if (ok && last != null && t - last.t <= config.rateWindowS) {
      const limit = config.rateSlackBar + config.rateBarPerS * (t - last.t);
      if (Math.abs(bar - last.bar) > limit) {
        pending = pending.concat(bar);
        const relocked = pending.length >= config.relockCount
          && Math.max(...pending) - Math.min(...pending) <= config.relockBandBar;
        if (relocked) {
          pending = [];
          reason = null;
        } else {
          ok = false;
          reason = 'rate';
        }
      } else {
        pending = [];
      }
    } else if (ok) {
      pending = [];
    }
    if (ok) {
      const freshMedian = median(classicalHist.map((row) => row.bar));
      if (freshMedian != null) carriedMedian = { t, bar: freshMedian };
      let classicalMedian = freshMedian;
      if (
        classicalMedian == null
        && config.classicalCarryS > 0
        && carriedMedian != null
        && t > carriedMedian.t
        && t - carriedMedian.t <= config.classicalCarryS
      ) {
        classicalMedian = carriedMedian.bar;
      }
      let band = config.disagreeBar;
      if (
        config.recovery === 'wide'
        && sample.r2Conf != null
        && sample.r2Conf > config.wideConfidence
      ) {
        band = config.wideDisagreeBar;
      }
      if (
        classicalMedian == null
        && sample.classicalBar != null
        && Number.isFinite(sample.classicalBar)
        && r2Bar != null
        && Math.abs(r2Bar - sample.classicalBar) <= band
      ) {
        classicalMedian = sample.classicalBar;
      }
      if (classicalMedian == null) {
        ok = false;
        reason = 'no-classical';
      } else if (Math.abs(bar - classicalMedian) > band) {
        ok = false;
        reason = 'disagree';
      }
    }
    if (!ok && reason === 'no-classical' && config.prelock === true && !seenClassical) {
      const recent = r2Hist.slice(-config.prelockCount).map((row) => row.bar);
      const spread = recent.length ? Math.max(...recent) - Math.min(...recent) : Infinity;
      if (recent.length >= config.prelockCount && spread <= config.prelockBandBar) {
        ok = true;
        bar = r2Bar;
        reason = 'prelock';
      }
    }
    if (!ok) bar = null;
    else {
      const preferred = preferClassicalBar(sample, config, r2Bar, bar);
      bar = preferred.bar;
      last = { t, bar };
      if (preferred.reason) reason = preferred.reason;
      else if (reason !== 'prelock') reason = 'ok';
    }
  }

  if (
    bar == null
    && config.recovery === 'classical'
    && classicalIsConfident(sample, config)
    && !classicalIsFlip(sample, config)
  ) {
    bar = sample.classicalBar;
    last = { t, bar };
    pending = [];
    reason = 'classical';
  }

  if (bar == null && sample.rest !== true) {
    const preferred = preferClassicalBar(sample, config, r2Bar, bar);
    if (preferred.bar != null) {
      bar = preferred.bar;
      last = { t, bar };
      pending = [];
      reason = preferred.reason;
    }
  }

  // A short hole keeps the last bar when the new R2 has not moved away from it.
  // The timestamp stays on the real accept, so the hole cannot run longer than holdGapS.
  if (
    bar == null
    && config.holdGapS > 0
    && last != null
    && t > last.t
    && t - last.t <= config.holdGapS
    && r2Bar != null
    && Math.abs(r2Bar - last.bar) <= config.holdBandBar
  ) {
    bar = last.bar;
    reason = 'hold';
  }

  // An accepted rest reading is exactly 0. A rejected rest frame stays unpublished,
  // so a pin-looking R2 miss during the shot is not turned into a false zero.
  if (bar != null && sample.rest === true) {
    bar = config.restBar;
    last = { t, bar };
    reason = 'rest';
  }

  return {
    state: { r2Hist, classicalHist, last, pending, seenClassical, carriedMedian },
    bar,
    reason: reason || 'ok',
  };
}

/** Replay a stream. `samples` are already past the arc/confidence accept. */
export function runTemporalGate(samples, config = TEMPORAL_GATE) {
  let state = initialTemporalState();
  const out = [];
  for (const sample of samples) {
    const stepped = stepTemporalGate(state, sample, config);
    state = stepped.state;
    out.push(stepped);
  }
  return out;
}
