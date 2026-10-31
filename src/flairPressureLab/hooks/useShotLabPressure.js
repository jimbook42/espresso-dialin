import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrontCameraStream } from './useFrontCameraStream.js';
import { PROCESS_INTERVAL_MS } from '../gaugeConfig.js';
import { createReadingHold } from '../frameQuality.js';
import {
  createCalibratedTracker,
  readCalibratedFrame,
} from '../tapCalibrate.js';
import { loadOpenCv } from '../opencvRuntime.js';
import {
  peakBarFromRaw,
  rollingDisplayBar,
} from '../pressureDisplaySmoothing.js';
import { createShotLabPressureSession } from '../shotLabPressureSession.js';
import { simulatedPressureBarAt } from '../shotPressureSimFeed.js';
import { isPressureSimAllowed } from '../../config/pressureSimFlag.js';
import {
  shotLabPressureReadoutVisible,
  shotLabPressureShowLive,
} from '../shotLabPressureDisplay.js';
import { createShotLabR7Publisher } from '../shotLabR7Live.js';
import { r5SampleFromTapFrame } from '../shotLabR7Needle.js';
import { loadNeedleModel, isNeedleModelReady, needleModelStatus } from '../needleModel.js';
import { gaugeSnapshotJpegFromImageData } from '../gaugeSnapshotJpeg.js';
import { shouldPublishCornerPreviewPose } from '../labPressureCornerPreview.js';
import {
  createPreShotDialVerdictSampler,
  createShotStartDialHintTracker,
  preShotDialMismatch,
  PRE_SHOT_DIAL_SAMPLE_MS,
} from '../preShotDialCheck.js';

export const DIAL_RECALIBRATE_HINT = 'Dial not where you calibrated. Recalibrate.';

/** Live shots use the R7 gated stack (classical R6 + R5 + TemporalGate). */
export const SHOT_LAB_PRESSURE_READER_PATH = 'r7-tap-gated';

/**
 * Camera pressure during shots — isolated from scale/timer; errors are swallowed.
 *
 * @param {{
 *   enabled: boolean,
 *   timerRunning: boolean,
 *   timerSeconds: number,
 *   storedCalibration: object | null,
 *   onCalibrationSaved?: (calibration: object) => void,
 *   calibrateSheetOpen: boolean,
 *   weighingViewOpen: boolean,
 *   preShotDialCheckSurface: boolean,
 *   replayFrameObserverRef?: import('react').MutableRefObject<((frame: object) => void) | null>,
 *   leapCap?: boolean,
 *   modelTiebreak?: boolean,
 * }} options
 */
export function useShotLabPressure({
  enabled,
  timerRunning,
  timerSeconds,
  storedCalibration,
  onCalibrationSaved,
  calibrateSheetOpen,
  weighingViewOpen = false,
  preShotDialCheckSurface = false,
  replayFrameObserverRef,
  leapCap = true,
  modelTiebreak = true,
}) {
  const { videoRef, start, stop, status } = useFrontCameraStream();
  const sessionRef = useRef(createShotLabPressureSession());
  const holdRef = useRef(createReadingHold());
  const trackerRef = useRef(null);
  const r7Ref = useRef(null);
  const qualityCanvasRef = useRef(null);
  const shotEpochRef = useRef(null);
  const lastFrameRef = useRef(null);
  const gaugeSnapshotRef = useRef(null);
  /** Metrics frozen when the shot timer stops (session may reset immediately after). */
  const stoppedShotMetricsRef = useRef(null);
  const r5InferBusyRef = useRef(false);
  const lastR5Ref = useRef({ r5Bar: null, r5Conf: null, r5Angle: null });
  const timerSecondsRef = useRef(timerSeconds);
  timerSecondsRef.current = timerSeconds;
  const simMode = isPressureSimAllowed();

  const [samples, setSamples] = useState([]);
  const [displayBar, setDisplayBar] = useState(null);
  const [hold, setHold] = useState({ held: false, gap: true });
  const [peakBar, setPeakBar] = useState(null);
  const [calibrated, setCalibrated] = useState(Boolean(storedCalibration));
  const [readerError, setReaderError] = useState('');
  const [readerUncertain, setReaderUncertain] = useState(false);
  const [readerReady, setReaderReady] = useState(false);
  const [cornerPreviewPose, setCornerPreviewPose] = useState(null);
  const lastCornerPosePublishRef = useRef(0);
  const [dialRecalibrateHint, setDialRecalibrateHint] = useState(false);
  const shotStartDialHintRef = useRef(createShotStartDialHintTracker());
  const shotStartHintDoneRef = useRef(false);
  const [preShotDialStatus, setPreShotDialStatus] = useState(null);
  const preShotDialSamplerRef = useRef(createPreShotDialVerdictSampler());
  const preShotDialSamplerLockedRef = useRef(false);

  useEffect(() => {
    setCalibrated(Boolean(storedCalibration));
    if (storedCalibration) {
      trackerRef.current = createCalibratedTracker(storedCalibration, { leapCap });
      r7Ref.current = createShotLabR7Publisher(storedCalibration, { modelTiebreak });
    } else {
      trackerRef.current = null;
      r7Ref.current = null;
    }
  }, [storedCalibration, leapCap, modelTiebreak]);

  const displaySurfaceActive = timerRunning || weighingViewOpen;
  const preShotDialCheckActive =
    enabled
    && calibrated
    && !calibrateSheetOpen
    && !timerRunning
    && preShotDialCheckSurface
    && !simMode;
  const shouldRunCamera =
    enabled
    && (calibrateSheetOpen || ((displaySurfaceActive || preShotDialCheckActive) && calibrated && !simMode));

  useEffect(() => {
    if (!shouldRunCamera) {
      stop();
      return undefined;
    }
    let cancelled = false;
    loadOpenCv()
      .then(() => {
        if (!cancelled) void start();
      })
      .catch(() => {
        if (!cancelled) void start();
      });
    void loadNeedleModel().then(() => {
      if (!cancelled) {
        setReaderReady(isNeedleModelReady() || needleModelStatus() === 'failed');
      }
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [shouldRunCamera, start, stop]);

  const metricsFromLiveSession = useCallback(() => {
    const base = sessionRef.current.getShotMetrics();
    if (gaugeSnapshotRef.current && base.labPressureCurve?.length) {
      return { ...base, labGaugeSnapshotJpeg: gaugeSnapshotRef.current };
    }
    return base;
  }, []);

  const resetShotSession = useCallback(() => {
    sessionRef.current.reset();
    holdRef.current.reset();
    shotEpochRef.current = null;
    gaugeSnapshotRef.current = null;
    lastFrameRef.current = null;
    lastR5Ref.current = { r5Bar: null, r5Conf: null, r5Angle: null };
    setSamples([]);
    setDisplayBar(null);
    setHold({ held: false, gap: true });
    setPeakBar(null);
    setReaderError('');
    setReaderUncertain(false);
    setCornerPreviewPose(null);
    lastCornerPosePublishRef.current = 0;
    setDialRecalibrateHint(false);
    shotStartDialHintRef.current.reset();
    shotStartHintDoneRef.current = false;
    preShotDialSamplerRef.current.reset();
    preShotDialSamplerLockedRef.current = false;
    setPreShotDialStatus(null);
    r7Ref.current?.reset();
  }, []);

  const observePreShotDialPose = useCallback((read, cal) => {
    if (!preShotDialCheckActive || preShotDialSamplerLockedRef.current) return;
    const mismatch = preShotDialMismatch({
      trackedHub: read.lost ? null : read.hub,
      calibratedHub: cal?.hub,
      calibratedRadius: cal?.radius,
      poseLost: read.lost,
    });
    const next = preShotDialSamplerRef.current.observe(mismatch, Date.now());
    if (next.locked) preShotDialSamplerLockedRef.current = true;
    setPreShotDialStatus(next.status);
  }, [preShotDialCheckActive]);

  useEffect(() => {
    if (!preShotDialCheckActive) {
      preShotDialSamplerRef.current.reset();
      preShotDialSamplerLockedRef.current = false;
      setPreShotDialStatus(null);
    }
  }, [preShotDialCheckActive]);

  useEffect(() => {
    if (timerRunning) {
      stoppedShotMetricsRef.current = null;
      const epoch = Date.now();
      sessionRef.current.begin(epoch);
      shotEpochRef.current = epoch;
      r7Ref.current?.beginShot(epoch);
      holdRef.current.reset();
      setSamples([]);
      setDisplayBar(null);
      setHold({ held: false, gap: true });
      setPeakBar(null);
      setReaderUncertain(false);
      setDialRecalibrateHint(false);
      shotStartDialHintRef.current.reset();
      shotStartHintDoneRef.current = false;
      return;
    }
    if (weighingViewOpen) {
      const epoch = Date.now();
      sessionRef.current.begin(epoch);
      shotEpochRef.current = epoch;
      r7Ref.current?.beginShot(epoch);
      holdRef.current.reset();
      setSamples([]);
      setDisplayBar(null);
      setHold({ held: false, gap: true });
      setPeakBar(null);
      setReaderUncertain(false);
      setDialRecalibrateHint(false);
      shotStartDialHintRef.current.reset();
      shotStartHintDoneRef.current = false;
      return;
    }
    const snap = metricsFromLiveSession();
    if (snap.labPressureCurve?.length || snap.labPressureRawSampleCount) {
      stoppedShotMetricsRef.current = snap;
    }
    resetShotSession();
  }, [timerRunning, weighingViewOpen, resetShotSession, metricsFromLiveSession]);

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

  useEffect(() => {
    if (!enabled || !displaySurfaceActive) return undefined;
    if (simMode) {
      const tick = window.setInterval(() => {
        const epoch = shotEpochRef.current;
        if (!epoch) return;
        const tS = (Date.now() - epoch) / 1000;
        const bar = simulatedPressureBarAt(tS);
        if (bar == null) return;
        sessionRef.current.pushRaw(bar, true);
        const all = sessionRef.current.getSamples();
        setSamples([...all]);
        const held = holdRef.current.push({ bar, fresh: true, now: Date.now() });
        setHold({ held: held.held, gap: held.gap });
        setDisplayBar(rollingDisplayBar(all, tS));
        setPeakBar(peakBarFromRaw(all));
        setReaderUncertain(false);
      }, 200);
      return () => window.clearInterval(tick);
    }
    if (!calibrated || !trackerRef.current || !r7Ref.current) return undefined;

    let raf = 0;
    let last = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const wallNow = performance.now();
      if (wallNow - last < PROCESS_INTERVAL_MS) return;
      last = wallNow;
      try {
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;
        const image = grabSourceImage(video);
        if (!image) return;
        lastFrameRef.current = image;
        const read = readCalibratedFrame(image, trackerRef.current);
        const cal = trackerRef.current.calibration;
        observePreShotDialPose(read, cal);
        const nowMs = Date.now();
        if (cal?.hub && !shotStartHintDoneRef.current) {
          const mismatch = preShotDialMismatch({
            trackedHub: read.lost ? null : read.hub,
            calibratedHub: cal.hub,
            calibratedRadius: cal.radius,
            poseLost: read.lost,
          });
          const hint = shotStartDialHintRef.current.observe(mismatch, nowMs);
          setDialRecalibrateHint(hint.showHint);
          if (hint.done) shotStartHintDoneRef.current = true;
        }
        if (!r5InferBusyRef.current) {
          r5InferBusyRef.current = true;
          void r5SampleFromTapFrame(image, read)
            .then((r5) => {
              lastR5Ref.current = r5;
            })
            .finally(() => {
              r5InferBusyRef.current = false;
            });
        }
        const r5 = lastR5Ref.current;
        const gated = r7Ref.current.stepFrame({
          nowMs,
          read,
          r5Bar: r5.r5Bar,
          r5Conf: r5.r5Conf,
          r5Angle: r5.r5Angle,
        });
        const rawBar = gated.bar;
        const confident = rawBar != null && !gated.uncertain;
        const held = holdRef.current.push({
          bar: confident ? rawBar : null,
          fresh: confident,
          now: nowMs,
        });
        const epoch = shotEpochRef.current;
        if (confident && rawBar != null && epoch) {
          sessionRef.current.pushRaw(rawBar, true);
          gaugeSnapshotRef.current = gaugeSnapshotJpegFromImageData(image);
        }
        const all = sessionRef.current.getSamples();
        const tS = epoch ? (nowMs - epoch) / 1000 : timerSecondsRef.current;
        setSamples([...all]);
        setHold({ held: held.held, gap: held.gap });
        setReaderUncertain(gated.uncertain);
        setDisplayBar(
          gated.uncertain
            ? null
            : rollingDisplayBar(all, tS) ?? (held.gap ? null : held.bar),
        );
        setPeakBar(peakBarFromRaw(all));
        replayFrameObserverRef?.current?.({
          tS,
          bar: rawBar,
          needleDeg: read.needleDeg ?? r5.r5Angle ?? null,
          hubX: read.hub?.x ?? null,
          hubY: read.hub?.y ?? null,
          radius: read.radius ?? null,
          valid: confident && !read.lost,
        });
        if (shouldPublishCornerPreviewPose(nowMs, lastCornerPosePublishRef.current)) {
          lastCornerPosePublishRef.current = nowMs;
          setCornerPreviewPose({
            hubX: read.hub.x,
            hubY: read.hub.y,
            radius: read.radius,
            lost: read.lost,
            uncertain: gated.uncertain,
            atMs: nowMs,
          });
        }
      } catch {
        setReaderError('Pressure reader paused');
        setReaderUncertain(true);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [
    enabled,
    displaySurfaceActive,
    calibrated,
    simMode,
    grabSourceImage,
    videoRef,
    observePreShotDialPose,
  ]);

  useEffect(() => {
    if (!preShotDialCheckActive || !trackerRef.current) return undefined;
    if (displaySurfaceActive) return undefined;
    let raf = 0;
    let last = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const wallNow = performance.now();
      if (wallNow - last < PRE_SHOT_DIAL_SAMPLE_MS) return;
      if (preShotDialSamplerLockedRef.current) return;
      last = wallNow;
      try {
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;
        const image = grabSourceImage(video);
        if (!image) return;
        const read = readCalibratedFrame(image, trackerRef.current);
        const cal = trackerRef.current.calibration;
        observePreShotDialPose(read, cal);
      } catch {
        // ignore — informational only
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [
    preShotDialCheckActive,
    displaySurfaceActive,
    grabSourceImage,
    videoRef,
    observePreShotDialPose,
  ]);

  const acceptCalibration = useCallback(
    ({ calibration, tracker }) => {
      trackerRef.current = tracker ?? createCalibratedTracker(calibration, { leapCap });
      r7Ref.current = createShotLabR7Publisher(calibration, { modelTiebreak });
      preShotDialSamplerRef.current.reset();
      preShotDialSamplerLockedRef.current = false;
      setPreShotDialStatus('checking');
      setCalibrated(true);
      setReaderReady(isNeedleModelReady());
      onCalibrationSaved?.(calibration);
    },
    [onCalibrationSaved, leapCap, modelTiebreak],
  );

  const getShotMetrics = useCallback(() => {
    if (stoppedShotMetricsRef.current) {
      return { ...stoppedShotMetricsRef.current };
    }
    return metricsFromLiveSession();
  }, [metricsFromLiveSession]);

  const readoutVisible = shotLabPressureReadoutVisible({
    enabled,
    displaySurfaceActive,
    calibrated,
    simMode,
  });
  const showLive = shotLabPressureShowLive({
    enabled,
    displaySurfaceActive,
    calibrated,
    simMode,
    cameraStatus: status,
  });

  return {
    videoRef,
    samples,
    displayBar,
    hold,
    peakBar,
    calibrated,
    readoutVisible,
    showLive,
    readerError,
    readerUncertain,
    readerReady,
    readerPath: SHOT_LAB_PRESSURE_READER_PATH,
    acceptCalibration,
    getShotMetrics,
    cameraStatus: status,
    cornerPreviewPose,
    dialRecalibrateHint,
    preShotDialStatus,
  };
}
