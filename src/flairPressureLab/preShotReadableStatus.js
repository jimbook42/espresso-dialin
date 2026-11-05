import {
  PRE_SHOT_DIAL_FOUND_LABEL,
  PRE_SHOT_DIAL_NOT_FOUND_LABEL,
} from './preShotDialCheck.js';

/** How long a confident reading still counts as "readable right now". */
export const PRE_SHOT_READABLE_WINDOW_MS = 1500;

export const PRE_SHOT_GAUGE_NOT_READABLE_LABEL =
  'Gauge not found – recalibrate in shot position';

export const CALIBRATION_LEVER_HINT =
  "Set the lever where it'll be when you press Start.";

/**
 * Gate for a sample the shot actually records.
 * Matches useShotLabPressure: a publisher bar that is fresh.
 * Shot epoch only decides whether that sample is stored.
 * @param {{ bar?: number | null, fresh?: boolean } | null | undefined} gated
 */
export function isRecordedSampleConfident(gated) {
  return gated?.bar != null && gated.fresh === true;
}

/**
 * Publisher reason, with the display-hold prefix removed.
 * A lost read is pose-lost, the same bucket reader stall diagnostics uses.
 * @param {{ reason?: string } | null | undefined} gated
 * @param {{ lost?: boolean } | null | undefined} [read]
 */
export function preShotRejectionReason(gated, read) {
  if (read?.lost) return 'pose-lost';
  const underlying = String(gated?.reason ?? 'unspecified').replace(/^held:/, '');
  return underlying || 'unspecified';
}

/**
 * Recent rejections are pose-lost-dominated when pose-lost is a strict majority.
 * @param {{ atMs: number, reason: string }[]} rejections
 * @param {number} nowMs
 * @param {number} [windowMs]
 */
export function recentRejectionsPoseLostDominated(
  rejections,
  nowMs,
  windowMs = PRE_SHOT_READABLE_WINDOW_MS,
) {
  let poseLost = 0;
  let other = 0;
  for (const rejection of rejections) {
    const age = nowMs - rejection.atMs;
    if (age < 0 || age > windowMs) continue;
    if (rejection.reason === 'pose-lost') poseLost += 1;
    else other += 1;
  }
  return poseLost > 0 && poseLost > other;
}

/**
 * Sliding window of publisher outcomes before Start.
 * Does not score frames itself; it only remembers the existing gate result.
 */
export function createPreShotReadableWindow({
  windowMs = PRE_SHOT_READABLE_WINDOW_MS,
} = {}) {
  let lastConfidentMs = null;
  /** @type {{ atMs: number, reason: string }[]} */
  const rejections = [];

  const prune = (nowMs) => {
    const cutoff = nowMs - windowMs;
    while (rejections.length && rejections[0].atMs < cutoff) rejections.shift();
  };

  return {
    reset() {
      lastConfidentMs = null;
      rejections.length = 0;
    },
    /**
     * @param {{ bar?: number | null, fresh?: boolean, reason?: string } | null | undefined} gated
     * @param {number} nowMs
     * @param {{ lost?: boolean } | null | undefined} [read]
     */
    note(gated, nowMs, read) {
      if (isRecordedSampleConfident(gated)) {
        lastConfidentMs = nowMs;
        return;
      }
      rejections.push({ atMs: nowMs, reason: preShotRejectionReason(gated, read) });
      prune(nowMs);
    },
    snapshot(nowMs) {
      prune(nowMs);
      return {
        lastConfidentMs,
        rejections: rejections.filter((rejection) => nowMs - rejection.atMs <= windowMs),
      };
    },
  };
}

/**
 * Green only when the existing pose lock is found AND the needle is readable.
 * Pose lock is unchanged. Unreadable (or pose-lost-dominated) stays advisory.
 * @param {{
 *   poseStatus?: 'checking' | 'found' | 'not_found' | null,
 *   nowMs?: number,
 *   lastConfidentMs?: number | null,
 *   rejections?: { atMs: number, reason: string }[],
 *   windowMs?: number,
 * }} input
 * @returns {'checking' | 'found' | 'not_found' | 'unreadable' | null}
 */
export function preShotDialDisplayStatus({
  poseStatus = null,
  nowMs = 0,
  lastConfidentMs = null,
  rejections = [],
  windowMs = PRE_SHOT_READABLE_WINDOW_MS,
} = {}) {
  if (poseStatus !== 'found') return poseStatus ?? null;
  const age = lastConfidentMs == null ? null : nowMs - lastConfidentMs;
  const readable = age != null && age >= 0 && age <= windowMs;
  const poseLostDominated = recentRejectionsPoseLostDominated(rejections, nowMs, windowMs);
  if (readable && !poseLostDominated) return 'found';
  return 'unreadable';
}

/**
 * @param {'checking' | 'found' | 'not_found' | 'unreadable' | null | undefined} status
 * @returns {{ tone: 'hidden' | 'green' | 'amber', label: string | null }}
 */
export function preShotDialStatusView(status) {
  if (!status || status === 'checking') return { tone: 'hidden', label: null };
  if (status === 'found') return { tone: 'green', label: PRE_SHOT_DIAL_FOUND_LABEL };
  if (status === 'unreadable') {
    return { tone: 'amber', label: PRE_SHOT_GAUGE_NOT_READABLE_LABEL };
  }
  return { tone: 'amber', label: PRE_SHOT_DIAL_NOT_FOUND_LABEL };
}
