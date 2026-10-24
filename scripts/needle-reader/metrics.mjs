/**
 * Section 7 metrics for the needle-reader exam.
 * Pure functions. Replay frames and label rows stay on disk; nothing is uploaded.
 */

export function finite(value) {
  return value != null && Number.isFinite(Number(value));
}

export function quantile(values, p) {
  const sorted = values.filter((value) => finite(value)).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - index) + sorted[hi] * (index - lo);
}

export function isShownReading(frame) {
  if (!frame || !finite(frame.bar)) return false;
  return frame.tracking !== 'LOST' && frame.tracking !== 'CALIBRATING';
}

export function coveragePct(frames) {
  if (!frames?.length) return null;
  return (100 * frames.filter(isShownReading).length) / frames.length;
}

/** First shown bar. Truth at the start of every clip is 0. */
export function restOffsetBar(frames) {
  const ordered = [...(frames || [])].sort((a, b) => (a.timeS ?? 0) - (b.timeS ?? 0));
  const first = ordered.find(isShownReading);
  return first ? Number(first.bar) : null;
}

/**
 * RMS of the second difference while the reading is steady.
 * A step bigger than 0.25 bar is motion, not jitter.
 */
export function jitterRms(frames) {
  const ordered = [...(frames || [])].sort((a, b) => (a.timeS ?? 0) - (b.timeS ?? 0));
  const bars = ordered.filter(isShownReading).map((frame) => Number(frame.bar));
  const second = [];
  for (let i = 2; i < bars.length; i += 1) {
    if (Math.abs(bars[i] - bars[i - 1]) > 0.25) continue;
    if (Math.abs(bars[i - 1] - bars[i - 2]) > 0.25) continue;
    second.push(bars[i] - 2 * bars[i - 1] + bars[i - 2]);
  }
  if (!second.length) return null;
  return Math.sqrt(second.reduce((sum, value) => sum + value * value, 0) / second.length);
}

/** One reason per frame, or null when the frame was accepted. */
export function rejectionReason(frame) {
  const flags = String(frame?.flags || '').split('|').map((part) => part.trim()).filter(Boolean);
  if (frame?.tracking === 'LOST' || flags.includes('tap-lost')) return 'lost';
  if (flags.includes('held-flip') || flags.includes('flip')) return 'flip';
  const held = flags.find((part) => part.startsWith('held-') || part.startsWith('gap-'));
  if (held) return held;
  if (flags.includes('hub')) return 'hub';
  if (flags.includes('reading-gap')) return 'reading-gap';
  if (flags.includes('out-of-arc')) return 'out-of-arc';
  if (flags.includes('low-confidence')) return 'low-confidence';
  if (flags.includes('step')) return 'step';
  if (flags.includes('rest-disagree')) return 'rest-disagree';
  return null;
}

export function rejectionCounts(frames) {
  const counts = {};
  for (const frame of frames || []) {
    const reason = rejectionReason(frame);
    if (!reason) continue;
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

export function labelErrorStats(rows) {
  const shown = (rows || []).filter((row) => finite(row.barErr) || finite(row.predBar));
  const errs = shown.map((row) => (finite(row.barErr) ? Math.abs(Number(row.barErr)) : null)).filter(finite);
  if (!errs.length) {
    return { n: shown.length, median: null, p90: null, wildPct: null };
  }
  const wild = errs.filter((err) => err > 1).length;
  return {
    n: errs.length,
    median: quantile(errs, 0.5),
    p90: quantile(errs, 0.9),
    wildPct: (100 * wild) / errs.length,
  };
}

/** needleErr from eval-labels is already the absolute wrapped degree error. */
export function flipRatePct(needleErrs) {
  const values = (needleErrs || []).filter(finite).map(Number);
  if (!values.length) return null;
  const flips = values.filter((err) => err >= 155).length;
  return (100 * flips) / values.length;
}

export function round(value, digits = 3) {
  if (!finite(value)) return null;
  const p = 10 ** digits;
  return Math.round(Number(value) * p) / p;
}

export function trackingCounts(frames) {
  const counts = {};
  for (const frame of frames || []) {
    const key = frame?.tracking || 'none';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
