import { useCallback, useEffect, useRef, useState } from 'react';
import { cameraErrorMessage } from '../cameraErrors.js';
import { isPressureReplayBuild } from '../../config/pressureReplayFlag.js';

async function openCamera(facingMode, deviceId, recovering) {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error('unsupported');
    error.name = 'UnsupportedError';
    throw error;
  }

  const video = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };

  if (isPressureReplayBuild()) {
    return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }

  if (deviceId) {
    return navigator.mediaDevices.getUserMedia({
      audio: false, video: { ...video, deviceId: { exact: deviceId } },
    });
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...video, facingMode: { exact: facingMode } },
    });
  } catch (err) {
    if (recovering || err?.name !== 'OverconstrainedError') throw err;
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...video, facingMode },
    });
  }
}

function releaseStream(streamRef, videoRef) {
  streamRef.current?.getTracks().forEach((track) => track.stop());
  streamRef.current = null;
  if (videoRef.current) videoRef.current.srcObject = null;
}

/** Session counters only. No frames, labels or device identifiers. */
export function createCameraTrackLog() {
  return {
    readyState: null,
    muted: null,
    events: { mute: 0, unmute: 0, ended: 0 },
  };
}

export function resetCameraTrackLog(log, track) {
  if (!log) return;
  log.events.mute = 0;
  log.events.unmute = 0;
  log.events.ended = 0;
  log.readyState = track?.readyState ?? null;
  log.muted = track?.muted ?? null;
}

/** Count mute / unmute / ended. Does not start, stop or replace the track. */
export function bindCameraTrackEvents(track, log) {
  if (!track?.addEventListener || !log) return () => {};
  const apply = (name) => () => {
    log.events[name] += 1;
    log.readyState = track.readyState ?? null;
    log.muted = track.muted ?? null;
  };
  const names = ['mute', 'unmute', 'ended'];
  const listeners = names.map((name) => {
    const listener = apply(name);
    track.addEventListener(name, listener);
    return [name, listener];
  });
  log.readyState = track.readyState ?? null;
  log.muted = track.muted ?? null;
  return () => {
    listeners.forEach(([name, listener]) => track.removeEventListener(name, listener));
  };
}

export function useFrontCameraStream({ facingMode = 'user' } = {}) {
  const requestedFacingMode = facingMode === 'environment' ? 'environment' : 'user';
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const pendingOpenRef = useRef(Promise.resolve());
  const trackDiagnosticsRef = useRef(createCameraTrackLog());
  const unbindTrackRef = useRef(() => {});
  const deviceIdRef = useRef(null);
  const recoveryUsedRef = useRef(false);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [trackInfo, setTrackInfo] = useState(null);

  const releaseCamera = useCallback(() => {
    unbindTrackRef.current();
    unbindTrackRef.current = () => {};
    releaseStream(streamRef, videoRef);
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    deviceIdRef.current = null;
    releaseCamera();
    setTrackInfo(null);
    setError('');
    setStatus('idle');
  }, [releaseCamera]);

  const open = useCallback(async function open(recovering = false) {
    const generation = ++generationRef.current;
    setError('');
    setStatus('requesting');
    setRevision((value) => value + 1);
    releaseCamera();
    const previous = pendingOpenRef.current;
    const opening = (async () => {
      // A superseded pending camera must resolve and release its tracks before
      // the next facingMode can acquire a stream.
      await previous;
      if (!mountedRef.current || generation !== generationRef.current) return;
      try {
        const stream = await openCamera(requestedFacingMode, deviceIdRef.current, recovering);
        if (!mountedRef.current || generation !== generationRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings?.() || {};
        if (!isPressureReplayBuild() && settings.facingMode && settings.facingMode !== requestedFacingMode) {
          stream.getTracks().forEach((item) => item.stop());
          const rear = new Error('rear');
          rear.name = 'UnexpectedCameraError';
          throw rear;
        }
        streamRef.current = stream;
        deviceIdRef.current = settings.deviceId ?? deviceIdRef.current;
        const video = videoRef.current;
        const unbindDiagnostics = bindCameraTrackEvents(track, trackDiagnosticsRef.current);
        const current = () => mountedRef.current && generation === generationRef.current;
        const syncAvailability = () => {
          if (!current()) return;
          setRevision((value) => value + 1);
          setStatus(document.hidden || track?.muted ? 'interrupted' : 'live');
        };
        const onEnded = () => {
          if (!current()) return;
          if (!document.hidden && !recoveryUsedRef.current && (deviceIdRef.current || isPressureReplayBuild())) {
            recoveryUsedRef.current = true;
            void open(true);
            return;
          }
          generationRef.current += 1;
          releaseCamera();
          setTrackInfo(null);
          setError('Camera disconnected. Tap Retry camera to reconnect.');
          setStatus('error');
        };
        const onVisibility = () => {
          if (!current()) return;
          if (track?.readyState === 'ended') {
            onEnded();
            return;
          }
          if (!document.hidden && video?.paused) {
            void video.play().then(syncAvailability).catch(() => {
              if (!current()) return;
              generationRef.current += 1;
              releaseCamera();
              setTrackInfo(null);
              setError('Camera playback was interrupted. Tap Retry camera to reconnect.');
              setStatus('error');
            });
          } else syncAvailability();
        };
        track?.addEventListener?.('ended', onEnded);
        track?.addEventListener?.('mute', syncAvailability);
        track?.addEventListener?.('unmute', syncAvailability);
        document.addEventListener('visibilitychange', onVisibility);
        unbindTrackRef.current = () => {
          unbindDiagnostics();
          track?.removeEventListener?.('ended', onEnded);
          track?.removeEventListener?.('mute', syncAvailability);
          track?.removeEventListener?.('unmute', syncAvailability);
          document.removeEventListener('visibilitychange', onVisibility);
        };
        if (video) {
          video.srcObject = stream;
          video.playsInline = true;
          video.muted = true;
          await video.play();
        }
        if (!mountedRef.current || generation !== generationRef.current) {
          releaseCamera();
          return;
        }
        setTrackInfo({
          label: track?.label || 'unknown',
          facingMode: settings.facingMode || 'unspecified',
          width: settings.width || video?.videoWidth,
          height: settings.height || video?.videoHeight,
        });
        if (!track || track.readyState === 'ended') onEnded();
        else syncAvailability();
      } catch (err) {
        if (!mountedRef.current || generation !== generationRef.current) return;
        releaseCamera();
        setTrackInfo(null);
        setError(cameraErrorMessage(err));
        setStatus('error');
      }
    })();
    pendingOpenRef.current = opening.catch(() => {});
    await opening;
  }, [requestedFacingMode, releaseCamera]);

  const start = useCallback(() => {
    recoveryUsedRef.current = false;
    return open();
  }, [open]);

  const retry = useCallback(() => {
    recoveryUsedRef.current = false;
    return open(true);
  }, [open]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      releaseCamera();
    };
  }, [releaseCamera]);

  return { videoRef, start, stop, retry, status, error, revision, trackInfo, trackDiagnosticsRef };
}
