import { NEEDLE_LOST_QUALITY } from './gaugeConfig.js';

/** Observation only. No pixels, camera identifiers or pressure samples are retained. */
export const NO_PRESSURE_READING_MS = 3000;
export const NO_PRESSURE_READING_WARNING = 'No pressure reading for 3 s – check the gauge is visible';

let committedStall = null;

function emptyDiagnostics() {
  return {
    framesPresented: 0,
    framesRead: 0,
    framesConfident: 0,
    duplicateFrames: 0,
    rejectionReasons: { pose: 0, endpoint: 0, needleQuality: 0, publisher: 0, rate: 0 },
    publisherReasons: {},
    longestGapMs: 0,
    callbackAgeMs: null,
    lastReaderError: null,
    readerErrorCount: 0,
    inferenceRejections: 0,
    lastInferenceError: null,
    inferenceBusy: false,
    inferenceBusyMs: 0,
    inferenceHung: false,
    cameraReadyState: null,
    trackReadyState: null,
    trackMuted: null,
    trackEvents: { mute: 0, unmute: 0, ended: 0 },
    videoElementChanges: 0,
    callbackSupported: null,
    modelStatus: null,
  };
}

/**
 * Classify an existing calibrated read. Does not re-run pose, endpoint or quality maths.
 * @param {object | null | undefined} read
 */
export function readRejectionEvidence(read) {
  if (!read || read.duplicate || read.lost) {
    return { endpointResolved: true, needleQualityPassed: true };
  }
  const qualityOk = read.needleDeg != null && (read.needleQuality ?? 0) >= NEEDLE_LOST_QUALITY;
  if (!qualityOk) return { endpointResolved: true, needleQualityPassed: false };
  if (read.rawBar == null) return { endpointResolved: false, needleQualityPassed: true };
  return { endpointResolved: true, needleQualityPassed: true };
}

/**
 * In-memory stall counters for one shot session.
 * @param {number} startMs
 */
export function createReaderStallDiagnostics(startMs) {
  const data = emptyDiagnostics();
  let lastPublishedMs = startMs;
  let lastCallbackMs = null;
  let busySince = null;
  let video;
  let stopped = false;
  const gap = (now) => Math.max(0, now - lastPublishedMs);
  const updateGap = (now) => {
    data.longestGapMs = Math.max(data.longestGapMs, gap(now));
  };

  return {
    presented(now) {
      if (stopped) return;
      data.framesPresented += 1;
      lastCallbackMs = now;
    },
    read(read, evidence = {}) {
      if (stopped) return;
      data.framesRead += 1;
      if (read?.duplicate) {
        data.duplicateFrames += 1;
        return;
      }
      if (read?.lost) data.rejectionReasons.pose += 1;
      if (evidence.endpointResolved === false) data.rejectionReasons.endpoint += 1;
      if (evidence.needleQualityPassed === false) data.rejectionReasons.needleQuality += 1;
    },
    duplicate() {
      if (!stopped) data.duplicateFrames += 1;
    },
    noteGate(gated) {
      if (stopped || !gated || gated.fresh === true) return;
      const underlying = String(gated.reason ?? 'unspecified').replace(/^held:/, '');
      data.publisherReasons[underlying] = (data.publisherReasons[underlying] ?? 0) + 1;
      if (underlying === 'pose-lost' || underlying === 'needle-missing') return;
      data.rejectionReasons.publisher += 1;
      if (underlying.includes('rate')) data.rejectionReasons.rate += 1;
    },
    syncPublisher(counts) {
      if (stopped || !counts) return;
      data.rejectionReasons.publisher = counts.publisher ?? 0;
      data.rejectionReasons.rate = counts.rate ?? 0;
      data.publisherReasons = { ...(counts.byReason ?? {}) };
    },
    published(now) {
      if (stopped) return;
      updateGap(now);
      lastPublishedMs = now;
      data.framesConfident += 1;
    },
    error(error) {
      if (stopped) return;
      data.lastReaderError = error instanceof Error ? error.message : String(error?.message ?? error);
      data.readerErrorCount += 1;
    },
    inferenceRejected(error) {
      if (stopped) return;
      data.inferenceRejections += 1;
      data.lastInferenceError = error instanceof Error ? error.message : String(error?.message ?? error);
    },
    /**
     * @returns {boolean} true when recording has gone NO_PRESSURE_READING_MS without a published reading
     */
    observe(now, currentVideo, inferenceBusy, modelStatus, trackLog) {
      if (stopped) return false;
      if (video !== undefined && currentVideo !== video) data.videoElementChanges += 1;
      video = currentVideo;
      data.cameraReadyState = currentVideo?.readyState ?? null;
      data.callbackSupported = currentVideo == null
        ? null
        : typeof currentVideo.requestVideoFrameCallback === 'function';
      if (trackLog) {
        data.trackReadyState = trackLog.readyState ?? null;
        data.trackMuted = trackLog.muted ?? null;
        data.trackEvents = {
          mute: trackLog.events?.mute ?? 0,
          unmute: trackLog.events?.unmute ?? 0,
          ended: trackLog.events?.ended ?? 0,
        };
      }
      updateGap(now);
      data.callbackAgeMs = lastCallbackMs == null ? null : Math.max(0, now - lastCallbackMs);
      if (inferenceBusy && busySince == null) busySince = now;
      if (!inferenceBusy) busySince = null;
      data.inferenceBusy = Boolean(inferenceBusy);
      data.inferenceBusyMs = busySince == null ? 0 : Math.max(0, now - busySince);
      // A diagnostic timeout only. Inference is not cancelled and its result is unchanged.
      data.inferenceHung = Boolean(inferenceBusy) && data.inferenceBusyMs >= NO_PRESSURE_READING_MS;
      data.modelStatus = modelStatus ?? null;
      return gap(now) >= NO_PRESSURE_READING_MS;
    },
    snapshot() {
      return JSON.parse(JSON.stringify(data));
    },
    stop() {
      stopped = true;
    },
  };
}

/**
 * One observation of a reader loop turn. Display and export only.
 * @param {ReturnType<typeof createReaderStallDiagnostics> | null | undefined} diagnostics
 */
export function recordReaderSample(diagnostics, sample) {
  if (!diagnostics || !sample) return;
  if (sample.repeated) diagnostics.duplicate();
  if (sample.hadImage && sample.read) {
    diagnostics.read(sample.read, readRejectionEvidence(sample.read));
  }
  if (sample.gated) {
    if (sample.legacyScale) diagnostics.noteGate(sample.gated);
    else diagnostics.syncPublisher(sample.publisherCounts);
  }
  if (sample.publishedAtMs != null) diagnostics.published(sample.publishedAtMs);
}

/** Export-only. Not written to shot or replay databases. */
export function commitReaderStallDiagnostics(shotId, summary) {
  if (!shotId || !summary) {
    committedStall = null;
    return;
  }
  committedStall = JSON.parse(JSON.stringify({ shotId: String(shotId), ...summary }));
}

export function readerStallDiagnosticsForShot(shotId) {
  if (!committedStall || committedStall.shotId !== String(shotId)) return null;
  return JSON.parse(JSON.stringify(committedStall));
}

export function clearReaderStallDiagnostics() {
  committedStall = null;
}
