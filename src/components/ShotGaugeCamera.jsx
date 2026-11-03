import { useEffect, useRef } from 'react';
import { drawShotGaugeFrame } from './shotGaugeFrame.js';

export function ShotGaugeCamera({ pressure, expanded, onToggle, barText, preview = false }) {
  const canvasRef = useRef(null);
  const videoRef = pressure?.videoRef;
  const frameRef = pressure?.liveFrameRef;
  useEffect(() => {
    if (preview) return undefined;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return undefined;
    let raf;
    let last = 0;
    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 50) return;
      last = now;
      const video = videoRef?.current;
      if (video) drawShotGaugeFrame(context, video, frameRef?.current, Date.now());
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, frameRef, preview]);

  return (
    <button type="button" onClick={onToggle} aria-label={expanded ? 'Hide gauge' : 'Show gauge'}
      data-testid="shot-gauge-camera"
      className={`shot-gauge-camera--${expanded ? 'expanded' : 'aim'} relative block w-full overflow-hidden rounded-xl border border-[#2e2b26] bg-black shrink-0`}>
      {preview ? (
        <div className="h-full flex items-center justify-center text-[#a09880] text-xs">Camera preview · example</div>
      ) : (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain" aria-label="Live gauge camera with tracked needle" />
      )}
      {expanded && <span className="absolute top-2 left-2 rounded-lg bg-black/80 px-3 py-1 text-3xl font-bold text-[#c97868] tabular-nums">{barText} <span className="text-sm">bar</span></span>}
      <span className="absolute bottom-1 right-2 text-[10px] text-[#f5f2eb] bg-black/80 px-2 rounded">{expanded ? 'Tap to hide gauge' : 'Tap to show gauge'}</span>
    </button>
  );
}
