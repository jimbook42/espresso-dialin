import { useCallback, useEffect, useRef, useState } from 'react';
import { cameraErrorMessage } from '../cameraErrors.js';
import { isPressureReplayBuild } from '../../config/pressureReplayFlag.js';

async function openFrontCamera() {
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

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...video, facingMode: { exact: 'user' } },
    });
  } catch (err) {
    if (err?.name !== 'OverconstrainedError') throw err;
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...video, facingMode: 'user' },
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

export function useFrontCameraStream() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(true);
  const trackDiagnosticsRef = useRef(createCameraTrackLog());
  const unbindTrackRef = useRef(() => {});
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [trackInfo, setTrackInfo] = useState(null);

  const releaseCamera = useCallback(() => {
    unbindTrackRef.current();
    unbindTrackRef.current = () => {};
    releaseStream(streamRef, videoRef);
  }, []);

  const stop = useCallback(() => {
    releaseCamera();
    setTrackInfo(null);
    setError('');
    setStatus('idle');
  }, [releaseCamera]);

  const start = useCallback(async () => {
    setError('');
    setStatus('requesting');
    releaseCamera();
    try {
      const stream = await openFrontCamera();
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() || {};
      if (!isPressureReplayBuild() && settings.facingMode === 'environment') {
        stream.getTracks().forEach((item) => item.stop());
        const rear = new Error('rear');
        rear.name = 'RearCameraError';
        throw rear;
      }
      streamRef.current = stream;
      unbindTrackRef.current = bindCameraTrackEvents(track, trackDiagnosticsRef.current);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play();
      }
      if (!mountedRef.current) {
        releaseCamera();
        return;
      }
      setTrackInfo({
        label: track?.label || 'unknown',
        facingMode: settings.facingMode || 'unspecified',
        width: settings.width || video?.videoWidth,
        height: settings.height || video?.videoHeight,
      });
      setStatus('live');
    } catch (err) {
      releaseCamera();
      if (!mountedRef.current) return;
      setTrackInfo(null);
      setError(cameraErrorMessage(err));
      setStatus('error');
    }
  }, [releaseCamera]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseCamera();
    };
  }, [releaseCamera]);

  return { videoRef, start, stop, status, error, trackInfo, trackDiagnosticsRef };
}
