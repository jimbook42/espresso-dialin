import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Trash2, X } from 'lucide-react';
import {
  formatReplaySizeMb,
  interpolateReplaySample,
  needleTipFromSample,
} from '../flairPressureLab/shotReplayInterpolation.js';
import { deleteLastLabShotReplay } from '../flairPressureLab/labShotReplayDb.js';

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   onDeleted: () => void,
 *   blob: Blob | null,
 *   meta: import('../flairPressureLab/labShotReplayDb.js').LabShotReplayMeta | null,
 *   ui: object,
 * }} props
 */
export function LabShotReplayScreen({ open, onClose, onDeleted, blob, meta, ui }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentS, setCurrentS] = useState(0);
  const [durationS, setDurationS] = useState(0);
  const [overlaySample, setOverlaySample] = useState(null);

  const objectUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : ''), [blob]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  useEffect(() => {
    if (!open) {
      setPlaying(false);
      setCurrentS(0);
      setOverlaySample(null);
      const v = videoRef.current;
      if (v) {
        v.pause();
        v.currentTime = 0;
      }
    }
  }, [open]);

  const syncOverlay = useCallback((tS) => {
    if (!meta?.samples?.length) {
      setOverlaySample(null);
      return;
    }
    setOverlaySample(interpolateReplaySample(meta.samples, tS));
  }, [meta]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteLastLabShotReplay();
      onDeleted();
      onClose();
    } catch {
      // ignore
    }
  };

  if (!open || !blob || !meta) return null;

  const viewW = meta.videoW || 1280;
  const viewH = meta.videoH || 720;
  const tip = overlaySample ? needleTipFromSample(overlaySample) : null;
  const barText =
    overlaySample?.bar != null && Number.isFinite(overlaySample.bar)
      ? overlaySample.bar.toFixed(1)
      : '—';

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col bg-black/95 text-white"
      data-testid="lab-shot-replay-screen"
      role="dialog"
      aria-modal="true"
      aria-label="Shot replay"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-white/10"
          aria-label="Close replay"
        >
          <X className="w-5 h-5" />
        </button>
        <span className="text-xs text-white/70">
          Replay · {formatReplaySizeMb(meta.byteSize)} MB
        </span>
        <button
          type="button"
          onClick={() => void handleDelete()}
          className="p-2 rounded-lg hover:bg-rose-500/20 text-rose-300"
          aria-label="Delete replay"
          data-testid="lab-shot-replay-delete"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center bg-black">
        <video
          ref={videoRef}
          src={objectUrl}
          className="max-h-full max-w-full w-full h-full object-contain"
          playsInline
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            setDurationS(Number.isFinite(d) ? d : meta.durationS || 0);
          }}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setCurrentS(t);
            syncOverlay(t);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-hidden
        >
          <svg
            className="h-full w-full max-h-full max-w-full"
            viewBox={`0 0 ${viewW} ${viewH}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {overlaySample?.valid && overlaySample.hubX != null && overlaySample.radius != null && (
              <>
                <circle
                  cx={overlaySample.hubX}
                  cy={overlaySample.hubY}
                  r={Math.max(4, overlaySample.radius * 0.08)}
                  fill="none"
                  stroke="rgba(255,200,80,0.9)"
                  strokeWidth={Math.max(2, overlaySample.radius * 0.02)}
                />
                {tip && (
                  <line
                    x1={overlaySample.hubX}
                    y1={overlaySample.hubY}
                    x2={tip.x}
                    y2={tip.y}
                    stroke="rgba(255,220,120,0.95)"
                    strokeWidth={Math.max(2, overlaySample.radius * 0.03)}
                    strokeLinecap="round"
                  />
                )}
              </>
            )}
          </svg>
        </div>
        <div
          className="pointer-events-none absolute top-[12%] left-0 right-0 text-center"
          data-testid="lab-shot-replay-bar-readout"
        >
          <span className="text-5xl font-black tabular-nums tracking-tight drop-shadow-lg">
            {barText}
            <span className="text-2xl font-bold ml-1 text-white/80">bar</span>
          </span>
        </div>
      </div>

      <div className={`px-4 py-4 space-y-3 border-t border-white/10 ${ui?.card || ''}`}>
        <input
          type="range"
          min={0}
          max={durationS || meta.durationS || 1}
          step={0.05}
          value={currentS}
          className="w-full accent-[#c88a4b]"
          aria-label="Scrub replay"
          onChange={(e) => {
            const t = Number(e.target.value);
            setCurrentS(t);
            if (videoRef.current) videoRef.current.currentTime = t;
            syncOverlay(t);
          }}
        />
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={togglePlay}
            className="inline-flex items-center gap-2 px-6 py-2 rounded-full bg-[#c88a4b] text-black font-bold"
            data-testid="lab-shot-replay-play-pause"
          >
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            {playing ? 'Pause' : 'Play'}
          </button>
        </div>
      </div>
    </div>
  );
}
