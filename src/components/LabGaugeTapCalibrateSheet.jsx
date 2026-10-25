import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { useFrontCameraStream } from '../flairPressureLab/hooks/useFrontCameraStream.js';
import {
  calibrateFromTaps,
  createCalibratedTracker,
  formatTapRejectReason,
  USER_PLACED_NOTE,
} from '../flairPressureLab/tapCalibrate.js';
import {
  objectCoverMap,
  previewAngleDeg,
  videoPointToPreview,
} from '../flairPressureLab/geometry.js';
import { loadOpenCv } from '../flairPressureLab/opencvRuntime.js';
import {
  nextTapPhaseAfterConfirm,
  phaseAfterRedo,
  pointerToVideoPoint,
} from './labGaugeTapPlacement.js';
import {
  initialDialCrop,
  paintFrozenCrop,
  paintLoupeFromSource,
  paintObjectCover,
  panCropToVideoPoint,
  previewPointToVideoCrop,
  videoPointToPreviewCrop,
  zoomCrop,
} from './labGaugeTapView.js';

const PHASE_LABEL = {
  aim: 'Tap anywhere to freeze a rest frame',
  centre: 'Place marker on gauge centre (pivot), drag to fine-tune, then Confirm',
  five: 'Place marker on the printed 5, drag to fine-tune, then Confirm',
  ten: 'Place marker on the printed 10, drag to fine-tune, then Confirm',
  review: 'Check rays, then accept',
};

const LOUPE_SIZE = 112;
const LOUPE_ZOOM = 3.2;
const MARKER_HIT = 44;

/**
 * Reuses the pressure-lab tap-calibrate flow in a modal sheet.
 */
export function LabGaugeTapCalibrateSheet({ open, onClose, onAccepted, ui, showCameraPreview = false }) {
  const { videoRef, start, stop, status, error } = useFrontCameraStream();
  const [tapPhase, setTapPhase] = useState('aim');
  const [tapNote, setTapNote] = useState('');
  const [reviewPose, setReviewPose] = useState(null);
  const [placementPreview, setPlacementPreview] = useState(null);
  const [frameBox, setFrameBox] = useState({ w: 0, h: 0 });
  const [dialCrop, setDialCrop] = useState(null);
  const frameNodeRef = useRef(null);
  const videoSizeRef = useRef(null);
  const frozenRef = useRef(null);
  const sourceCanvasRef = useRef(null);
  const freezeCanvasRef = useRef(null);
  const loupeCanvasRef = useRef(null);
  const tapsRef = useRef({ centre: null, five: null, ten: null });
  const pendingCalRef = useRef(null);
  const qualityCanvasRef = useRef(null);
  const dragRef = useRef(false);
  const autoFrozenRef = useRef(false);
  const holdFrozenRef = useRef(null);
  const [opencvReady, setOpencvReady] = useState(false);

  const fixtureHook = typeof window !== 'undefined' ? window.__labGaugeTapFixture : null;
  const fixtureSrc = fixtureHook?.src ?? null;
  const mirrorPreview = fixtureHook?.mirror !== false;

  const syncSourceCanvas = useCallback((image) => {
    if (!image) return null;
    const canvas = sourceCanvasRef.current || document.createElement('canvas');
    sourceCanvasRef.current = canvas;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d').putImageData(image, 0, 0);
    return canvas;
  }, []);

  const grabSourceImage = useCallback((source) => {
    const width = source.videoWidth || source.width;
    const height = source.videoHeight || source.height;
    if (!width || !height) return null;
    const canvas = qualityCanvasRef.current || document.createElement('canvas');
    qualityCanvasRef.current = canvas;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  }, []);

  const loadFixtureFrame = useCallback(async () => {
    const hook = typeof window !== 'undefined' ? window.__labGaugeTapFixture : null;
    if (!hook?.src) return null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = hook.src;
    });
    return grabSourceImage(img);
  }, [grabSourceImage]);

  const measureFrame = useCallback(() => {
    const node = frameNodeRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setFrameBox({ w: rect.width, h: rect.height });
  }, []);

  const publishViewState = useCallback((cropOverride = undefined, phaseOverride = undefined) => {
    if (typeof window === 'undefined') return;
    const crop = cropOverride === undefined ? dialCrop : cropOverride;
    const phase = phaseOverride === undefined ? tapPhase : phaseOverride;
    window.__labGaugeTapViewState = {
      crop,
      mirror: mirrorPreview,
      videoSize: videoSizeRef.current,
      frameBox,
      tapPhase: phase,
    };
  }, [dialCrop, frameBox, mirrorPreview, tapPhase]);

  const beginDialCrop = useCallback((image, focus) => {
    const hook = typeof window !== 'undefined' ? window.__labGaugeTapFixture : null;
    const fx = focus?.x ?? hook?.initialFocus?.x ?? image.width / 2;
    const fy = focus?.y ?? hook?.initialFocus?.y ?? image.height / 2;
    const r = hook?.initialFocus?.radius ?? 90;
    const halfOverride = hook?.initialHalf;
    const crop = initialDialCrop(image.width, image.height, fx, fy, r);
    if (halfOverride) crop.half = halfOverride;
    setDialCrop(crop);
    publishViewState(crop, 'centre');
  }, [publishViewState]);

  const repaintFrame = useCallback(() => {
    const display = freezeCanvasRef.current;
    const source = sourceCanvasRef.current;
    const size = videoSizeRef.current;
    const node = frameNodeRef.current;
    if (!display || !source || !size?.w || !node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const ctx = display.getContext('2d');
    display.width = Math.round(rect.width);
    display.height = Math.round(rect.height);
    if (tapPhase === 'review' || !dialCrop) {
      paintObjectCover(ctx, source, rect.width, rect.height, mirrorPreview);
    } else {
      paintFrozenCrop(ctx, source, rect.width, rect.height, dialCrop, mirrorPreview);
    }
  }, [dialCrop, mirrorPreview, tapPhase]);

  const resetLocal = useCallback(() => {
    frozenRef.current = null;
    pendingCalRef.current = null;
    tapsRef.current = { centre: null, five: null, ten: null };
    setReviewPose(null);
    setPlacementPreview(null);
    setDialCrop(null);
    setTapPhase('aim');
    setTapNote('');
    dragRef.current = false;
    autoFrozenRef.current = false;
  }, []);

  const holdFrozenImage = useCallback((image) => {
    frozenRef.current = image;
    syncSourceCanvas(image);
    videoSizeRef.current = { w: image.width, h: image.height };
    beginDialCrop(image);
    setTapPhase('centre');
    setTapNote('Frame held. Pinch-zoom or use +/−, then place the centre marker on the pivot.');
    measureFrame();
    requestAnimationFrame(() => repaintFrame());
  }, [beginDialCrop, measureFrame, repaintFrame, syncSourceCanvas]);

  holdFrozenRef.current = holdFrozenImage;

  useEffect(() => {
    if (!open) {
      stop();
      resetLocal();
      return undefined;
    }
    let cancelled = false;
    loadOpenCv()
      .then(() => {
        if (!cancelled) setOpencvReady(true);
      })
      .catch(() => {});
    if (!fixtureSrc) void start();
    const hook = typeof window !== 'undefined' ? window.__labGaugeTapFixture : null;
    if (hook?.autoFreeze && !autoFrozenRef.current) {
      autoFrozenRef.current = true;
      void loadFixtureFrame().then((image) => {
        if (!image || cancelled) return;
        holdFrozenRef.current?.(image);
      });
    }
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, fixtureSrc, loadFixtureFrame, start, stop, resetLocal]);

  useEffect(() => {
    if (!open) return undefined;
    measureFrame();
    const node = frameNodeRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      measureFrame();
      repaintFrame();
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [open, measureFrame, repaintFrame, tapPhase, dialCrop]);

  useEffect(() => {
    repaintFrame();
  }, [repaintFrame, dialCrop, tapPhase, frameBox.w]);

  useEffect(() => {
    if (!open) return;
    publishViewState();
  }, [open, publishViewState]);

  const updateLoupe = useCallback((previewX, previewY) => {
    const loupe = loupeCanvasRef.current;
    const source = sourceCanvasRef.current;
    const node = frameNodeRef.current;
    if (!loupe || !source || !node || !dialCrop) return;
    const rect = node.getBoundingClientRect();
    const videoPt = previewPointToVideoCrop(
      previewX,
      previewY,
      rect.width,
      rect.height,
      dialCrop,
      mirrorPreview,
    );
    if (!videoPt) return;
    paintLoupeFromSource(
      loupe.getContext('2d'),
      source,
      videoPt.x,
      videoPt.y,
      LOUPE_SIZE,
      LOUPE_ZOOM,
    );
  }, [dialCrop, mirrorPreview]);

  const pointerToPreview = (event) => {
    const node = frameNodeRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      rect,
    };
  };

  const runTapCalibration = () => {
    const image = frozenRef.current;
    const taps = tapsRef.current;
    if (!image || !taps.centre || !taps.five || !taps.ten) return;
    const result = calibrateFromTaps(image, taps);
    if (!result.ok) {
      const again = result.redo || 'centre';
      tapsRef.current = { ...tapsRef.current, [again]: null };
      setPlacementPreview(null);
      setTapPhase(again);
      setTapNote(formatTapRejectReason(result));
      if (taps.centre) {
        beginDialCrop(image, taps.centre);
      }
      return;
    }
    pendingCalRef.current = result;
    setReviewPose(result.calibration);
    setTapPhase('review');
    setPlacementPreview(null);
    setDialCrop(null);
    const placed = result.userPlacedNote === USER_PLACED_NOTE
      ? `${USER_PLACED_NOTE}. `
      : '';
    setTapNote(`${placed}Rest needle is 0 bar. Accept if the rays look right.`);
    requestAnimationFrame(() => repaintFrame());
  };

  const confirmPlacement = () => {
    if (!placementPreview || !['centre', 'five', 'ten'].includes(tapPhase)) return;
    const node = frameNodeRef.current;
    const size = videoSizeRef.current;
    if (!node || !size?.w || !dialCrop) return;
    const rect = node.getBoundingClientRect();
    const point = pointerToVideoPoint(
      placementPreview.x + rect.left,
      placementPreview.y + rect.top,
      rect,
      size,
      mirrorPreview,
      dialCrop,
    );
    if (!point) return;
    tapsRef.current = { ...tapsRef.current, [tapPhase]: point };
    const next = nextTapPhaseAfterConfirm(tapPhase);
    setPlacementPreview(null);
    dragRef.current = false;
    const image = frozenRef.current;
    if (image) {
      const nextCrop = panCropToVideoPoint(dialCrop, point.x, point.y, image.width, image.height);
      setDialCrop(nextCrop);
      publishViewState(nextCrop);
    }
    if (next === 'runCalibration') {
      runTapCalibration();
      return;
    }
    setTapPhase(next);
    setTapNote(
      next === 'five'
        ? 'Place the marker on the printed 5.'
        : 'Place the marker on the printed 10.',
    );
  };

  const redoLastTap = () => {
    const phase = phaseAfterRedo(tapPhase, tapsRef.current);
    tapsRef.current = { ...tapsRef.current, [phase]: null };
    if (phase === 'ten') tapsRef.current.ten = null;
    if (phase === 'five') {
      tapsRef.current.five = null;
      tapsRef.current.ten = null;
    }
    if (phase === 'centre') {
      tapsRef.current = { centre: null, five: null, ten: null };
    }
    pendingCalRef.current = null;
    setReviewPose(null);
    setPlacementPreview(null);
    const image = frozenRef.current;
    if (image) beginDialCrop(image, tapsRef.current.centre);
    setTapPhase(phase);
    setTapNote(`Redo: place the ${phase === 'centre' ? 'centre' : phase} marker again.`);
  };

  const adjustZoom = (factor) => {
    const size = videoSizeRef.current;
    if (!size?.w || !dialCrop) return;
    const next = zoomCrop(dialCrop, factor, size.w, size.h);
    setDialCrop(next);
    publishViewState(next);
  };

  const onPreviewPointerDown = (event) => {
    if (tapPhase === 'review') return;
    event.preventDefault();
    const video = videoRef.current;
    if (tapPhase === 'aim') {
      const hook = typeof window !== 'undefined' ? window.__labGaugeTapFixture : null;
      const imagePromise = hook?.src
        ? loadFixtureFrame()
        : Promise.resolve(video && video.readyState >= 2 ? grabSourceImage(video) : null);
      void imagePromise.then((image) => {
        if (image) holdFrozenImage(image);
      });
      return;
    }
    if (!['centre', 'five', 'ten'].includes(tapPhase) || !dialCrop) return;
    const pt = pointerToPreview(event);
    if (!pt) return;
    dragRef.current = true;
    setPlacementPreview({ x: pt.x, y: pt.y });
    updateLoupe(pt.x, pt.y);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const onPreviewPointerMove = (event) => {
    if (!dragRef.current || !placementPreview) return;
    event.preventDefault();
    const pt = pointerToPreview(event);
    if (!pt) return;
    setPlacementPreview({ x: pt.x, y: pt.y });
    updateLoupe(pt.x, pt.y);
  };

  const onPreviewPointerUp = (event) => {
    if (!dragRef.current) return;
    event.preventDefault();
    dragRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const accept = () => {
    const pending = pendingCalRef.current;
    if (!pending?.ok) return;
    const tracker = createCalibratedTracker(pending.calibration);
    onAccepted?.({ calibration: pending.calibration, tracker });
    onClose?.();
  };

  if (!open) return null;

  const card = ui?.card ?? 'bg-[#1a1714]';
  const text = ui?.text ?? 'text-[#ede9e3]';
  const muted = ui?.muted ?? 'text-[#6b6457]';
  const videoSize = videoSizeRef.current;
  const placing = ['centre', 'five', 'ten'].includes(tapPhase);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/80 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className={`${card} rounded-2xl flex flex-col max-w-lg mx-auto w-full h-full max-h-full overflow-hidden border border-[#2a2826]`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2826] shrink-0">
          <p className={`text-sm font-bold ${text}`}>Gauge setup (3 taps)</p>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 rounded-full flex items-center justify-center border border-[#3a3836]"
            aria-label="Close gauge setup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-3 pt-2 space-y-1 shrink-0">
          <p className={`text-xs ${muted}`}>{PHASE_LABEL[tapPhase] || 'Calibrating'}</p>
          {tapNote && <p className={`text-[11px] ${text}`} data-testid="gauge-tap-note">{tapNote}</p>}
          {error && !fixtureSrc && <p className="text-[11px] text-rose-400">{error}</p>}
          {!opencvReady && status === 'live' && (
            <p className={`text-[10px] ${muted}`}>Loading vision helpers…</p>
          )}
        </div>
        <div className="flex-1 min-h-0 flex flex-col px-3 pb-2">
          {placing && (
            <div className="flex justify-end gap-2 py-1 shrink-0">
              <button
                type="button"
                aria-label="Zoom in on dial"
                data-testid="gauge-zoom-in"
                onClick={() => adjustZoom(0.82)}
                className="min-w-[44px] min-h-[44px] rounded-xl border border-[#3a3836] flex items-center justify-center"
              >
                <ZoomIn className="w-5 h-5" />
              </button>
              <button
                type="button"
                aria-label="Zoom out on dial"
                data-testid="gauge-zoom-out"
                onClick={() => adjustZoom(1.18)}
                className="min-w-[44px] min-h-[44px] rounded-xl border border-[#3a3836] flex items-center justify-center"
              >
                <ZoomOut className="w-5 h-5" />
              </button>
            </div>
          )}
          <div
            ref={frameNodeRef}
            data-testid="gauge-tap-viewport"
            className="relative flex-1 min-h-[200px] w-full bg-black rounded-xl overflow-hidden touch-none select-none"
            style={{ touchAction: 'none' }}
            onPointerDown={onPreviewPointerDown}
            onPointerMove={onPreviewPointerMove}
            onPointerUp={onPreviewPointerUp}
            onPointerCancel={onPreviewPointerUp}
          >
            <video
              ref={videoRef}
              className={`absolute inset-0 w-full h-full object-cover ${
                tapPhase === 'aim' ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
              style={mirrorPreview ? { transform: 'scaleX(-1)' } : undefined}
              playsInline
              muted
            />
            <canvas
              ref={freezeCanvasRef}
              className={`absolute inset-0 w-full h-full ${
                tapPhase !== 'aim' ? 'opacity-100' : 'opacity-0'
              }`}
            />
            {tapPhase === 'review' && reviewPose && videoSize && frameBox.w ? (
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                {(() => {
                  const hub = videoPointToPreview(
                    reviewPose.hub.x,
                    reviewPose.hub.y,
                    videoSize.w,
                    videoSize.h,
                    frameBox.w,
                    frameBox.h,
                    mirrorPreview,
                  );
                  const map = objectCoverMap(videoSize.w, videoSize.h, frameBox.w, frameBox.h);
                  if (!hub || !map) return null;
                  const ray = (deg, length, color) => {
                    const rad = ((previewAngleDeg(deg, mirrorPreview) ?? 0) * Math.PI) / 180;
                    const span = length * map.scale;
                    return (
                      <line
                        x1={hub.x}
                        y1={hub.y}
                        x2={hub.x + span * Math.cos(rad)}
                        y2={hub.y + span * Math.sin(rad)}
                        stroke={color}
                        strokeWidth="2"
                      />
                    );
                  };
                  return (
                    <>
                      {ray(reviewPose.zeroAngleDeg, reviewPose.radius * 0.9, '#7ee7ff')}
                      {ray(reviewPose.tenAngleDeg, reviewPose.radius * 0.9, '#ffd24a')}
                      {ray(reviewPose.fiveAngleDeg, reviewPose.radius * 0.72, '#ffffff')}
                      <circle cx={hub.x} cy={hub.y} r="5" fill="none" stroke="#ff6b6b" strokeWidth="2" />
                    </>
                  );
                })()}
              </svg>
            ) : null}
            {placementPreview && placing && (
              <>
                <div
                  className="absolute pointer-events-none z-10"
                  style={{
                    left: placementPreview.x - MARKER_HIT / 2,
                    top: placementPreview.y - MARKER_HIT / 2,
                    width: MARKER_HIT,
                    height: MARKER_HIT,
                  }}
                >
                  <div className="absolute inset-0 border-2 border-[#c88a4b] rounded-full bg-[#c88a4b]/20" />
                  <div className="absolute left-1/2 top-1/2 w-2 h-2 -ml-1 -mt-1 bg-[#c88a4b] rounded-full" />
                </div>
                <canvas
                  ref={loupeCanvasRef}
                  data-testid="gauge-tap-loupe"
                  className="absolute top-3 right-3 z-20 rounded-full border-2 border-[#c88a4b] shadow-lg pointer-events-none"
                  style={{ width: LOUPE_SIZE, height: LOUPE_SIZE }}
                />
              </>
            )}
          </div>
          {tapPhase === 'review' && reviewPose && (
            <p className={`text-[10px] ${muted} mt-1 shrink-0`} data-testid="gauge-review-meta">
              Hub at ({Math.round(reviewPose.hub.x)}, {Math.round(reviewPose.hub.y)}), radius{' '}
              {Math.round(reviewPose.radius)}px
            </p>
          )}
        </div>
        <div className="p-3 border-t border-[#2a2826] flex flex-wrap gap-2 shrink-0">
          {placing && (
            <>
              <button
                type="button"
                onClick={confirmPlacement}
                disabled={!placementPreview}
                className="flex-1 min-h-[48px] min-w-[44px] rounded-xl bg-[#c88a4b] text-[#121110] font-bold text-sm disabled:opacity-40"
              >
                Confirm tap
              </button>
              <button
                type="button"
                onClick={redoLastTap}
                className="min-h-[48px] min-w-[44px] px-4 rounded-xl border border-[#3a3836] font-semibold text-sm"
              >
                Redo
              </button>
              <button
                type="button"
                onClick={resetLocal}
                className="min-h-[48px] min-w-[44px] px-4 rounded-xl border border-[#3a3836] font-semibold text-sm"
              >
                Reset
              </button>
            </>
          )}
          {tapPhase === 'review' ? (
            <>
              <button
                type="button"
                onClick={accept}
                className="flex-1 min-h-[48px] rounded-xl bg-[#c88a4b] text-[#121110] font-bold text-sm"
              >
                Accept calibration
              </button>
              <button
                type="button"
                onClick={redoLastTap}
                className="min-h-[48px] px-4 rounded-xl border border-[#3a3836] font-semibold text-sm"
              >
                Retry
              </button>
            </>
          ) : null}
          {tapPhase === 'aim' ? (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[48px] rounded-xl border border-[#3a3836] font-semibold text-sm"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
