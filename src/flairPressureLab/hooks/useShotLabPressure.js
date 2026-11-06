import { useCallback, useEffect, useRef, useState } from 'react';
import { resetCameraTrackLog, useFrontCameraStream } from './useFrontCameraStream.js';
import { PROCESS_INTERVAL_MS } from '../gaugeConfig.js';
import { isRepeatedGaugeFrame } from '../cameraFrameFreshness.js';
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
import {
  NO_PRESSURE_READING_WARNING,
  createReaderStallDiagnostics,
  recordReaderSample,
} from '../readerStallDiagnostics.js';
import { gaugeSnapshotJpegFromImageData } from '../gaugeSnapshotJpeg.js';
import { shouldPublishCornerPreviewPose } from '../labPressureCornerPreview.js';
import {
  createPreShotDialVerdictSampler,
  createShotStartDialHintTracker,
  preShotDialMismatch,
  PRE_SHOT_DIAL_SAMPLE_MS,
} from '../preShotDialCheck.js';
import {
  createPreShotReadableWindow,
  isRecordedSampleConfident,
  preShotDialDisplayStatus,
} from '../preShotReadableStatus.js';

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
 *   cameraPreviewActive?: boolean,
 *   cameraFacingMode?: 'user' | 'environment',
 *   replayFrameObserverRef?: import('react').MutableRefObject<((frame: object) => void) | null>,
 *   leapCap?: boolean,
 *   modelTiebreak?: boolean,
 *   legacyScale?: boolean,
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
  cameraPreviewActive = false,
  cameraFacingMode = 'user',
  replayFrameObserverRef,
  leapCap = true,
  modelTiebreak = true,
  legacyScale = false,
}) {
  const {
    videoRef, start, stop, status, error: cameraError, trackDiagnosticsRef: cameraTrackLogRef,
  } = useFrontCameraStream({ facingMode: cameraFacingMode });
  const fallbackTrackLogRef = useRef(null);
  if (!cameraTrackLogRef && !fallbackTrackLogRef.current) {
    fallbackTrackLogRef.current = { readyState: null, muted: null, events: { mute: 0, unmute: 0, ended: 0 } };
  }
  const trackDiagnosticsRef = cameraTrackLogRef ?? fallbackTrackLogRef;
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
  const r5GenerationRef = useRef(0);
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
  const [noPressureReadingWarning, setNoPressureReadingWarning] = useState('');
  const preShotDialSamplerRef = useRef(createPreShotDialVerdictSampler());
  const preShotDialSamplerLockedRef = useRef(false);
  const preShotReadableRef = useRef(createPreShotReadableWindow());
  const preShotPoseStatusRef = useRef(null);
  const stallRef = useRef(null);
  const readerStallSnapshotRef = useRef(null);
  const warningOnRef = useRef(false);
  const legacyScaleRef = useRef(legacyScale);
  const recordingRef = useRef(false);
  legacyScaleRef.current = legacyScale;
  recordingRef.current = Boolean(timerRunning && !simMode);

  useEffect(() => {
    r5GenerationRef.current += 1;
    lastR5Ref.current = { r5Bar: null, r5Conf: null, r5Angle: null };
    setCalibrated(Boolean(storedCalibration));
    if (storedCalibration) {
      trackerRef.current = createCalibratedTracker(storedCalibration, { leapCap, legacyScale });
      r7Ref.current = createShotLabR7Publisher(storedCalibration, { modelTiebreak, legacyScale });
    } else {
      trackerRef.current = null;
      r7Ref.current = null;
    }
  }, [storedCalibration, leapCap, legacyScale, modelTiebreak]);

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
    && (calibrateSheetOpen || (cameraPreviewActive && !simMode)
      || ((displaySurfaceActive || preShotDialCheckActive) && calibrated && !simMode));

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
    r5GenerationRef.current += 1;
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
    preShotReadableRef.current.reset();
    preShotPoseStatusRef.current = null;
    setPreShotDialStatus(null);
    warningOnRef.current = false;
    setNoPressureReadingWarning('');
    r7Ref.current?.reset();
  }, []);

  const finishReaderStall = useCallback(() => {
    const stall = stallRef.current;
    if (!stall) return;
    try {
      if (!legacyScaleRef.current) stall.syncPublisher(r7Ref.current?.rejectionCounts);
      stall.observe(
        Date.now(),
        videoRef.current,
        r5InferBusyRef.current,
        needleModelStatus(),
        trackDiagnosticsRef.current,
      );
      readerStallSnapshotRef.current = stall.snapshot();
    } catch {
      try { readerStallSnapshotRef.current = stall.snapshot(); } catch { /* observation only */ }
    }
    stall.stop();
    stallRef.current = null;
  }, [videoRef, trackDiagnosticsRef]);

  const beginReaderStall = useCallback((epoch) => {
    finishReaderStall();
    warningOnRef.current = false;
    setNoPressureReadingWarning('');
    const track = videoRef.current?.srcObject?.getVideoTracks?.()[0] ?? null;
    resetCameraTrackLog(trackDiagnosticsRef.current, track);
    stallRef.current = createReaderStallDiagnostics(epoch);
  }, [finishReaderStall, videoRef, trackDiagnosticsRef]);

  const syncPreShotDialStatus = useCallback((nowMs = Date.now()) => {
    const snap = preShotReadableRef.current.snapshot(nowMs);
    setPreShotDialStatus(preShotDialDisplayStatus({
      poseStatus: preShotPoseStatusRef.current,
      nowMs,
      lastConfidentMs: snap.lastConfidentMs,
      confidentAt: snap.confidentAt,
      rejections: snap.rejections,
    }));
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
    preShotPoseStatusRef.current = next.status;
    syncPreShotDialStatus(Date.now());
  }, [preShotDialCheckActive, syncPreShotDialStatus]);

  const notePreShotReadable = useCallback((gated, nowMs, read) => {
    if (!preShotDialCheckActive) return;
    preShotReadableRef.current.note(gated, nowMs, read);
    syncPreShotDialStatus(nowMs);
  }, [preShotDialCheckActive, syncPreShotDialStatus]);

  useEffect(() => {
    if (!preShotDialCheckActive) {
      preShotDialSamplerRef.current.reset();
      preShotDialSamplerLockedRef.current = false;
      preShotReadableRef.current.reset();
      preShotPoseStatusRef.current = null;
      setPreShotDialStatus(null);
    }
  }, [preShotDialCheckActive]);

  useEffect(() => {
    if (timerRunning) {
      r5GenerationRef.current += 1;
      lastR5Ref.current = { r5Bar: null, r5Conf: null, r5Angle: null };
      stoppedShotMetricsRef.current = null;
      const epoch = Date.now();
      if (!simMode) beginReaderStall(epoch);
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
      r5GenerationRef.current += 1;
      lastR5Ref.current = { r5Bar: null, r5Conf: null, r5Angle: null };
      const epoch = Date.now();
      if (!simMode) beginReaderStall(epoch);
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
    finishReaderStall();
    warningOnRef.current = false;
    setNoPressureReadingWarning('');
    resetShotSession();
  }, [timerRunning, weighingViewOpen, simMode, resetShotSession, metricsFromLiveSession, beginReaderStall, finishReaderStall]);

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
    let lastRead = null;
    let presentedFrame = 0;
    let presentedAtMs = null;
    let consumedFrame = -1;
    let lastMediaTime = -1;
    let videoFrameCallback = 0;
    const sourceVideo = videoRef.current;
    const useVideoFrames = typeof sourceVideo?.requestVideoFrameCallback === 'function';
    const observeVideoFrame = (_now, metadata) => {
      presentedFrame = metadata.presentedFrames ?? presentedFrame + 1;
      presentedAtMs = Date.now();
      try { stallRef.current?.presented(presentedAtMs); } catch { /* observation only */ }
      videoFrameCallback = sourceVideo.requestVideoFrameCallback(observeVideoFrame);
    };
    if (useVideoFrames) videoFrameCallback = sourceVideo.requestVideoFrameCallback(observeVideoFrame);
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const wallNow = performance.now();
      if (wallNow - last < PROCESS_INTERVAL_MS) return;
      last = wallNow;
      try {
        const video = videoRef.current;
        const capturedAtMs = useVideoFrames && presentedAtMs != null ? presentedAtMs : Date.now();
        const cal = trackerRef.current.calibration;
        const newFrame = video?.readyState >= 2 && (useVideoFrames
          ? presentedFrame > 0 && presentedFrame !== consumedFrame : video.currentTime !== lastMediaTime);
        let image = newFrame ? grabSourceImage(video) : null;
        let repeatedFrame = false;
        if (image) {
          consumedFrame = presentedFrame;
          lastMediaTime = video.currentTime;
          if (isRepeatedGaugeFrame(image, lastFrameRef.current, cal)) {
            repeatedFrame = true;
            image = null;
          }
        }
        let read;
        let hadImage = false;
        if (image) {
          hadImage = true;
          lastFrameRef.current = image;
          read = readCalibratedFrame(image, trackerRef.current);
          lastRead = read;
        } else {
          // Repeated/absent camera pixels are gaps, not fresh measurements.
          read = { ...(lastRead ?? { hub: cal.hub, radius: cal.radius }),
            ok: false, bar: null, rawBar: null, fresh: false, needleDeg: null,
            lost: !video || video.readyState < 2 };
        }
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
        if (image && !r5InferBusyRef.current) {
          r5InferBusyRef.current = true;
          const generation = r5GenerationRef.current;
          void r5SampleFromTapFrame(image, read, cal, capturedAtMs)
            .then((r5) => {
              if (generation === r5GenerationRef.current && trackerRef.current?.calibration === cal) {
                lastR5Ref.current = r5;
              }
            })
            .catch((error) => {
              try { stallRef.current?.inferenceRejected(error); } catch { /* observation only */ }
              if (generation === r5GenerationRef.current) lastR5Ref.current = {};
            })
            .finally(() => {
              r5InferBusyRef.current = false;
            });
        }
        const r5 = lastR5Ref.current;
        const gated = r7Ref.current.stepFrame({
          ...r5,
          nowMs,
          capturedAtMs,
          read,
        });
        const rawBar = gated.bar;
        const confident = isRecordedSampleConfident(gated);
        notePreShotReadable(gated, nowMs, read);
        const epoch = shotEpochRef.current;
        try {
          recordReaderSample(stallRef.current, {
            hadImage,
            read: hadImage ? read : null,
            repeated: repeatedFrame,
            gated,
            legacyScale: legacyScaleRef.current,
            publisherCounts: r7Ref.current?.rejectionCounts,
            publishedAtMs: confident && rawBar != null && epoch ? nowMs : null,
          });
          if (confident && rawBar != null && epoch && warningOnRef.current) {
            warningOnRef.current = false;
            setNoPressureReadingWarning('');
          }
        } catch { /* observation only */ }
        if (confident && rawBar != null && epoch) {
          sessionRef.current.pushRaw(rawBar, true, gated.measuredAtMs);
          // In-memory display boundary only; getShotMetrics saves just tS/bar.
          if (read.needleTrackingReset) sessionRef.current.getSamples().at(-1).reset = true;
          if (image) gaugeSnapshotRef.current = gaugeSnapshotJpegFromImageData(image);
        }
        const all = sessionRef.current.getSamples();
        const tS = epoch ? (nowMs - epoch) / 1000 : timerSecondsRef.current;
        setSamples([...all]);
        setHold({ held: gated.held, gap: rawBar == null });
        setReaderUncertain(gated.uncertain);
        setDisplayBar(
          gated.displayBar !== undefined ? gated.displayBar
            : gated.held ? rawBar : confident ? rollingDisplayBar(all, tS) ?? rawBar : null,
        );
        setPeakBar(peakBarFromRaw(all));
        replayFrameObserverRef?.current?.({
          tS,
          calibration: cal,
          capturedAtSec: epoch ? (capturedAtMs - epoch) / 1000 : null,
          measuredAtSec: epoch && gated.measuredAtMs != null ? (gated.measuredAtMs - epoch) / 1000 : null,
          rawBar: read.rawBar,
          zeroDeg: read.zeroDeg,
          fiveDeg: read.fiveDeg,
          tenDeg: read.tenDeg,
          bar: rawBar,
          needleDeg: read.needleDeg ?? r5.r5Angle ?? null,
          hubX: read.hub?.x ?? null,
          hubY: read.hub?.y ?? null,
          radius: read.radius ?? null,
          valid: confident && !read.lost,
          fresh: gated.fresh === true,
          held: gated.held === true,
          reason: gated.reason,
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
      } catch (error) {
        try { stallRef.current?.error(error); } catch { /* observation only */ }
        setReaderError('Pressure reader paused');
        setReaderUncertain(true);
      }
    };
    const watch = window.setInterval(() => {
      const stall = stallRef.current;
      if (!stall) return;
      try {
        if (!legacyScaleRef.current) stall.syncPublisher(r7Ref.current?.rejectionCounts);
        const stale = stall.observe(
          Date.now(),
          videoRef.current,
          r5InferBusyRef.current,
          needleModelStatus(),
          trackDiagnosticsRef.current,
        );
        const show = Boolean(recordingRef.current && stale);
        if (show === warningOnRef.current) return;
        warningOnRef.current = show;
        setNoPressureReadingWarning(show ? NO_PRESSURE_READING_WARNING : '');
      } catch { /* observation only */ }
    }, 500);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(watch);
      if (videoFrameCallback) sourceVideo.cancelVideoFrameCallback(videoFrameCallback);
      r5GenerationRef.current += 1;
    };
  }, [
    enabled,
    displaySurfaceActive,
    calibrated,
    simMode,
    grabSourceImage,
    videoRef,
    observePreShotDialPose,
    notePreShotReadable,
  ]);

  useEffect(() => {
    if (!preShotDialCheckActive || !trackerRef.current) return undefined;
    if (displaySurfaceActive) return undefined;
    let raf = 0;
    let last = 0;
    let lastImage = null;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const wallNow = performance.now();
      // Pose sampling stays at the existing cadence until the lock latches.
      // After that, keep reading at the shot interval so the freshness gate
      // sees the same spacing it uses for recorded samples.
      const interval = preShotDialSamplerLockedRef.current
        ? PROCESS_INTERVAL_MS
        : PRE_SHOT_DIAL_SAMPLE_MS;
      if (wallNow - last < interval) return;
      last = wallNow;
      try {
        const nowMs = Date.now();
        const video = videoRef.current;
        if (!video || video.readyState < 2) {
          syncPreShotDialStatus(nowMs);
          return;
        }
        const image = grabSourceImage(video);
        if (!image) return;
        const cal = trackerRef.current.calibration;
        const repeated = isRepeatedGaugeFrame(image, lastImage, cal);
        const read = readCalibratedFrame(image, trackerRef.current);
        observePreShotDialPose(read, cal);
        if (repeated) {
          syncPreShotDialStatus(nowMs);
          return;
        }
        lastImage = image;
        const gated = r7Ref.current?.stepFrame({
          ...lastR5Ref.current,
          read,
          nowMs,
          capturedAtMs: nowMs,
        });
        if (gated) notePreShotReadable(gated, nowMs, read);
        else syncPreShotDialStatus(nowMs);
      } catch {
        // informational only — does not block Start
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
    notePreShotReadable,
    syncPreShotDialStatus,
  ]);

  const acceptCalibration = useCallback(
    ({ calibration, tracker }) => {
      r5GenerationRef.current += 1;
      lastR5Ref.current = { r5Bar: null, r5Conf: null, r5Angle: null };
      trackerRef.current = tracker ?? createCalibratedTracker(calibration, { leapCap, legacyScale });
      r7Ref.current = createShotLabR7Publisher(calibration, { modelTiebreak, legacyScale });
      preShotDialSamplerRef.current.reset();
      preShotDialSamplerLockedRef.current = false;
      preShotReadableRef.current.reset();
      preShotPoseStatusRef.current = 'checking';
      setPreShotDialStatus('checking');
      setCalibrated(true);
      setReaderReady(isNeedleModelReady());
      onCalibrationSaved?.(calibration);
    },
    [onCalibrationSaved, leapCap, legacyScale, modelTiebreak],
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
    cameraError,
    dialRecalibrateHint,
    preShotDialStatus,
    noPressureReadingWarning,
    readerStallSnapshotRef,
  };
}
