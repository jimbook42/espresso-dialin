import { useCallback, useEffect, useRef } from 'react';
import { saveLastLabShotReplay } from '../labShotReplayDb.js';
import { SHOT_REPLAY_MAX_DURATION_S } from '../shotReplayRecorder.js';
import { createShotReplayRecorder } from '../shotReplayRecorder.js';
import { createShotReplaySampleLogger } from '../shotReplaySampleLogger.js';
import { createLabReplayDiagnostics, commitReplayDiagnostics } from '../labReplayDiagnostics.js';
import { commitReaderStallDiagnostics } from '../readerStallDiagnostics.js';

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
  readerStallSnapshotRef,
}) {
  const recorderRef = useRef(createShotReplayRecorder());
  const loggerRef = useRef(createShotReplaySampleLogger());
  const diagnosticsRef = useRef(createLabReplayDiagnostics());
  const pendingRef = useRef(null);
  const claimedRef = useRef(new WeakSet());
  const recorderStartedRef = useRef(false);
  const wasTimerRunningRef = useRef(false);

  const discardPending = useCallback(() => {
    recorderRef.current.abort();
    loggerRef.current.reset();
    diagnosticsRef.current.reset();
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
    diagnosticsRef.current.push(frame);
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
        recorderRef.current = createShotReplayRecorder();
        loggerRef.current.begin(Date.now());
        diagnosticsRef.current.reset();
        pendingRef.current = null;
        recorderStartedRef.current = false;
        tryStartRecorder();
      }
      wasTimerRunningRef.current = true;
      return;
    }

    if (!wasTimerRunningRef.current) return;
    wasTimerRunningRef.current = false;

    const samples = loggerRef.current.getSamples();
    const diagnostics = diagnosticsRef.current.snapshot();
    const readerStall = readerStallSnapshotRef?.current ?? null;
    loggerRef.current.reset();
    const captured = recorderRef.current.stop();
    recorderStartedRef.current = false;
    pendingRef.current = captured.then((video) => ({ video, samples, diagnostics, readerStall }));
  }, [enabled, timerRunning, discardPending, tryStartRecorder, readerStallSnapshotRef]);

  const commitToShot = useCallback(async (shotId, finalising = pendingRef.current) => {
    if (!finalising || !shotId || claimedRef.current.has(finalising)) return;
    // Claim this capture before awaiting MediaRecorder so a duplicate save cannot attach it again.
    claimedRef.current.add(finalising);
    if (pendingRef.current === finalising) pendingRef.current = null;
    try {
      const { video, samples, diagnostics, readerStall } = await finalising;
      if (readerStall) commitReaderStallDiagnostics(shotId, readerStall);
      if (diagnostics.frames.length) commitReplayDiagnostics(shotId, diagnostics);
      if (video && samples.length) {
        await saveLastLabShotReplay({
          shotId,
          blob: video.blob,
          mimeType: video.mimeType,
          videoW: video.videoW,
          videoH: video.videoH,
          durationS: Math.min(video.durationS, SHOT_REPLAY_MAX_DURATION_S),
          samples,
        });
        onReplayStored?.();
      }
    } catch {
      // The saved pressure curve remains available if the video cannot be stored.
    }
  }, [onReplayStored]);

  useEffect(() => {
    const commitCurrent = (shotId) => commitToShot(shotId);
    commitCurrent.capture = () => {
      const finalising = pendingRef.current;
      return finalising ? (shotId) => commitToShot(shotId, finalising) : null;
    };
    shotReplayCommitRef.current = enabled ? commitCurrent : null;
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
