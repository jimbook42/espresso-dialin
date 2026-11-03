import { useEffect, useRef } from 'react';
import { drawShotGaugeFrame, shotGaugeObjectPosition } from './shotGaugeFrame.js';

export function ShotGaugeCamera({ pressure, expanded, onToggle, barText, preview = false, active = true }) {
  const canvasRef = useRef(null);
  const videoRef = pressure?.videoRef;
  const frameRef = pressure?.liveFrameRef;
  useEffect(() => {
    if (preview || !active) return undefined;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return undefined;
    let raf;
    let last = 0;
    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 50) return;
      last = now;
      const video = videoRef?.current;
      if (video) {
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
      {expanded && <span data-testid="shot-camera-pressure" className="absolute bottom-3 left-3 rounded-xl bg-black/70 px-4 py-2 text-4xl font-bold text-[#c97868] tabular-nums">{barText} <span className="text-base">bar</span></span>}
    </button>
  );
}
