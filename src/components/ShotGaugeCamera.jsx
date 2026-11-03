import { useEffect, useRef, useState } from 'react';
import { drawShotGaugeFrame, shotGaugeObjectPosition } from './shotGaugeFrame.js';

export function ShotGaugeCamera({ pressure, expanded, onToggle, barText, preview = false, active = true }) {
  const canvasRef = useRef(null);
  const videoRef = pressure?.videoRef;
  const frameRef = pressure?.liveFrameRef;
  const [feedStatus, setFeedStatus] = useState('unavailable');
  const lookingForGauge = !pressure?.calibrated || pressure?.readerUncertain
    || pressure?.hold?.gap || pressure?.displayBar == null;
  useEffect(() => {
    if (preview || !active) return undefined;
    const context = canvasRef.current?.getContext('2d');
    let raf;
    let last = 0;
    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 50) return;
      last = now;
      const video = videoRef?.current;
      const ready = context && video?.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
      const status = ready ? 'live' : video?.srcObject ? 'loading' : 'unavailable';
      setFeedStatus((previous) => previous === status ? previous : status);
      if (ready) {
        const frame = frameRef?.current;
        drawShotGaugeFrame(context, video, frame, Date.now());
        if (expanded) {
          const canvas = canvasRef.current;
          const position = shotGaugeObjectPosition(frame, video.videoWidth, video.videoHeight, canvas.clientWidth, canvas.clientHeight);
          if (canvas.style.objectPosition !== position) canvas.style.objectPosition = position;
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, frameRef, preview, active, expanded]);

  return (
    <button type="button" onClick={onToggle} aria-label={expanded ? 'Hide gauge' : 'Show gauge'}
      data-testid="shot-gauge-camera"
      className={`shot-gauge-camera--${expanded ? 'expanded' : 'aim'} relative block w-full overflow-hidden rounded-xl border border-[#2e2b26] bg-black shrink-0`}>
      {preview ? (
        <div className="h-full flex items-center justify-center text-[#a09880] text-xs">Camera preview · example</div>
      ) : (
        <canvas ref={canvasRef} className={`absolute inset-0 w-full h-full ${expanded ? 'object-cover' : 'object-contain'}`} aria-label="Live gauge camera with tracked needle" />
      )}
      {!preview && feedStatus !== 'live' && <span role="status" data-testid="shot-camera-status"
        className="absolute inset-0 flex items-center justify-center bg-black text-sm text-[#a09880]">
        {feedStatus === 'loading' ? 'Starting camera…' : 'Camera unavailable'}
      </span>}
      {!preview && feedStatus === 'live' && lookingForGauge && <span role="status" data-testid="shot-camera-status"
        className="absolute top-3 left-3 rounded-lg bg-black/70 px-2 py-1 text-xs text-[#f5f2eb]">Looking for gauge…</span>}
      {expanded && <span data-testid="shot-camera-pressure" className="absolute bottom-3 left-3 rounded-xl bg-black/70 px-4 py-2 text-4xl font-bold text-[#c97868] tabular-nums">{barText} <span className="text-base">bar</span></span>}
    </button>
  );
}
