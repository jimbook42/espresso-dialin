import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useFrontCameraStream } from '../flairPressureLab/hooks/useFrontCameraStream.js';
import {
  calibrateFromTaps,
  createCalibratedTracker,
} from '../flairPressureLab/tapCalibrate.js';
import { previewPointToVideo } from '../flairPressureLab/geometry.js';
import { loadOpenCv } from '../flairPressureLab/opencvRuntime.js';

const PHASE_LABEL = {
  aim: 'Tap anywhere to freeze a rest frame',
  centre: 'Tap the gauge centre (pivot)',
  five: 'Tap the printed 5',
  ten: 'Tap the printed 10',
  review: 'Check rays, then accept',
};

/**
 * Reuses the pressure-lab tap-calibrate flow in a modal sheet.
 */
export function LabGaugeTapCalibrateSheet({ open, onClose, onAccepted, ui }) {
  const { videoRef, start, stop, status, error } = useFrontCameraStream();
  const [tapPhase, setTapPhase] = useState('aim');
  const [tapNote, setTapNote] = useState('');
  const [reviewPose, setReviewPose] = useState(null);
  const frameNodeRef = useRef(null);
  const videoSizeRef = useRef(null);
  const frozenRef = useRef(null);
  const freezeCanvasRef = useRef(null);
  const tapsRef = useRef({ centre: null, five: null, ten: null });
  const pendingCalRef = useRef(null);
  const qualityCanvasRef = useRef(null);
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

  const resetLocal = useCallback(() => {
    frozenRef.current = null;
    pendingCalRef.current = null;
    tapsRef.current = { centre: null, five: null, ten: null };
    setReviewPose(null);
    setTapPhase('aim');
    setTapNote('');
  }, []);

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
    void start();
    return () => {
      cancelled = true;
      stop();
      resetLocal();
    };
  }, [open, resetLocal, start, stop]);

  const pointFromEvent = (event) => {
    const node = frameNodeRef.current;
    const size = videoSizeRef.current;
    if (!node || !size?.w) return null;
    const rect = node.getBoundingClientRect();
    const mapped = previewPointToVideo(
      event.clientX - rect.left,
      event.clientY - rect.top,
      size.w,
      size.h,
      rect.width,
      rect.height,
      true,
    );
    if (!mapped) return null;
    return { x: mapped.nx * size.w, y: mapped.ny * size.h };
  };

  const runTapCalibration = () => {
    const image = frozenRef.current;
    const taps = tapsRef.current;
    if (!image || !taps.centre || !taps.five || !taps.ten) return;
    const result = calibrateFromTaps(image, taps);
    if (!result.ok) {
      const again = result.redo || 'centre';
      tapsRef.current = { ...tapsRef.current, [again]: null };
      setTapPhase(again);
      setTapNote(
        again === 'centre'
          ? 'Centre tap missed the pivot — try again.'
          : `Tap on the printed ${again === 'five' ? '5' : '10'} missed — try again.`,
      );
      return;
    }
    pendingCalRef.current = result;
    setReviewPose(result.calibration);
    setTapPhase('review');
    setTapNote('Rest needle is 0 bar. Accept if the rays look right.');
  };

  const onPreviewPointer = (event) => {
    if (tapPhase === 'review') return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    if (tapPhase === 'aim') {
      const image = grabSourceImage(video);
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
      setTapNote('Frame held. Tap the gauge centre.');
      return;
    }
    const point = pointFromEvent(event);
    if (!point) return;
    tapsRef.current = { ...tapsRef.current, [tapPhase]: point };
    if (tapPhase === 'centre') {
      setTapPhase('five');
      setTapNote('Tap the printed 5.');
      return;
    }
    if (tapPhase === 'five') {
      setTapPhase('ten');
      setTapNote('Tap the printed 10.');
      return;
    }
    if (tapPhase === 'ten') runTapCalibration();
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

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/80 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className={`${card} rounded-2xl flex flex-col max-w-lg mx-auto w-full max-h-full overflow-hidden border border-[#2a2826]`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2826]">
          <p className={`text-sm font-bold ${text}`}>Gauge setup (3 taps)</p>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center border border-[#3a3836]"
            aria-label="Close gauge setup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 space-y-2 flex-1 min-h-0 overflow-y-auto">
          <p className={`text-xs ${muted}`}>{PHASE_LABEL[tapPhase] || 'Calibrating'}</p>
          {tapNote && <p className={`text-[11px] ${text}`}>{tapNote}</p>}
          {error && <p className="text-[11px] text-rose-400">{error}</p>}
          {!opencvReady && status === 'live' && (
            <p className={`text-[10px] ${muted}`}>Loading vision helpers…</p>
          )}
          <div
            ref={frameNodeRef}
            className="relative w-full aspect-[3/4] max-h-[50vh] bg-black rounded-xl overflow-hidden touch-none"
            onPointerDown={onPreviewPointer}
          >
            <video
              ref={videoRef}
              className={`absolute inset-0 w-full h-full object-cover scale-x-[-1] ${
                tapPhase === 'aim' ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
              playsInline
              muted
            />
            <canvas
              ref={freezeCanvasRef}
              className={`absolute inset-0 w-full h-full object-cover scale-x-[-1] ${
                tapPhase !== 'aim' ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </div>
          {tapPhase === 'review' && reviewPose && (
            <p className={`text-[10px] ${muted}`}>
              Hub at ({Math.round(reviewPose.hub.x)}, {Math.round(reviewPose.hub.y)}), radius{' '}
              {Math.round(reviewPose.radius)}px
            </p>
          )}
        </div>
        <div className="p-3 border-t border-[#2a2826] flex gap-2">
          {tapPhase === 'review' ? (
            <button
              type="button"
              onClick={accept}
              className="flex-1 min-h-[48px] rounded-xl bg-[#7eb8da] text-[#121110] font-bold text-sm"
            >
              Accept calibration
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[48px] rounded-xl border border-[#3a3836] font-semibold text-sm"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
