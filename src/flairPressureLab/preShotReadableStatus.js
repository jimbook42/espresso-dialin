import {
  PRE_SHOT_DIAL_FOUND_LABEL,
  PRE_SHOT_DIAL_NOT_FOUND_LABEL,
  preShotDialMismatch,
} from './preShotDialCheck.js';

/** How long a confident reading still counts as "readable right now". */
export const PRE_SHOT_READABLE_WINDOW_MS = 1500;

/** Pose-lost rejections required before that reason can mark the gauge lost. */
export const PRE_SHOT_POSE_LOST_MIN_COUNT = 3;

/** Pose-lost must be strictly more than this share of recent frames. */
export const PRE_SHOT_POSE_LOST_FRAME_SHARE = 0.5;

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
 * Pose-lost dominates only when it is a clear majority of a meaningful sample.
 * The sample is every recent frame: confident readings and rejections.
 * @param {{ atMs: number, reason: string }[]} rejections
 * @param {number} nowMs
 * @param {number} [windowMs]
 * @param {number[]} [confidentAt]
 */
export function recentRejectionsPoseLostDominated(
  rejections,
  nowMs,
  windowMs = PRE_SHOT_READABLE_WINDOW_MS,
  confidentAt = [],
) {
  const inWindow = (atMs) => {
    const age = nowMs - atMs;
    return age >= 0 && age <= windowMs;
  };
  let poseLost = 0;
  let other = 0;
  for (const rejection of rejections) {
    if (!inWindow(rejection.atMs)) continue;
    if (rejection.reason === 'pose-lost') poseLost += 1;
    else other += 1;
  }
  const confident = confidentAt.filter(inWindow).length;
  const total = poseLost + other + confident;
  if (total === 0) return false;
  return poseLost >= PRE_SHOT_POSE_LOST_MIN_COUNT
    && poseLost / total > PRE_SHOT_POSE_LOST_FRAME_SHARE;
}

/**
 * Sliding window of publisher outcomes before Start.
 * Does not score frames itself; it only remembers the existing gate result.
 */
export function createPreShotReadableWindow({
  windowMs = PRE_SHOT_READABLE_WINDOW_MS,
} = {}) {
  let lastConfidentMs = null;
  /** @type {number[]} */
  const confidentAt = [];
  /** @type {{ atMs: number, reason: string }[]} */
  const rejections = [];

  const prune = (nowMs) => {
    const cutoff = nowMs - windowMs;
    while (rejections.length && rejections[0].atMs < cutoff) rejections.shift();
    while (confidentAt.length && confidentAt[0] < cutoff) confidentAt.shift();
  };

  return {
    reset() {
      lastConfidentMs = null;
      confidentAt.length = 0;
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
        confidentAt.push(nowMs);
        prune(nowMs);
        return;
      }
      rejections.push({ atMs: nowMs, reason: preShotRejectionReason(gated, read) });
      prune(nowMs);
    },
    snapshot(nowMs) {
      prune(nowMs);
      return {
        lastConfidentMs,
        confidentAt: confidentAt.filter((atMs) => nowMs - atMs <= windowMs),
        rejections: rejections.filter((rejection) => nowMs - rejection.atMs <= windowMs),
      };
    },
  };
}

/**
 * One pre-shot pose sample. The sampler keeps running after its first lock;
 * movement and recovery update the verdict this returns.
 * Does not record the publisher result. The caller notes that, then asks
 * preShotDialDisplayStatus again with this pose verdict.
 * @param {{
 *   sampler: { observe: (mismatch: boolean, nowMs: number) => { status: 'checking' | 'found' | 'not_found', locked: boolean } },
 *   readable: { snapshot: (nowMs: number) => { lastConfidentMs: number | null, confidentAt: number[], rejections: { atMs: number, reason: string }[] } },
 *   read?: { hub?: { x: number, y: number } | null, lost?: boolean } | null,
 *   calibration?: { hub?: { x: number, y: number } | null, radius?: number | null } | null,
 *   nowMs: number,
 * }} input
 */
export function samplePreShotDialPose({
  sampler,
  readable,
  read,
  calibration,
  nowMs,
}) {
  const mismatch = preShotDialMismatch({
    trackedHub: read?.lost ? null : read?.hub ?? null,
    calibratedHub: calibration?.hub,
    calibratedRadius: calibration?.radius,
    poseLost: Boolean(read?.lost),
  });
  const verdict = sampler.observe(mismatch, nowMs);
  const snap = readable.snapshot(nowMs);
  return {
    poseStatus: verdict.status,
    locked: verdict.locked,
    status: preShotDialDisplayStatus({
      poseStatus: verdict.status,
      nowMs,
      lastConfidentMs: snap.lastConfidentMs,
      confidentAt: snap.confidentAt,
      rejections: snap.rejections,
    }),
  };
}

/**
 * Green only when the existing pose lock is found AND the needle is readable.
 * Pose lock is unchanged. Unreadable (or pose-lost-dominated) stays advisory.
 * @param {{
 *   poseStatus?: 'checking' | 'found' | 'not_found' | null,
 *   nowMs?: number,
 *   lastConfidentMs?: number | null,
 *   confidentAt?: number[],
 *   rejections?: { atMs: number, reason: string }[],
 *   windowMs?: number,
 * }} input
 * @returns {'checking' | 'found' | 'not_found' | 'unreadable' | null}
 */
export function preShotDialDisplayStatus({
  poseStatus = null,
  nowMs = 0,
  lastConfidentMs = null,
  confidentAt = [],
  rejections = [],
  windowMs = PRE_SHOT_READABLE_WINDOW_MS,
} = {}) {
  if (poseStatus !== 'found') return poseStatus ?? null;
  const age = lastConfidentMs == null ? null : nowMs - lastConfidentMs;
  const readable = age != null && age >= 0 && age <= windowMs;
  const poseLostDominated = recentRejectionsPoseLostDominated(
    rejections,
    nowMs,
    windowMs,
    confidentAt,
  );
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
