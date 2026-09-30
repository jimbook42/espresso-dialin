import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, CameraOff } from 'lucide-react';
import { getAppTheme } from '../theme';
import { useFrontCameraStream } from './hooks/useFrontCameraStream';
import {
  EXTRACTION_START_BAR,
  FLAIR_58_SCALE,
  PROCESS_INTERVAL_MS,
  REST_STABLE_SAMPLES,
  angleToBar,
  classifyTrackingStatus,
  clockwiseDelta,
  selectForwardAngle,
} from './gaugeConfig';
import { objectCoverMap, previewAngleDeg, previewPointToVideo, videoRegionToPreview } from './geometry';
import { readNeedleFromVideo } from './needleFromFrame';
import {
  createAngleJitterTracker,
  createAngleTracker,
  createPressureSmoother,
  createRestCalibration,
  createRisingThreshold,
} from './smoothPressure';

const STATUS_STYLES = {
  CALIBRATING: 'bg-amber-500/15 text-amber-100 border-amber-500/40',
  TRACKING: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
  UNCERTAIN: 'bg-amber-500/15 text-amber-100 border-amber-500/40',
  LOST: 'bg-rose-500/15 text-rose-200 border-rose-500/40',
};

const INITIAL_REGION = { nx: 0.5, ny: 0.5, nr: 0.28 };

const EMPTY_LIVE = {
  tracking: 'CALIBRATING',
  displayBar: null,
  pressureBar: null,
  rawBar: null,
  rawAngle: null,
  smoothedAngle: null,
  quality: null,
  fps: 0,
  frame: null,
  accepted: false,
  signal: { above: false, crossedAt: null, crossCount: 0 },
  signalPaused: true,
  jitter: 0,
  calibCount: 0,
  flipHeld: false,
  corrected: false,
};

function exitLab() {
  window.location.hash = '';
  window.location.reload();
}

function formatClock(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString();
}

function formatNum(value, digits = 1) {
  return value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function FlairPressureLab() {
  const ui = getAppTheme(true);
  const { videoRef, start, stop, status, error, trackInfo } = useFrontCameraStream();
  const [mirrorPreview, setMirrorPreview] = useState(true);
  const [sweepDeg, setSweepDeg] = useState(FLAIR_58_SCALE.sweepDeg);
  const [frameBox, setFrameBox] = useState({ w: 0, h: 0 });
  const [videoSize, setVideoSize] = useState(null);
  const [region, setRegion] = useState(INITIAL_REGION);
  const [session, setSession] = useState(null);
  const [live, setLive] = useState(EMPTY_LIVE);

  const sessionRef = useRef(null);
  const regionRef = useRef(INITIAL_REGION);
  const sweepRef = useRef(sweepDeg);
  const mirrorRef = useRef(true);
  const videoSizeRef = useRef(null);
  const frameNodeRef = useRef(null);
  const adjustingRef = useRef(false);
  const dragRef = useRef(null);
  const lastAngleRef = useRef(null);
  const angleTrackerRef = useRef(createAngleTracker());
  const pressureRef = useRef(createPressureSmoother());
  const jitterRef = useRef(createAngleJitterTracker());
  const thresholdRef = useRef(createRisingThreshold(EXTRACTION_START_BAR));
  const calibRef = useRef(createRestCalibration());
  const resizeObserverRef = useRef(null);

  const frameRef = useCallback((node) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    frameNodeRef.current = node;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setFrameBox({ w: rect.width, h: rect.height });
    });
    observer.observe(node);
    resizeObserverRef.current = observer;
  }, []);

  useEffect(() => () => resizeObserverRef.current?.disconnect(), []);

  const forgetCalibration = useCallback(() => {
    sessionRef.current = null;
    lastAngleRef.current = null;
    calibRef.current.reset();
    angleTrackerRef.current.reset();
    pressureRef.current.reset();
    jitterRef.current.reset();
    thresholdRef.current.reset();
    setSession(null);
    setLive(EMPTY_LIVE);
  }, []);

  const handleStart = async () => {
    forgetCalibration();
    await start();
  };

  const handleStop = () => {
    stop();
    forgetCalibration();
    videoSizeRef.current = null;
    setVideoSize(null);
  };

  const handleRecalibrate = () => {
    if (status !== 'live') return;
    forgetCalibration();
  };

  const handleSweep = (value) => {
    setSweepDeg(value);
    sweepRef.current = value;
    if (!sessionRef.current) return;
    const next = { ...sessionRef.current, sweepDeg: value };
    sessionRef.current = next;
    setSession(next);
  };

  const pointerDown = (event, mode) => {
    event.preventDefault();
    event.stopPropagation();
    if (!videoSizeRef.current) return;
    dragRef.current = { mode, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    adjustingRef.current = true;
    forgetCalibration();
  };

  const pointerMove = (event) => {
    const drag = dragRef.current;
    const node = frameNodeRef.current;
    const size = videoSizeRef.current;
    if (!drag || !node || !size || event.pointerId !== drag.pointerId) return;
    const bounds = node.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (drag.mode === 'move') {
      const point = previewPointToVideo(x, y, size.w, size.h, bounds.width, bounds.height, mirrorRef.current);
      if (!point) return;
      const next = {
        ...regionRef.current,
        nx: clamp(point.nx, 0.05, 0.95),
        ny: clamp(point.ny, 0.05, 0.95),
      };
      regionRef.current = next;
      setRegion(next);
      return;
    }
    const preview = videoRegionToPreview(regionRef.current, size.w, size.h, bounds.width, bounds.height, mirrorRef.current);
    const map = objectCoverMap(size.w, size.h, bounds.width, bounds.height);
    if (!preview || !map) return;
    const dist = Math.hypot(x - preview.cx, y - preview.cy);
    const next = {
      ...regionRef.current,
      nr: clamp(dist / map.scale / Math.min(size.w, size.h), 0.12, 0.48),
    };
    regionRef.current = next;
    setRegion(next);
  };

  const pointerUp = (event) => {
    if (!dragRef.current || event.pointerId !== dragRef.current.pointerId) return;
    dragRef.current = null;
    adjustingRef.current = false;
    calibRef.current.reset();
  };

  useEffect(() => {
    if (status !== 'live') return undefined;
    const canvas = document.createElement('canvas');
    let raf = 0;
    let last = 0;
    let processed = 0;
    let windowStart = performance.now();
    let fps = 0;

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (now - last < PROCESS_INTERVAL_MS) return;
      last = now;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || adjustingRef.current) return;
      const reading = readNeedleFromVideo(video, canvas, regionRef.current);
      if (!reading) return;

      processed += 1;
      if (now - windowStart >= 1000) {
        fps = processed;
        processed = 0;
        windowStart = now;
      }

      const frame = { w: reading.videoWidth, h: reading.videoHeight };
      const choice = selectForwardAngle({
        angleDeg: reading.angleDeg,
        peak: reading.peak,
        oppositeScore: reading.oppositeScore,
        previousAngle: lastAngleRef.current,
      });

      if (!sessionRef.current) {
        const result = calibRef.current.push({
          angleDeg: reading.angleDeg,
          quality: reading.quality,
        });
        if (!result.ready) {
          setLive({
            ...EMPTY_LIVE,
            tracking: 'CALIBRATING',
            rawAngle: reading.angleDeg,
            quality: reading.quality,
            fps,
            frame,
            calibCount: result.count,
          });
          return;
        }
        const next = {
          zeroAngleDeg: result.zeroAngleDeg,
          ...FLAIR_58_SCALE,
          sweepDeg: sweepRef.current,
        };
        sessionRef.current = next;
        setSession(next);
        lastAngleRef.current = result.zeroAngleDeg;
        angleTrackerRef.current.reset();
        angleTrackerRef.current.push(result.zeroAngleDeg);
        pressureRef.current.reset();
        pressureRef.current.push(0);
        jitterRef.current.reset();
        thresholdRef.current.reset();
      }

      const weak = reading.quality == null || reading.quality < 0.08;
      const blockSample = choice.held || weak;
      let rawBar = null;
      let signalPaused = true;
      let signal = thresholdRef.current.get();
      let tracked = { angle: lastAngleRef.current, accepted: false };
      if (!blockSample && choice.angleDeg != null) {
        tracked = angleTrackerRef.current.push(choice.angleDeg);
        if (tracked.accepted && tracked.angle != null) {
          lastAngleRef.current = tracked.angle;
          rawBar = angleToBar(tracked.angle, sessionRef.current);
          const smoothed = pressureRef.current.push(rawBar);
          signal = thresholdRef.current.push(smoothed, Date.now());
          signalPaused = false;
        }
      }
      const jitter = jitterRef.current.push(tracked.accepted ? tracked.angle : lastAngleRef.current);
      const pressureBar = pressureRef.current.get();
      const tracking = classifyTrackingStatus({
        calibrated: true,
        quality: reading.quality,
        jitterDeg: jitter,
        accepted: Boolean(tracked.accepted) && !blockSample,
        heldFlip: choice.held || tracked.rejectedFlip,
      });
      setLive({
        tracking,
        displayBar: tracking === 'TRACKING' || tracking === 'UNCERTAIN' ? pressureBar : null,
        pressureBar,
        rawBar,
        rawAngle: reading.angleDeg,
        smoothedAngle: tracked.angle,
        quality: reading.quality,
        fps,
        frame,
        accepted: tracked.accepted && !blockSample,
        signal,
        signalPaused,
        jitter,
        calibCount: REST_STABLE_SAMPLES,
        flipHeld: Boolean(choice.held || tracked.rejectedFlip),
        corrected: choice.corrected,
      });
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, videoRef]);

  const ring = videoSize && frameBox.w
    ? videoRegionToPreview(region, videoSize.w, videoSize.h, frameBox.w, frameBox.h, mirrorPreview)
    : null;
  const cameraLive = status === 'live';
  const showNeedle = cameraLive && Boolean(session) && live.smoothedAngle != null && (live.tracking === 'TRACKING' || live.tracking === 'UNCERTAIN');
  const needleAngle = previewAngleDeg(live.smoothedAngle, mirrorPreview);
  const needleRad = ((needleAngle ?? 0) * Math.PI) / 180;
  const badge = cameraLive ? live.tracking : 'CALIBRATING';
  const pressureText = cameraLive && live.displayBar != null ? live.displayBar.toFixed(1) : '—';
  const caption = !cameraLive
    ? 'Start the front camera, then drag the ring onto the gauge.'
    : !session
      ? `Hold still. Calibrating ${live.calibCount}/${REST_STABLE_SAMPLES}`
      : live.tracking === 'TRACKING'
        ? 'Ready'
        : live.flipHeld
            ? 'Rejected a needle flip. Holding the last pressure.'
            : 'Reading is unsteady.';

  return (
    <div className={`min-h-dvh ${ui.page} flex flex-col`}>
      <header className={`border-b ${ui.headerBorder} px-4 py-4 flex items-center justify-between gap-3`}>
        <button
          type="button"
          onClick={() => {
            handleStop();
            exitLab();
          }}
          className={`inline-flex items-center gap-2 text-sm ${ui.secondaryBtn} px-3 py-2 rounded-xl`}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to app
        </button>
        <div className="text-right">
          <p className={`text-[10px] uppercase tracking-[0.2em] ${ui.sectionTitle}`}>Experimental</p>
          <h1 className={`text-sm font-bold ${ui.text}`}>Flair 58 pressure</h1>
        </div>
      </header>

      <main className="flex-1 max-w-xl mx-auto w-full px-4 py-4 space-y-4 pb-10">
        <ol className={`text-sm ${ui.sub} space-y-1.5 list-decimal pl-5`}>
          <li>Set the phone down where the whole gauge stays in view. Beside the Flair is fine. Leave it still.</li>
          <li>Drag the ring onto the gauge face. Drag the dot to resize it.</li>
          <li>At rest, calibration starts on its own once the needle is steady.</li>
        </ol>
        <p className={`text-xs ${ui.muted}`}>Nothing is saved. Do not hold the phone during the shot.</p>

        <div ref={frameRef} className={`relative ${ui.card} rounded-2xl overflow-hidden aspect-[3/4] max-h-[62vh] mx-auto bg-black`}>
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            style={mirrorPreview ? { transform: 'scaleX(-1)' } : undefined}
            playsInline
            muted
            autoPlay
            onLoadedMetadata={(event) => {
              const el = event.currentTarget;
              const next = { w: el.videoWidth, h: el.videoHeight };
              videoSizeRef.current = next;
              setVideoSize(next);
            }}
          />
          {ring && (
            <div
              className="absolute border-2 border-dashed border-[#c88a4b] rounded-full touch-none"
              style={{ left: ring.left, top: ring.top, width: ring.width, height: ring.height }}
              onPointerDown={(event) => pointerDown(event, 'move')}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
            >
              <div className="absolute left-1/2 top-1/2 w-1.5 h-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#c88a4b] pointer-events-none" />
              {showNeedle && (
                <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full pointer-events-none">
                  <line
                    x1="50"
                    y1="50"
                    x2={50 + 46 * Math.cos(needleRad)}
                    y2={50 + 46 * Math.sin(needleRad)}
                    stroke="#b7f3d0"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              )}
              <div
                data-handle="resize"
                className="absolute w-8 h-8 -right-2 top-1/2 -translate-y-1/2 rounded-full bg-[#c88a4b] border-2 border-[#121110]"
                onPointerDown={(event) => pointerDown(event, 'resize')}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={pointerUp}
              />
            </div>
          )}
          <p className="absolute bottom-3 left-0 right-0 text-center text-[11px] text-[#f5f2eb]/80 pointer-events-none">
            Drag the ring onto the gauge
          </p>
        </div>

        <div className={`${ui.cardInset} rounded-2xl p-5 text-center`}>
          <p className={`text-[10px] uppercase tracking-widest ${ui.muted}`}>Pressure</p>
          <p className="text-5xl font-black tabular-nums text-[#e0c9a8] mt-1">
            {pressureText}
            <span className="text-2xl font-bold ml-2">bar</span>
          </p>
          <p className={`text-[10px] uppercase tracking-widest ${ui.muted} mt-4`}>Tracking</p>
          <span className={`inline-block mt-1 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full border ${STATUS_STYLES[badge]}`}>
            {badge}
          </span>
          <p className={`text-xs ${ui.sub} mt-3`}>{caption}</p>
        </div>

        {error && (
          <p className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">{error}</p>
        )}

        <div className="flex flex-wrap gap-2">
          {status === 'live' ? (
            <button type="button" onClick={handleStop} className={`flex-1 inline-flex items-center justify-center gap-2 ${ui.secondaryBtn} py-3 rounded-xl text-sm`}>
              <CameraOff className="w-4 h-4" />
              Stop camera
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStart}
              disabled={status === 'requesting'}
              className={`flex-1 inline-flex items-center justify-center gap-2 ${ui.primary} py-3 rounded-xl text-sm disabled:opacity-60`}
            >
              <Camera className="w-4 h-4" />
              {status === 'requesting' ? 'Opening front camera…' : 'Start front camera'}
            </button>
          )}
          <button
            type="button"
            onClick={handleRecalibrate}
            disabled={status !== 'live'}
            className={`px-4 ${ui.secondaryBtn} py-3 rounded-xl text-sm disabled:opacity-50`}
          >
            Recalibrate
          </button>
        </div>

        <label className={`flex items-center justify-between gap-3 text-sm ${ui.sub}`}>
          <span>Mirror preview</span>
          <input
            type="checkbox"
            checked={mirrorPreview}
            onChange={(event) => {
              mirrorRef.current = event.target.checked;
              setMirrorPreview(event.target.checked);
            }}
            className="accent-[#c88a4b]"
          />
        </label>

        <section className={`${ui.card} rounded-2xl p-4 space-y-3`}>
          <h2 className={`text-[10px] uppercase tracking-widest ${ui.sectionTitle}`}>Diagnostics (test only)</h2>
          <dl className={`grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] ${ui.sub}`}>
            <dt>Camera</dt>
            <dd className={ui.text}>{status}</dd>
            <dt>Resolution</dt>
            <dd className={ui.text}>{live.frame ? `${live.frame.w}×${live.frame.h}` : (trackInfo ? `${trackInfo.width || '—'}×${trackInfo.height || '—'}` : '—')}</dd>
            <dt>Facing</dt>
            <dd className={ui.text}>{trackInfo?.facingMode || '—'}</dd>
            <dt>Processing FPS</dt>
            <dd className={ui.text}>{live.fps}</dd>
            <dt>Ring center</dt>
            <dd className={ui.text}>{region.nx.toFixed(2)}, {region.ny.toFixed(2)}</dd>
            <dt>Raw angle</dt>
            <dd className={ui.text}>{formatNum(live.rawAngle, 0)}°</dd>
            <dt>Smoothed angle</dt>
            <dd className={ui.text}>{formatNum(live.smoothedAngle, 1)}°</dd>
            <dt>Rest angle</dt>
            <dd className={ui.text}>{session ? `${session.zeroAngleDeg.toFixed(1)}°` : '—'}</dd>
            <dt>Clockwise from rest</dt>
            <dd className={ui.text}>{session && live.smoothedAngle != null ? `${clockwiseDelta(live.smoothedAngle, session.zeroAngleDeg).toFixed(1)}°` : '—'}</dd>
            <dt>Calculated pressure</dt>
            <dd className={ui.text}>{formatNum(live.rawBar, 2)} bar</dd>
            <dt>Smoothed pressure</dt>
            <dd className={ui.text}>{formatNum(live.pressureBar, 2)} bar</dd>
            <dt>Tracking state</dt>
            <dd className={ui.text}>{badge}</dd>
            <dt>Edge quality</dt>
            <dd className={ui.text}>{formatNum(live.quality, 3)}</dd>
            <dt>Tail corrected</dt>
            <dd className={ui.text}>{live.corrected ? 'yes' : 'no'}</dd>
            <dt>Flip held</dt>
            <dd className={ui.text}>{live.flipHeld ? 'yes' : 'no'}</dd>
            <dt>Gauge follow</dt>
            <dd className={ui.text}>none</dd>
            <dt>Jitter</dt>
            <dd className={ui.text}>{formatNum(live.jitter, 1)}°</dd>
            <dt>Preview mirrored</dt>
            <dd className={ui.text}>{mirrorPreview ? 'yes' : 'no'}</dd>
            <dt>CV frame</dt>
            <dd className={ui.text}>unmirrored</dd>
            <dt>Above {EXTRACTION_START_BAR} bar</dt>
            <dd className={ui.text}>{live.signalPaused ? 'paused' : (live.signal.above ? 'yes' : 'no')}</dd>
            <dt>Rising edge</dt>
            <dd className={ui.text}>{formatClock(live.signal.crossedAt)} ({live.signal.crossCount})</dd>
          </dl>
          <p className={`text-[10px] ${ui.muted} leading-relaxed`}>
            Edge quality is an internal score, not a confidence percentage.
            Pressure uses the needle angle around the ring you placed, minus the rest angle, both in the camera image.
            The ring does not follow the gauge. If the lever moves the dial, that movement is not removed from the pressure.
            The rising-edge line does not start a timer and is not saved.
          </p>
          <label className={`block text-sm ${ui.sub}`}>
            Scale arc assumption: {sweepDeg}° from 0 to 12 bar
            <input
              type="range"
              min="200"
              max="320"
              step="1"
              value={sweepDeg}
              onChange={(event) => handleSweep(parseInt(event.target.value, 10))}
              className="w-full mt-2 accent-[#c88a4b]"
            />
          </label>
        </section>
      </main>
    </div>
  );
}

export default FlairPressureLab;
