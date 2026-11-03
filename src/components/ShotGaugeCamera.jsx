import { useRef } from 'react';
import { drawShotGaugeOverlay, shotGaugeObjectPosition } from './shotGaugeFrame.js';
import { useSharedCameraVideo } from './useSharedCameraVideo.js';

export function ShotGaugeCamera({ pressure, expanded, onToggle, barText, preview = false, active = true }) {
  const canvasRef = useRef(null);
  const previewVideoRef = useRef(null);
  const videoRef = pressure?.videoRef;
  const frameRef = pressure?.liveFrameRef;
  const feedStatus = useSharedCameraVideo({ sourceRef: videoRef, targetRef: previewVideoRef,
    active: !preview && active, cameraStatus: pressure?.cameraStatus,
    onFrame: (source, target) => {
      if (!source) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      const frame = frameRef?.current;
      if (context) drawShotGaugeOverlay(context, source, frame, Date.now());
      if (expanded) {
        const position = shotGaugeObjectPosition(frame, source.videoWidth, source.videoHeight, target.clientWidth, target.clientHeight);
        if (target.style.objectPosition !== position) target.style.objectPosition = position;
        if (canvas && canvas.style.objectPosition !== position) canvas.style.objectPosition = position;
      }
    } });
  const lookingForGauge = !pressure?.calibrated || pressure?.readerUncertain
    || pressure?.hold?.gap || pressure?.displayBar == null;

  return (
    <button type="button" onClick={onToggle} aria-label={expanded ? 'Hide gauge' : 'Show gauge'}
      data-testid="shot-gauge-camera"
      className={`shot-gauge-camera--${expanded ? 'expanded' : 'aim'} relative block w-full overflow-hidden rounded-xl border border-[#2e2b26] bg-black shrink-0`}>
      {preview ? (
        <div className="h-full flex items-center justify-center text-[#a09880] text-xs">Camera preview · example</div>
      ) : (
        <>
          <video ref={previewVideoRef} data-testid="shot-trust-video" autoPlay muted playsInline
            className={`absolute inset-0 w-full h-full ${expanded ? 'object-cover' : 'object-contain'}`} aria-label="Live gauge camera" />
          <canvas ref={canvasRef} className={`pointer-events-none absolute inset-0 w-full h-full ${expanded ? 'object-cover' : 'object-contain'}`} aria-label="Tracked needle overlay" />
        </>
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
