import { useCallback, useEffect, useRef, useState } from 'react';
import { cameraErrorMessage } from '../cameraErrors.js';

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

export function useFrontCameraStream() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(true);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [trackInfo, setTrackInfo] = useState(null);

  const stop = useCallback(() => {
    releaseStream(streamRef, videoRef);
    setTrackInfo(null);
    setError('');
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    setError('');
    setStatus('requesting');
    releaseStream(streamRef, videoRef);
    try {
      const stream = await openFrontCamera();
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() || {};
      if (settings.facingMode === 'environment') {
        stream.getTracks().forEach((item) => item.stop());
        const rear = new Error('rear');
        rear.name = 'RearCameraError';
        throw rear;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play();
      }
      if (!mountedRef.current) {
        releaseStream(streamRef, videoRef);
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
      releaseStream(streamRef, videoRef);
      if (!mountedRef.current) return;
      setTrackInfo(null);
      setError(cameraErrorMessage(err));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseStream(streamRef, videoRef);
    };
  }, []);

  return { videoRef, start, stop, status, error, trackInfo };
}
