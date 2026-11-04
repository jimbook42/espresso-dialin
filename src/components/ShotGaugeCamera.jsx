import { useRef } from 'react';
import { drawShotGaugeOverlay, shotGaugeObjectPosition } from './shotGaugeFrame.js';
import { useSharedCameraVideo } from './useSharedCameraVideo.js';

export function ShotGaugeCamera({ pressure, expanded, onToggle, barText, preview = false, active = true, edgeMetrics }) {
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
  const noReadingWarning = pressure?.noPressureReadingWarning || '';

  return (
    <button type="button" onClick={onToggle} aria-label={expanded ? 'Hide gauge camera' : 'Show gauge camera'}
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
      {expanded && <div className="shot-camera-top-scrim">
        <span data-testid="shot-camera-pressure" className="shot-camera-pressure-hero">{barText} <small>bar</small></span>
        <span className={`shot-camera-lock-slot${noReadingWarning ? ' shot-camera-lock-slot--warning' : ''}`}>
          {!preview && noReadingWarning
            ? <span role="status" data-testid="no-pressure-reading-warning">{noReadingWarning}</span>
            : !preview && feedStatus === 'live' && lookingForGauge
              ? <span role="status" data-testid="shot-camera-status">Looking for gauge…</span> : '\u00a0'}
        </span>
      </div>}
      {expanded && <div className="shot-camera-bottom-scrim">
        <div className="shot-camera-edge-metrics">{edgeMetrics}</div>
        <div data-testid="shot-camera-aim" className="shot-camera-aim" style={{ visibility: pressure?.aimText ? 'visible' : 'hidden' }}>
          {pressure?.aimText || '\u00a0'}
        </div>
      </div>}
    </button>
  );
}
