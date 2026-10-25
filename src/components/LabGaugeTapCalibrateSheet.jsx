import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
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
  previewPointToVideo,
  videoPointToPreview,
} from '../flairPressureLab/geometry.js';
import { loadOpenCv } from '../flairPressureLab/opencvRuntime.js';
import {
  nextTapPhaseAfterConfirm,
  phaseAfterRedo,
  pointerToVideoPoint,
} from './labGaugeTapPlacement.js';

const PHASE_LABEL = {
  aim: 'Tap anywhere to freeze a rest frame',
  centre: 'Place marker on gauge centre (pivot), drag to fine-tune, then Confirm',
  five: 'Place marker on the printed 5, drag to fine-tune, then Confirm',
  ten: 'Place marker on the printed 10, drag to fine-tune, then Confirm',
  review: 'Check rays, then accept',
};

const LOUPE_SIZE = 112;
const LOUPE_ZOOM = 2.5;
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
  const frameNodeRef = useRef(null);
  const videoSizeRef = useRef(null);
  const frozenRef = useRef(null);
  const freezeCanvasRef = useRef(null);
  const loupeCanvasRef = useRef(null);
  const tapsRef = useRef({ centre: null, five: null, ten: null });
  const pendingCalRef = useRef(null);
  const qualityCanvasRef = useRef(null);
  const dragRef = useRef(false);
  const [opencvReady, setOpencvReady] = useState(false);

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
    const canvas = freezeCanvasRef.current;
    if (canvas) {
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0, img.width, img.height);
    }
    return grabSourceImage(img);
  }, [grabSourceImage]);

  const resetLocal = useCallback(() => {
    frozenRef.current = null;
    pendingCalRef.current = null;
    tapsRef.current = { centre: null, five: null, ten: null };
    setReviewPose(null);
    setPlacementPreview(null);
    setTapPhase('aim');
    setTapNote('');
    dragRef.current = false;
  }, []);

  const measureFrame = useCallback(() => {
    const node = frameNodeRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setFrameBox({ w: rect.width, h: rect.height });
  }, []);

  const fixtureHook = typeof window !== 'undefined' ? window.__labGaugeTapFixture : null;
  const fixtureSrc = fixtureHook?.src ?? null;
  const mirrorPreview = fixtureHook?.mirror !== false;

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
    if (hook?.autoFreeze) {
      void loadFixtureFrame().then((image) => {
        if (!image || cancelled) return;
        frozenRef.current = image;
        const canvas = freezeCanvasRef.current;
        if (canvas) {
          canvas.width = image.width;
          canvas.height = image.height;
          canvas.getContext('2d').putImageData(image, 0, 0);
        }
        videoSizeRef.current = { w: image.width, h: image.height };
        setTapPhase('centre');
        setTapNote('Frame held. Place the centre marker on the pivot.');
        measureFrame();
      });
    }
    return () => {
      cancelled = true;
      stop();
      resetLocal();
    };
  }, [open, fixtureSrc, loadFixtureFrame, measureFrame, resetLocal, start, stop]);

  useEffect(() => {
    if (!open) return undefined;
    const onScreenshotReview = () => {
      const mock = typeof window !== 'undefined' ? window.__labGaugeTapScreenshotJump : null;
      if (!mock) return;
      pendingCalRef.current = { ok: true, calibration: mock };
      setReviewPose(mock);
      setTapPhase('review');
      setTapNote('Fixture review (simulated camera frame).');
      setPlacementPreview(null);
    };
    window.addEventListener('lab-gauge-tap-screenshot-review', onScreenshotReview);
    return () => window.removeEventListener('lab-gauge-tap-screenshot-review', onScreenshotReview);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    measureFrame();
    const node = frameNodeRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measureFrame());
    ro.observe(node);
    return () => ro.disconnect();
  }, [open, measureFrame, tapPhase]);

  const updateLoupe = useCallback((previewX, previewY) => {
    const loupe = loupeCanvasRef.current;
    const frozen = freezeCanvasRef.current;
    const size = videoSizeRef.current;
    const node = frameNodeRef.current;
    if (!loupe || !frozen || !size?.w || !node) return;
    const rect = node.getBoundingClientRect();
    const mapped = previewPointToVideo(
      previewX,
      previewY,
      size.w,
      size.h,
      rect.width,
      rect.height,
      mirrorPreview,
    );
    if (!mapped) return;
    const vx = mapped.nx * size.w;
    const vy = mapped.ny * size.h;
    const srcR = Math.max(12, (LOUPE_SIZE / LOUPE_ZOOM) / 2);
    const ctx = loupe.getContext('2d');
    loupe.width = LOUPE_SIZE;
    loupe.height = LOUPE_SIZE;
    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(LOUPE_SIZE / 2, LOUPE_SIZE / 2, LOUPE_SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
      frozen,
      vx - srcR,
      vy - srcR,
      srcR * 2,
      srcR * 2,
      0,
      0,
      LOUPE_SIZE,
      LOUPE_SIZE,
    );
    ctx.strokeStyle = '#c88a4b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(LOUPE_SIZE / 2, 8);
    ctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE - 8);
    ctx.moveTo(8, LOUPE_SIZE / 2);
    ctx.lineTo(LOUPE_SIZE - 8, LOUPE_SIZE / 2);
    ctx.stroke();
    ctx.restore();
  }, []);

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
      return;
    }
    pendingCalRef.current = result;
    setReviewPose(result.calibration);
    setTapPhase('review');
    setPlacementPreview(null);
    const placed = result.userPlacedNote === USER_PLACED_NOTE
      ? `${USER_PLACED_NOTE}. `
      : '';
    setTapNote(`${placed}Rest needle is 0 bar. Accept if the rays look right.`);
  };

  const confirmPlacement = () => {
    if (!placementPreview || !['centre', 'five', 'ten'].includes(tapPhase)) return;
    const node = frameNodeRef.current;
    const size = videoSizeRef.current;
    if (!node || !size?.w) return;
    const rect = node.getBoundingClientRect();
    const point = pointerToVideoPoint(
      placementPreview.x + rect.left,
      placementPreview.y + rect.top,
      rect,
      size,
      mirrorPreview,
    );
    if (!point) return;
    tapsRef.current = { ...tapsRef.current, [tapPhase]: point };
    const next = nextTapPhaseAfterConfirm(tapPhase);
    setPlacementPreview(null);
    dragRef.current = false;
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
    setTapPhase(phase);
    setTapNote(`Redo: place the ${phase === 'centre' ? 'centre' : phase} marker again.`);
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
        if (!image) return;
        frozenRef.current = image;
        const canvas = freezeCanvasRef.current;
        if (canvas) {
          canvas.width = image.width;
          canvas.height = image.height;
          canvas.getContext('2d').putImageData(image, 0, 0);
        }
        videoSizeRef.current = { w: image.width, h: image.height };
        setTapPhase('centre');
        setTapNote('Frame held. Place the centre marker on the pivot.');
        measureFrame();
      });
      return;
    }
    if (!['centre', 'five', 'ten'].includes(tapPhase)) return;
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
          {tapNote && <p className={`text-[11px] ${text}`}>{tapNote}</p>}
          {error && !fixtureSrc && <p className="text-[11px] text-rose-400">{error}</p>}
          {!opencvReady && status === 'live' && (
            <p className={`text-[10px] ${muted}`}>Loading vision helpers…</p>
          )}
        </div>
        <div className="flex-1 min-h-0 flex flex-col px-3 pb-2">
          <div
            ref={frameNodeRef}
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
              className={`absolute inset-0 w-full h-full object-cover ${
                tapPhase !== 'aim' ? 'opacity-100' : 'opacity-0'
              }`}
              style={mirrorPreview ? { transform: 'scaleX(-1)' } : undefined}
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
                  className="absolute top-3 right-3 z-20 rounded-full border-2 border-[#c88a4b] shadow-lg pointer-events-none"
                  style={{ width: LOUPE_SIZE, height: LOUPE_SIZE }}
                />
              </>
            )}
          </div>
          {tapPhase === 'review' && reviewPose && (
            <p className={`text-[10px] ${muted} mt-1 shrink-0`}>
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
