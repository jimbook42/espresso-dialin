import { useEffect, useRef, useState } from 'react';

/** A display subscriber only: reuse the owner's stream, never acquire or stop it. */
export function useSharedCameraVideo({ sourceRef, targetRef, active, cameraStatus, onFrame }) {
  const [status, setStatus] = useState('unavailable');
  const onFrameRef = useRef(onFrame);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);

  useEffect(() => {
    if (!active) return undefined;
    const target = targetRef.current;
    if (!target) return undefined;
    const sync = () => {
      const source = sourceRef?.current;
      const stream = source?.srcObject ?? null;
      if (target.srcObject !== stream) {
        target.srcObject = stream;
        if (stream) {
          target.muted = true;
          target.playsInline = true;
          void target.play().catch(() => {});
        }
      }
      const nextStatus = stream ? 'live' : cameraStatus === 'requesting' ? 'loading' : 'unavailable';
      setStatus((previous) => previous === nextStatus ? previous : nextStatus);
      onFrameRef.current?.(source, target);
    };
    sync();
    let raf;
    let last = 0;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 50) return;
      last = now;
      sync();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      target.srcObject = null;
    };
  }, [sourceRef, targetRef, active, cameraStatus]);
  return status;
}
