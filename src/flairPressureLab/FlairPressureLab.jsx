import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, CameraOff } from 'lucide-react';
import { getAppTheme } from '../theme';
import { useFrontCameraStream } from './hooks/useFrontCameraStream';
import {
  EXTRACTION_START_BAR,
  FLAIR_58_SCALE,
  PROCESS_INTERVAL_MS,
  angleToBar,
  classifyTrackingStatus,
  clockwiseDelta,
} from './gaugeConfig';
import { guideCircleStyle, previewAngleDeg } from './geometry';
import { readNeedleFromVideo } from './needleFromFrame';
import {
  circularMedian,
  createAngleJitterTracker,
  createAngleTracker,
  createPressureSmoother,
  createRisingThreshold,
} from './smoothPressure';

const STATUS_STYLES = {
  CALIBRATING: 'bg-amber-500/15 text-amber-100 border-amber-500/40',
  TRACKING: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
  UNCERTAIN: 'bg-amber-500/15 text-amber-100 border-amber-500/40',
  LOST: 'bg-rose-500/15 text-rose-200 border-rose-500/40',
};

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

export function FlairPressureLab() {
  const ui = getAppTheme(true);
  const { videoRef, start, stop, status, error, trackInfo } = useFrontCameraStream();
  const [mirrorPreview, setMirrorPreview] = useState(true);
  const [radiusFraction, setRadiusFraction] = useState(0.34);
  const [sweepDeg, setSweepDeg] = useState(FLAIR_58_SCALE.sweepDeg);
  const [frameBox, setFrameBox] = useState({ w: 0, h: 0 });
  const [videoSize, setVideoSize] = useState(null);
  const [session, setSession] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [calibrateNote, setCalibrateNote] = useState('');
  const [live, setLive] = useState(EMPTY_LIVE);

  const sessionRef = useRef(null);
  const captureRef = useRef(null);
  const radiusRef = useRef(radiusFraction);
  const sweepRef = useRef(sweepDeg);
  const angleTrackerRef = useRef(createAngleTracker());
  const pressureRef = useRef(createPressureSmoother());
  const jitterRef = useRef(createAngleJitterTracker());
  const thresholdRef = useRef(createRisingThreshold(EXTRACTION_START_BAR));
  const resizeObserverRef = useRef(null);

  const frameRef = useCallback((node) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
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

  const clearSession = useCallback(() => {
    sessionRef.current = null;
    captureRef.current = null;
    angleTrackerRef.current.reset();
    pressureRef.current.reset();
    jitterRef.current.reset();
    thresholdRef.current.reset();
    setSession(null);
    setCapturing(false);
    setLive(EMPTY_LIVE);
  }, []);

  const handleStart = async () => {
    clearSession();
    setCalibrateNote('');
    await start();
  };

  const handleStop = () => {
    stop();
    clearSession();
    setVideoSize(null);
    setCalibrateNote('');
  };

  const handleCalibrate = () => {
    if (status !== 'live' || capturing) return;
    clearSession();
    setCalibrateNote('');
    setCapturing(true);
    captureRef.current = { samples: [], startedAt: performance.now() };
  };

  const handleRadius = (value) => {
    setRadiusFraction(value);
    radiusRef.current = value;
    if (sessionRef.current || captureRef.current) {
      setCalibrateNote('Guide size changed. Calibrate at rest again.');
      clearSession();
    }
  };

  const handleSweep = (value) => {
    setSweepDeg(value);
    sweepRef.current = value;
    if (!sessionRef.current) return;
    const next = { ...sessionRef.current, sweepDeg: value };
    sessionRef.current = next;
    setSession(next);
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
      if (!video || video.readyState < 2) return;
      const reading = readNeedleFromVideo(video, canvas, radiusRef.current);
      if (!reading) return;

      processed += 1;
      if (now - windowStart >= 1000) {
        fps = processed;
        processed = 0;
        windowStart = now;
      }

      const frame = { w: reading.videoWidth, h: reading.videoHeight };

      if (captureRef.current) {
        captureRef.current.samples.push(reading);
        const cap = captureRef.current;
        if (cap.samples.length >= 8 || now - cap.startedAt > 1500) {
          captureRef.current = null;
          const good = cap.samples.filter((sample) => sample.quality >= 0.12);
          setCapturing(false);
          if (good.length < 5) {
            setCalibrateNote('The resting needle was not clear. Realign the gauge in the ring, then calibrate again.');
          } else {
            const zeroAngleDeg = circularMedian(good.map((sample) => sample.angleDeg));
            const next = {
              zeroAngleDeg,
              radiusFraction: radiusRef.current,
              ...FLAIR_58_SCALE,
              sweepDeg: sweepRef.current,
            };
            sessionRef.current = next;
            setSession(next);
            setCalibrateNote('');
            angleTrackerRef.current.reset();
            angleTrackerRef.current.push(zeroAngleDeg);
            pressureRef.current.reset();
            pressureRef.current.push(0);
            jitterRef.current.reset();
            thresholdRef.current.reset();
          }
        }
        setLive({
          ...EMPTY_LIVE,
          tracking: 'CALIBRATING',
          rawAngle: reading.angleDeg,
          quality: reading.quality,
          fps,
          frame,
        });
        return;
      }

      const current = sessionRef.current;
      const tracked = angleTrackerRef.current.push(current ? reading.angleDeg : null);
      const jitter = current ? jitterRef.current.push(tracked.angle) : 0;
      let rawBar = null;
      let signalPaused = true;
      let signal = thresholdRef.current.get();
      if (current && tracked.accepted && tracked.angle != null) {
        rawBar = angleToBar(tracked.angle, current);
        const smoothed = pressureRef.current.push(rawBar);
        signal = thresholdRef.current.push(smoothed, Date.now());
        signalPaused = false;
      }
      const pressureBar = pressureRef.current.get();
      const tracking = classifyTrackingStatus({
        calibrated: Boolean(current),
        quality: reading.quality,
        jitterDeg: jitter,
        accepted: Boolean(current && tracked.accepted),
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
        accepted: tracked.accepted,
        signal,
        signalPaused,
        jitter,
      });
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, videoRef]);

  const ring = frameBox.w
    ? (videoSize
      ? guideCircleStyle(videoSize.w, videoSize.h, frameBox.w, frameBox.h, radiusFraction)
      : (() => {
          const size = Math.min(frameBox.w, frameBox.h) * 0.72;
          return {
            width: size,
            height: size,
            left: (frameBox.w - size) / 2,
            top: (frameBox.h - size) / 2,
          };
        })())
    : null;

  const cameraLive = status === 'live';
  const showNeedle = cameraLive && Boolean(session) && live.smoothedAngle != null && (live.tracking === 'TRACKING' || live.tracking === 'UNCERTAIN');
  const needleAngle = previewAngleDeg(live.smoothedAngle, mirrorPreview);
  const needleRad = ((needleAngle ?? 0) * Math.PI) / 180;
  const badge = cameraLive ? live.tracking : 'CALIBRATING';
  const pressureText = cameraLive && live.displayBar != null ? live.displayBar.toFixed(1) : '—';

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
          <li>Place your phone flat on the bench with the front camera facing the gauge.</li>
          <li>Align the gauge inside the guide.</li>
          <li>Calibrate with the gauge at rest.</li>
        </ol>
        <p className={`text-xs ${ui.muted}`}>
          Leave the phone still. Do not hold it during the shot. Nothing is saved.
        </p>

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
              setVideoSize({ w: el.videoWidth, h: el.videoHeight });
            }}
          />
          {ring && (
            <div
              className="absolute border-2 border-dashed border-[#c88a4b] rounded-full pointer-events-none"
              style={ring}
            >
              <div className="absolute left-1/2 top-1/2 w-1.5 h-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#c88a4b]" />
              {showNeedle && (
                <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
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
            </div>
          )}
          <p className="absolute bottom-3 left-0 right-0 text-center text-[11px] text-[#f5f2eb]/80 pointer-events-none">
            Fit the gauge face inside the ring
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
          {capturing && <p className={`text-xs ${ui.sub} mt-3`}>Reading the resting needle. Hold still.</p>}
        </div>

        {error && (
          <p className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">{error}</p>
        )}
        {calibrateNote && (
          <p className={`text-sm ${ui.sub} ${ui.card} rounded-xl p-3`}>{calibrateNote}</p>
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
            onClick={handleCalibrate}
            disabled={status !== 'live' || capturing}
            className={`flex-1 ${ui.primary} py-3 rounded-xl text-sm disabled:opacity-50`}
          >
            {session ? 'Calibrate again' : 'Calibrate at rest'}
          </button>
        </div>

        <label className={`block text-sm ${ui.sub}`}>
          Guide size
          <input
            type="range"
            min="0.24"
            max="0.46"
            step="0.01"
            value={radiusFraction}
            onChange={(event) => handleRadius(parseFloat(event.target.value))}
            className="w-full mt-2 accent-[#c88a4b]"
          />
        </label>

        <label className={`flex items-center justify-between gap-3 text-sm ${ui.sub}`}>
          <span>Mirror preview</span>
          <input
            type="checkbox"
            checked={mirrorPreview}
            onChange={(event) => setMirrorPreview(event.target.checked)}
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
            <dt>Angle held</dt>
            <dd className={ui.text}>{session ? (live.accepted ? 'no' : 'yes') : '—'}</dd>
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
            Edge quality is an internal peak-margin score for debugging. It is not a confidence percentage.
            The rising-edge line is only a future shot-timer signal. It does not start a timer and is not saved.
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
          <p className={`text-[10px] ${ui.muted} leading-relaxed`}>
            Rest calibration measures the 0 bar angle only. This arc is the assumed clockwise travel of the Flair 0–12 scale in the camera image. If the live number disagrees with the dial, move this until they match.
          </p>
        </section>
      </main>
    </div>
  );
}

export default FlairPressureLab;
