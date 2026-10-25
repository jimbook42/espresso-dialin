import { useCallback, useEffect, useRef } from 'react';
import { saveLastLabShotReplay } from '../labShotReplayDb.js';
import { SHOT_REPLAY_MAX_DURATION_S } from '../shotReplayRecorder.js';
import { createShotReplayRecorder } from '../shotReplayRecorder.js';
import { createShotReplaySampleLogger } from '../shotReplaySampleLogger.js';

/**
 * Records the last Lab pressure shot (MediaRecorder + throttled tracker samples).
 * Does not touch reader/gate/tracker — observes frames via replayFrameObserverRef.
 */
export function useLabShotReplay({
  enabled,
  timerRunning,
  videoRef,
  replayFrameObserverRef,
  shotReplayCommitRef,
  shotReplayDiscardRef,
  onReplayStored,
}) {
  const recorderRef = useRef(createShotReplayRecorder());
  const loggerRef = useRef(createShotReplaySampleLogger());
  const pendingRef = useRef(null);
  const recorderStartedRef = useRef(false);
  const wasTimerRunningRef = useRef(false);

  const discardPending = useCallback(() => {
    recorderRef.current.abort();
    loggerRef.current.reset();
    pendingRef.current = null;
    recorderStartedRef.current = false;
  }, []);

  const tryStartRecorder = useCallback(() => {
    if (!enabled || !timerRunning || recorderStartedRef.current) return;
    const video = videoRef.current;
    const stream = video?.srcObject;
    const w = video?.videoWidth || 0;
    const h = video?.videoHeight || 0;
    if (stream instanceof MediaStream && w > 0 && h > 0) {
      if (recorderRef.current.start(stream, w, h)) {
        recorderStartedRef.current = true;
      }
    }
  }, [enabled, timerRunning, videoRef]);

  const observeFrame = useCallback((frame) => {
    if (!enabled || !timerRunning) return;
    tryStartRecorder();
    loggerRef.current.push(frame);
  }, [enabled, timerRunning, tryStartRecorder]);

  useEffect(() => {
    replayFrameObserverRef.current = enabled ? observeFrame : null;
    return () => {
      replayFrameObserverRef.current = null;
    };
  }, [enabled, observeFrame, replayFrameObserverRef]);

  useEffect(() => {
    if (!enabled) {
      discardPending();
      wasTimerRunningRef.current = false;
      return;
    }
    if (timerRunning) {
      if (!wasTimerRunningRef.current) {
        loggerRef.current.begin(Date.now());
        pendingRef.current = null;
        recorderStartedRef.current = false;
        tryStartRecorder();
      }
      wasTimerRunningRef.current = true;
      return;
    }

    if (!wasTimerRunningRef.current) return;
    wasTimerRunningRef.current = false;

    let cancelled = false;
    void (async () => {
      const captured = await recorderRef.current.stop();
      recorderStartedRef.current = false;
      if (cancelled) return;
      const samples = loggerRef.current.getSamples();
      loggerRef.current.reset();
      if (!captured || !samples.length) {
        pendingRef.current = null;
        return;
      }
      pendingRef.current = {
        blob: captured.blob,
        mimeType: captured.mimeType,
        videoW: captured.videoW,
        videoH: captured.videoH,
        durationS: Math.min(captured.durationS, SHOT_REPLAY_MAX_DURATION_S),
        samples,
      };
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, timerRunning, discardPending, tryStartRecorder]);

  const commitToShot = useCallback(async (shotId) => {
    const pending = pendingRef.current;
    if (!pending || !shotId) return;
    try {
      await saveLastLabShotReplay({
        shotId,
        blob: pending.blob,
        mimeType: pending.mimeType,
        videoW: pending.videoW,
        videoH: pending.videoH,
        durationS: pending.durationS,
        samples: pending.samples,
      });
      pendingRef.current = null;
      onReplayStored?.();
    } catch {
      // silent
    }
  }, [onReplayStored]);

  useEffect(() => {
    shotReplayCommitRef.current = enabled ? commitToShot : null;
    return () => {
      shotReplayCommitRef.current = null;
    };
  }, [enabled, commitToShot, shotReplayCommitRef]);

  useEffect(() => {
    shotReplayDiscardRef.current = enabled ? discardPending : null;
    return () => {
      shotReplayDiscardRef.current = null;
    };
  }, [enabled, discardPending, shotReplayDiscardRef]);

  return { discardPending };
}
