import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, CameraOff } from 'lucide-react';
import { getAppTheme } from '../theme';
import { useFrontCameraStream } from './hooks/useFrontCameraStream';
import {
  EXTRACTION_START_BAR,
  FLAIR_58_SCALE,
  NEEDLE_LIKENESS_GATE,
  NEEDLE_LOST_QUALITY,
  NEEDLE_TRACK_QUALITY,
  PROCESS_INTERVAL_MS,
  REST_STABLE_SAMPLES,
  angleToBar,
  classifyTrackingStatus,
  clockwiseDelta,
  selectForwardAngle,
  uncertaintyReason,
  wrap360,
  wrapDelta,
} from './gaugeConfig';
import { DiagnosticTrace } from './DiagnosticTrace';
import { DIAGNOSTIC_WINDOW_MS, createDiagnosticHistory, stabilityStats } from './diagnosticHistory';
import { buildDiagnosticReport } from './diagnosticReport';
import { objectCoverMap, previewAngleDeg, videoPointToPreview } from './geometry';
import {
  GLARE_SETUP_HINT,
  MOVE_CLOSER_HINT,
  createReadingBridge,
  createReadingHold,
  createShotRun,
  gaugeTooSmallForNeedle,
  glareSetupHintVisible,
  moveCloserHintVisible,
} from './frameQuality.js';
import { HUB_CONNECTION_MIN, minReadableDialRadiusPx } from './needleFromFrame.js';
import { REST_ANCHOR_MS, confidentAngleWindow, createRestAnchor, templateConflictDeg } from './restAnchor.js';
import {
  createGaugeTracker,
  gaugeAllowsConfidentReading,
  gaugeAllowsReading,
  lastReadProfile,
  probeGaugeDiscoveryCandidates,
  readTrackedGauge,
} from './gaugeTrack';
import { setDiscoverySearchListener, warmDiscoveryWorker, whenDiscoverySettled, whenDiscoveryWarmed } from './discoveryClient.js';
import {
  createAngleJitterTracker,
  createAngleTracker,
  createNeedleKalman,
  createPressureSmoother,
  createRestCalibration,
  createRisingThreshold,
} from './smoothPressure';
import { isPressureReplayBuild } from '../config/pressureReplayFlag.js';
import {
  completeReplaySearch,
  installPressureReplayHook,
  markReplaySearchOpen,
  pushPressureReplayFrame,
  resetPressureReplaySession,
} from './replaySessionExport.js';
import { classifyReplayGaugeFrame } from './replayGaugeSemantics.js';
import { FLAIR_STATELESS_SESSION } from './canonicalDial.js';
import { loadOpenCv } from './opencvRuntime.js';

const STATUS_STYLES = {
  CALIBRATING: 'bg-amber-500/15 text-amber-100 border-amber-500/40',
  TRACKING: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
  UNCERTAIN: 'bg-amber-500/15 text-amber-100 border-amber-500/40',
  LOST: 'bg-rose-500/15 text-rose-200 border-rose-500/40',
};

const PRESSURE_LAB_BUILD = import.meta.env.VITE_PRESSURE_LAB_BUILD || 'dev';
const TRACE_PUBLISH_MS = 500;
const REPLAY_BUILD = isPressureReplayBuild();

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
  screenAngle: null,
  gaugeConfidence: null,
  orientationConfidence: null,
  gaugeRotation: null,
  gaugeHeld: false,
  gaugeX: null,
  gaugeY: null,
  gaugeRadius: null,
  poseQuality: null,
  poseRejectReason: null,
  posePending: false,
  trackMode: 'locked',
  searchFraction: null,
  reacquireHits: 0,
  reacquireRejectReason: null,
  reacquireAccepted: false,
  needleDecision: null,
  poseAge: null,
  uncertainty: 'calibrating',
  likeness: null,
  referenceCaptured: false,
  offScale: false,
  glareHint: null,
  moveCloserHint: null,
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

async function copyPlainText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // The clipboard API can reject without a focused document. The fallback below still tries.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

export function FlairPressureLab() {
  const ui = getAppTheme(true);
  const { videoRef, start, stop, status, error, trackInfo } = useFrontCameraStream();
  const [mirrorPreview, setMirrorPreview] = useState(!REPLAY_BUILD);
  const [sweepDeg, setSweepDeg] = useState(FLAIR_58_SCALE.sweepDeg);
  const [frameBox, setFrameBox] = useState({ w: 0, h: 0 });
  const [videoSize, setVideoSize] = useState(null);
  const [session, setSession] = useState(null);
  const [live, setLive] = useState(EMPTY_LIVE);

  const sessionRef = useRef(null);
  const sweepRef = useRef(sweepDeg);
  const mirrorRef = useRef(true);
  const videoSizeRef = useRef(null);
  const frameNodeRef = useRef(null);
  const qualityBridgeRef = useRef(createReadingBridge(1000));
  const readingHoldRef = useRef(createReadingHold());
  const shotRunRef = useRef(createShotRun());
  const restAnchorRef = useRef(createRestAnchor());
  const agreeSamplesRef = useRef([]);
  const qualityCanvasRef = useRef(null);
  const lastAngleRef = useRef(null);
  const angleTrackerRef = useRef(createAngleTracker());
  const kalmanRef = useRef(createNeedleKalman());
  const pressureRef = useRef(createPressureSmoother());
  const jitterRef = useRef(createAngleJitterTracker());
  const thresholdRef = useRef(createRisingThreshold(EXTRACTION_START_BAR));
  const calibRef = useRef(createRestCalibration());
  const trackerRef = useRef(createGaugeTracker());
  const historyRef = useRef(createDiagnosticHistory(
    REPLAY_BUILD ? { durationMs: 600_000 } : undefined,
  ));
  const poseAgeRef = useRef(0);
  const tracePublishRef = useRef(0);
  const resizeObserverRef = useRef(null);
  const copyTimerRef = useRef(null);
  const [trace, setTrace] = useState([]);
  const [copyNote, setCopyNote] = useState('');
  const [reportFallback, setReportFallback] = useState('');
  const [opencvReady, setOpencvReady] = useState(false);

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

  useEffect(() => () => {
    resizeObserverRef.current?.disconnect();
    clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    if (!REPLAY_BUILD) return undefined;
    installPressureReplayHook();
    window.__pressureLabVideoTrace = [];
    return () => {
      if (typeof window !== 'undefined') {
        delete window.__pressureLabReplay;
        delete window.__pressureLabVideoTrace;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    warmDiscoveryWorker();
    loadOpenCv()
      .then(() => {
        if (!cancelled) {
          setOpencvReady(true);
          if (REPLAY_BUILD && typeof window !== 'undefined') {
            window.__pressureLabOpenCvReady = true;
            window.__pressureLabProbeDiscovery = (imageData) => probeGaugeDiscoveryCandidates(imageData);
          }
        }
      })
      .catch((err) => {
        console.error('OpenCV.js failed to load', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);


  const resetReading = useCallback(({ clearHistory = false, clearTracker = true } = {}) => {
    sessionRef.current = null;
    lastAngleRef.current = null;
    calibRef.current.reset();
    angleTrackerRef.current.reset();
    kalmanRef.current.reset();
    pressureRef.current.reset();
    jitterRef.current.reset();
    thresholdRef.current.reset();
    poseAgeRef.current = 0;
    if (clearTracker) trackerRef.current.reset();
    qualityBridgeRef.current.reset();
    readingHoldRef.current.reset();
    shotRunRef.current.reset();
    restAnchorRef.current.reset();
    agreeSamplesRef.current = [];
    if (clearHistory) {
      historyRef.current.reset();
      setTrace([]);
    }
    setSession(null);
    setLive(EMPTY_LIVE);
  }, []);

  const handleStart = async () => {
    resetReading({ clearHistory: true, clearTracker: true });
    resetPressureReplaySession();
    await start();
  };

  useEffect(() => {
    if (!REPLAY_BUILD || !opencvReady) return undefined;
    let cancelled = false;
    // The fake camera starts when the track opens. Opening it before OpenCV
    // and the worker are warm makes the first processed frame depend on
    // page-load time, so two replays of a rotating clip are not the same.
    (async () => {
      await whenDiscoveryWarmed();
      if (cancelled) return;
      if (typeof window !== 'undefined') window.__pressureLabPipelineReady = true;
      resetReading({ clearHistory: true, clearTracker: true });
      resetPressureReplaySession();
      await start();
    })();
    return () => {
      cancelled = true;
    };
  }, [opencvReady, resetReading, start]);

  const handleStop = () => {
    stop();
    resetReading({ clearHistory: true, clearTracker: true });
    videoSizeRef.current = null;
    setVideoSize(null);
  };

  const handleRecalibrate = () => {
    if (status !== 'live') return;
    resetReading({ clearHistory: false, clearTracker: false });
  };

  const handleCopyReport = async () => {
    const size = videoSizeRef.current;
    const text = buildDiagnosticReport(historyRef.current.snapshot(), {
      timestamp: new Date(),
      cameraWidth: size?.w ?? null,
      cameraHeight: size?.h ?? null,
      calibrationStatus: sessionRef.current ? 'calibrated' : 'not calibrated',
      buildId: PRESSURE_LAB_BUILD,
      sweepDeg: sweepRef.current,
      minBar: FLAIR_58_SCALE.minBar,
      maxBar: FLAIR_58_SCALE.maxBar,
    });
    const copied = await copyPlainText(text);
    setReportFallback(copied ? '' : text);
    setCopyNote(copied ? 'Copied' : 'Copy failed');
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyNote(''), 2000);
  };

  const handleClearTrace = () => {
    historyRef.current.reset();
    setTrace([]);
    setCopyNote('');
    setReportFallback('');
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
    if (status !== 'live' || !opencvReady) return undefined;
    warmDiscoveryWorker();
    const canvas = qualityCanvasRef.current || document.createElement('canvas');
    qualityCanvasRef.current = canvas;
    let raf = 0;
    let last = 0;
    let processed = 0;
    let windowStart = performance.now();
    let fps = 0;

    const pushReplayFrame = (partial, sampleTime) => {
      if (!REPLAY_BUILD) return;
      pushPressureReplayFrame({
        t: sampleTime,
        gaugeFound: partial.gaugeFound === true,
        centreFromGuide: partial.centreFromGuide === true,
        centreX: partial.centreX ?? null,
        centreY: partial.centreY ?? null,
        radius: partial.radius ?? null,
        gaugeRotationDeg: partial.gaugeRotationDeg ?? null,
        needleAngleDeg: partial.needleAngleDeg ?? null,
        bar: partial.bar ?? null,
        confidence: partial.confidence ?? null,
        processMs: partial.processMs ?? null,
        e2eMs: partial.e2eMs ?? null,
        mainThreadMs: partial.mainThreadMs ?? null,
        cvMs: partial.cvMs ?? null,
        stageTrack: partial.stageTrack ?? null,
        stageTrackDraw: partial.stageTrackDraw ?? null,
        stageNeedle: partial.stageNeedle ?? null,
        stageNeedleDraw: partial.stageNeedleDraw ?? null,
        stageDiscovery: partial.stageDiscovery ?? null,
        stageTrackBlit: partial.stageTrackBlit ?? null,
        stageTrackRead: partial.stageTrackRead ?? null,
        stageTrackResize: partial.stageTrackResize ?? null,
        stageTrackOutput: partial.stageTrackOutput ?? null,
        discDrawMs: partial.discDrawMs ?? null,
        discWaitMs: partial.discWaitMs ?? null,
        workerSearchMs: partial.workerSearchMs ?? null,
        searchNeeded: partial.searchNeeded === true,
        postedSearch: partial.postedSearch === true,
        readWallMs: partial.readWallMs ?? null,
        readPath: partial.readPath ?? null,
        syncMs: partial.syncMs ?? null,
        flags: partial.flags ?? '',
        tracking: partial.tracking ?? null,
        conflictDeg: partial.conflictDeg ?? null,
      });
      if (partial.postedSearch) markReplaySearchOpen();
    };

    const replayGaugeLabels = (gauge) => classifyReplayGaugeFrame({
      gauge,
      referenceCaptured: gauge.referenceCaptured === true,
      dialRegistered: gauge.dialRegistered === true,
    });

    const processSample = async (video, now, wallNow, { grabAt = null } = {}) => {
      if (!video || video.readyState < 2) return;
      const grab = grabAt ?? performance.now();
      let readWall = 0;
      let cvDone = 0;
      const markCv = () => {
        cvDone = Math.max(0, performance.now() - grab);
      };
      const frameTiming = () => {
        // Blocking time from this grab until the result is applied. A worker
        // search posted here is added to e2e when that search finishes.
        const mainThreadMs = Math.max(0, performance.now() - grab);
        return {
          e2eMs: mainThreadMs,
          mainThreadMs,
          processMs: mainThreadMs,
          cvMs: cvDone,
          discDrawMs: 0,
          discWaitMs: 0,
          workerSearchMs: null,
          searchNeeded: lastReadProfile.searchNeeded === true,
          postedSearch: lastReadProfile.postedSearch === true,
          readWallMs: readWall,
          readPath: lastReadProfile.path || null,
          syncMs: lastReadProfile.syncMs || 0,
        };
      };
      let reading;
      try {
        const tRead = performance.now();
        reading = readTrackedGauge(video, canvas, null, trackerRef.current);
        readWall = performance.now() - tRead;
      } catch (err) {
        restAnchorRef.current.reset();
        agreeSamplesRef.current = [];
        if (REPLAY_BUILD) {
          pushReplayFrame({
            gaugeFound: false,
            centreFromGuide: false,
            flags: `error:${err?.message || 'read'}`,
            tracking: 'LOST',
            ...frameTiming(),
          }, now);
        }
        return;
      }
      if (!reading?.gauge) {
        // A lost face must not keep a confirmed zero. The next lock confirms again.
        restAnchorRef.current.reset();
        agreeSamplesRef.current = [];
        if (REPLAY_BUILD) {
          pushReplayFrame({
            gaugeFound: false,
            centreFromGuide: false,
            flags: 'no-gauge',
            tracking: 'LOST',
            ...frameTiming(),
          }, now);
        }
        return;
      }

      processed += 1;
      if (wallNow - windowStart >= 1000) {
        fps = processed;
        processed = 0;
        windowStart = wallNow;
      }

      const gauge = reading.gauge;
      const frame = { w: reading.videoWidth, h: reading.videoHeight };
      const poseMoved = gauge.reacquireAccepted === true
        || (gauge.poseDeltaPx ?? 0) >= 1
        || Math.abs(gauge.poseDeltaRot ?? 0) >= 1;
      poseAgeRef.current = poseMoved ? 0 : poseAgeRef.current + 1;
      const candidateAngle = reading.relativeAngleDeg ?? null;
      const secondCandidateAngle = reading.secondAngleDeg == null
        ? null
        : wrap360(reading.secondAngleDeg - gauge.rotationDeg);
      const record = (partial) => {
        const acceptedAngle = partial.acceptedAngle ?? null;
        const uncertainty = uncertaintyReason({
          calibrated: Boolean(sessionRef.current),
          tracking: partial.tracking,
          gaugeHeld: gauge.held === true,
          flipHeld: partial.flipHeld === true,
          weak: partial.weakNeedle === true,
          offScale: partial.offScale === true,
          needleDecision: partial.needleDecision ?? null,
          jitterDeg: partial.jitterDeg ?? 0,
        });
        historyRef.current.push({
          t: Date.now(),
          rawAngle: reading.angleDeg,
          relativeAngle: reading.relativeAngleDeg,
          smoothedAngle: partial.smoothedAngle ?? null,
          pressure: partial.pressure ?? null,
          rawPressure: partial.rawPressure ?? null,
          pressureMeasured: partial.pressureMeasured === true,
          tracking: partial.tracking,
          needleVisible: partial.needleVisible === true,
          gaugeHeld: gauge.held === true,
          flipHeld: partial.flipHeld === true,
          weakNeedle: partial.weakNeedle === true,
          angleAccepted: partial.angleAccepted === true,
          gaugeX: gauge.cx,
          gaugeY: gauge.cy,
          rawGaugeX: gauge.rawCx,
          rawGaugeY: gauge.rawCy,
          gaugeRotation: gauge.rotationDeg,
          rawRotation: gauge.rawRotationDeg,
          gaugeRadius: gauge.radius,
          rawGaugeRadius: gauge.rawRadius ?? null,
          quality: reading.quality,
          gaugeConfidence: gauge.confidence,
          orientationConfidence: gauge.orientationConfidence,
          candidateAngle,
          candidateScore: reading.peak ?? null,
          secondCandidateAngle,
          secondCandidateScore: reading.second ?? null,
          candidateDelta: acceptedAngle == null || candidateAngle == null
            ? null
            : Math.abs(wrapDelta(acceptedAngle, candidateAngle)),
          candidateMargin: reading.margin ?? null,
          candidateLikeness: reading.likeness ?? null,
          candidateInnerReach: reading.innerReach ?? null,
          candidateCoverage: reading.coverage ?? null,
          candidateContinuity: reading.continuity ?? null,
          candidateStartRadius: reading.startRadius ?? null,
          candidateProbePx: reading.probePx ?? null,
          poseQuality: gauge.poseQuality ?? null,
          poseRejectReason: gauge.poseRejectReason ?? null,
          posePending: gauge.posePending === true,
          pressureHold: gauge.pressureHold === true,
          narrowOk: gauge.narrowOk ?? null,
          needleAgrees: gauge.needleAgrees ?? null,
          estimateBin: gauge.estimateBin ?? null,
          storedBin: gauge.storedBin ?? null,
          incrementBins: gauge.incrementBins ?? null,
          poseDecision: gauge.poseDecision ?? null,
          anchorAccumDeg: gauge.anchorAccumDeg ?? null,
          poseDeltaPx: gauge.poseDeltaPx ?? null,
          poseDeltaRot: gauge.poseDeltaRot ?? null,
          trackMode: gauge.trackMode || 'locked',
          searchFraction: gauge.searchFraction ?? null,
          reacquireCx: gauge.reacquireCx ?? null,
          reacquireCy: gauge.reacquireCy ?? null,
          reacquireRadius: gauge.reacquireRadius ?? null,
          reacquireRotation: gauge.reacquireRotation ?? null,
          reacquireQuality: gauge.reacquireQuality ?? null,
          reacquireHits: gauge.reacquireHits ?? 0,
          reacquireRejectReason: gauge.reacquireRejectReason ?? null,
          reacquireAccepted: gauge.reacquireAccepted === true,
          needleDecision: partial.needleDecision ?? null,
          confirmationHits: partial.confirmationHits ?? 0,
          candidateJump: partial.candidateJump ?? null,
          poseAge: partial.poseAge ?? null,
          uncertaintyReason: uncertainty,
        });
        if (tracePublishRef.current === 0 || now - tracePublishRef.current >= TRACE_PUBLISH_MS) {
          tracePublishRef.current = now;
          setTrace(historyRef.current.snapshot());
        }
        return uncertainty;
      };

      const gaugeFields = {
        screenAngle: reading.angleDeg,
        rawAngle: reading.relativeAngleDeg,
        quality: reading.quality,
        fps,
        frame,
        gaugeConfidence: gauge.confidence,
        orientationConfidence: gauge.orientationConfidence,
        gaugeRotation: gauge.rotationDeg,
        gaugeHeld: gauge.held,
        gaugeX: gauge.cx,
        gaugeY: gauge.cy,
        gaugeRadius: gauge.radius,
        poseQuality: gauge.poseQuality ?? null,
        poseRejectReason: gauge.poseRejectReason ?? null,
        posePending: gauge.posePending === true,
        trackMode: gauge.trackMode || 'locked',
        searchFraction: gauge.searchFraction ?? null,
        reacquireHits: gauge.reacquireHits ?? 0,
        reacquireRejectReason: gauge.reacquireRejectReason ?? null,
        reacquireAccepted: gauge.reacquireAccepted === true,
        likeness: reading.likeness ?? null,
        referenceCaptured: gauge.referenceCaptured === true,
        poseAge: poseAgeRef.current,
      };

      const frameQualityForAnchor = reading.frameQuality ?? { ok: true, flags: [] };
      if (gauge.dialRegistered !== true) {
        restAnchorRef.current.reset();
        agreeSamplesRef.current = [];
      }
      restAnchorRef.current.push({
        timeMs: now,
        angleDeg: reading.relativeAngleDeg,
        usable: gauge.dialRegistered === true
          && frameQualityForAnchor.ok
          && (reading.likeness ?? 0) >= NEEDLE_LIKENESS_GATE,
      });
      const gate = {
        dialRegistered: gauge.dialRegistered,
        confidence: gauge.confidence,
        dialFaceScore: gauge.dialFaceScore,
        needleLikeness: reading.likeness,
        periodMargin: gauge.periodMargin,
        restAnchor: restAnchorRef.current.status(),
      };
      const canRead = gaugeAllowsReading(gate);
      const confidentDial = gaugeAllowsConfidentReading(gate);

      if (!sessionRef.current) {
        if (!canRead || gauge.held) {
          const uncertainty = record({
            tracking: 'CALIBRATING',
            smoothedAngle: null,
            pressure: null,
            rawPressure: null,
            pressureMeasured: false,
            needleVisible: false,
            flipHeld: false,
            weakNeedle: reading.quality == null || reading.quality < NEEDLE_LOST_QUALITY,
            angleAccepted: false,
            acceptedAngle: null,
            needleDecision: 'calibrating',
            confirmationHits: 0,
            candidateJump: null,
            poseAge: poseAgeRef.current,
          });
          const preShotGlare = glareSetupHintVisible({
            glare: frameQualityForAnchor.flags.includes('glare'),
            shotRunning: shotRunRef.current.running(),
          });
          const preShotClose = moveCloserHintVisible({
            tooSmall: gaugeTooSmallForNeedle(gauge.radius, minReadableDialRadiusPx()),
            shotRunning: shotRunRef.current.running(),
          });
          const labels = REPLAY_BUILD ? replayGaugeLabels(gauge) : null;
          const qualityFlags = frameQualityForAnchor.ok ? '' : `|${frameQualityForAnchor.flags.join('|')}`;
          const hintFlag = `${preShotGlare ? '|glare-hint' : ''}${preShotClose ? '|move-closer' : ''}`;
          markCv();
          setLive({
            ...EMPTY_LIVE,
            ...gaugeFields,
            tracking: 'CALIBRATING',
            calibCount: 0,
            needleDecision: 'calibrating',
            uncertainty,
            offScale: false,
            glareHint: preShotGlare ? GLARE_SETUP_HINT : null,
            moveCloserHint: preShotClose ? MOVE_CLOSER_HINT : null,
          });
          if (REPLAY_BUILD) {
            pushReplayFrame({
              gaugeFound: labels.gaugeFound,
              centreFromGuide: labels.centreFromGuide,
              centreX: gauge.cx,
              centreY: gauge.cy,
              radius: gauge.radius,
              gaugeRotationDeg: gauge.rotationDeg,
              needleAngleDeg: null,
              bar: null,
              confidence: gauge.confidence,
              conflictDeg: gauge.dialRegistered ? templateConflictDeg(reading.relativeAngleDeg) : null,
              flags: `CALIBRATING|0|reg:${gauge.dialRegistered ? 'yes' : 'no'}|rim:${gauge.confidence?.toFixed(3) ?? 'na'}|like:${reading.likeness?.toFixed(3) ?? 'na'}|end:${reading.needleEnd || 'na'}${qualityFlags}${hintFlag}`,
              tracking: 'CALIBRATING',
              stageTrack: reading.stageMs?.track ?? null,
              stageTrackDraw: reading.stageMs?.trackDraw ?? null,
              stageNeedle: reading.stageMs?.needle ?? null,
              stageNeedleDraw: reading.stageMs?.needleDraw ?? null,
              stageDiscovery: reading.stageMs?.discovery ?? null,
              stageTrackBlit: reading.stageMs?.trackBlit ?? null,
              stageTrackRead: reading.stageMs?.trackRead ?? null,
              stageTrackResize: reading.stageMs?.trackResize ?? null,
              stageTrackOutput: reading.stageMs?.trackOutput ?? null,
              ...frameTiming(),
            }, now);
          }
          return;
        }
        const next = {
          ...FLAIR_STATELESS_SESSION,
          sweepDeg: sweepRef.current,
        };
        sessionRef.current = next;
        setSession(next);
        lastAngleRef.current = null;
        angleTrackerRef.current.reset();
        kalmanRef.current.reset();
        pressureRef.current.reset();
        jitterRef.current.reset();
        thresholdRef.current.reset();
      }

      const choice = selectForwardAngle({
        angleDeg: reading.relativeAngleDeg,
        peak: reading.peak,
        oppositeScore: reading.oppositeScore,
        previousAngle: lastAngleRef.current,
      });
      const frameQuality = reading.frameQuality ?? { ok: true, flags: [] };
      const weak = reading.quality == null || reading.quality < NEEDLE_LOST_QUALITY;
      // After the anchor has confirmed, a needle under the likeness gate is
      // still a reading. Confidence stays low until the gate is met.
      const softNeedle = Boolean(sessionRef.current)
        && gauge.dialRegistered === true
        && (reading.likeness ?? 0) >= NEEDLE_LIKENESS_GATE * 0.5;
      const qualityBlocked = !frameQuality.ok;
      const glareHidden = frameQuality.flags.includes('glare');
      // A registered dial keeps its last bar through blur and glare even when
      // the face score dips. A template conflict still publishes nothing.
      const coastQuality = qualityBlocked
        && gauge.dialRegistered === true
        && restAnchorRef.current.status() !== 'conflict'
        && !gauge.held
        && !gauge.pressureHold
        && !choice.held;
      const blockSample = gauge.held || gauge.pressureHold || choice.held || weak || qualityBlocked
        || (!canRead && !softNeedle);
      const candidateJump = lastAngleRef.current == null || choice.angleDeg == null
        ? null
        : wrapDelta(lastAngleRef.current, choice.angleDeg);
      let rawBar = null;
      let offScale = false;
      let signalPaused = true;
      let signal = thresholdRef.current.get();
      let tracked = { angle: lastAngleRef.current, accepted: false, pendingHits: 0, heldReason: null };
      let needleDecision;
      let predicted = false;
      const applyKalmanBar = (km) => {
        if (km?.angle == null) return false;
        rawBar = angleToBar(km.angle, sessionRef.current);
        if (rawBar == null) {
          offScale = true;
          return false;
        }
        return true;
      };
      if (!blockSample && choice.angleDeg != null) {
        tracked = angleTrackerRef.current.push(choice.angleDeg, {
          quality: reading.quality,
          likeness: reading.likeness,
          poseSnap: gauge.reacquireAccepted === true,
          hub: reading.hub,
        });
        needleDecision = tracked.accepted ? 'accepted' : (tracked.heldReason || 'held');
        if (tracked.accepted && tracked.angle != null) {
          const km = kalmanRef.current.push(tracked.angle, now, {
            confidence: reading.quality,
            accept: true,
          });
          lastAngleRef.current = km.angle ?? tracked.angle;
          tracked = { ...tracked, angle: lastAngleRef.current };
          if (applyKalmanBar(km)) {
            const smoothed = pressureRef.current.push(rawBar);
            signal = thresholdRef.current.push(smoothed, Date.now());
            signalPaused = false;
          }
        } else if (tracked.heldReason === 'hub' || !tracked.accepted) {
          // A ray that misses the pivot, or a jump that is not confirmed,
          // may keep the last angle when it still agrees. It does not publish
          // its own angle.
          const km = kalmanRef.current.push(choice.angleDeg, now, {
            confidence: reading.quality ?? 0,
            accept: false,
            soft: true,
          });
          if (applyKalmanBar(km)) {
            predicted = true;
            needleDecision = km.gap ? 'hub' : 'coast';
          }
        } else {
          const km = kalmanRef.current.push(null, now);
          if (applyKalmanBar(km) && km.predicted) {
            predicted = true;
            needleDecision = 'coast';
          }
        }
      } else if (coastQuality || (!gauge.held && !gauge.pressureHold && !choice.held && canRead && weak)) {
        // Blur and a weak ray do not get to move the needle. A measurement
        // that still agrees can hold the last angle. Glare does not refresh
        // that hold: hidden for more than about a second is a gap.
        angleTrackerRef.current.push(null);
        const km = choice.angleDeg != null
          ? kalmanRef.current.push(choice.angleDeg, now, {
            confidence: reading.quality ?? 0,
            accept: false,
            soft: true,
            extend: !glareHidden,
          })
          : kalmanRef.current.push(null, now);
        if (applyKalmanBar(km) && !km.gap) {
          predicted = true;
          needleDecision = km.predicted ? 'coast' : 'soft';
        } else if (qualityBlocked) {
          needleDecision = `gap-${frameQuality.flags.join('-') || 'quality'}`;
        } else {
          needleDecision = 'gap-weak';
        }
      } else {
        angleTrackerRef.current.push(null);
        kalmanRef.current.push(null, now);
        if (gauge.held) needleDecision = 'held-gauge';
        else if (gauge.pressureHold) needleDecision = 'held-pose';
        else if (choice.held) needleDecision = 'held-flip';
        else if (qualityBlocked) needleDecision = `held-${frameQuality.flags.join('-') || 'quality'}`;
        else needleDecision = 'held-weak';
      }
      const jitter = jitterRef.current.push(tracked.accepted ? tracked.angle : lastAngleRef.current);
      qualityBridgeRef.current.publish(
        pressureRef.current.get(),
        !blockSample && tracked.accepted && !predicted,
        now,
      );
      const tracking = classifyTrackingStatus({
        calibrated: true,
        quality: reading.quality,
        jitterDeg: jitter,
        accepted: Boolean(tracked.accepted) && !blockSample && !predicted,
        heldFlip: choice.held || tracked.rejectedFlip,
        gaugeHeld: gauge.held,
        offScale,
      });
      const screenSmoothed = tracked.angle == null ? null : wrap360(tracked.angle + gauge.rotationDeg);
      const pressureMeasured = !predicted && !blockSample && rawBar != null && Boolean(tracked.accepted);
      const freshSighting = rawBar != null
        && !gauge.held
        && !choice.held
        && !glareHidden
        && reading.relativeAngleDeg != null
        && (reading.likeness ?? 0) >= NEEDLE_LIKENESS_GATE;
      const gated = readingHoldRef.current.push({ bar: rawBar, fresh: freshSighting, now });
      const pressureBar = gated.bar;
      const shotRunning = shotRunRef.current.push(pressureMeasured ? rawBar : null);
      const showGlareHint = glareSetupHintVisible({
        glare: frameQuality.flags.includes('glare'),
        shotRunning,
      });
      const showMoveCloser = moveCloserHintVisible({
        tooSmall: gaugeTooSmallForNeedle(gauge.radius, minReadableDialRadiusPx()),
        shotRunning,
      });
      const needleSure = (reading.quality ?? 0) >= NEEDLE_TRACK_QUALITY;
      // Half the hub samples is a tie, not a needle. A streak that only ties
      // the pivot check still gets a bar, at low confidence.
      const hubSure = reading.hub == null || reading.hub > HUB_CONNECTION_MIN;
      if (
        gauge.dialRegistered
        && (reading.likeness ?? 0) >= NEEDLE_LIKENESS_GATE
        && (reading.hub == null || reading.hub > HUB_CONNECTION_MIN)
        && reading.relativeAngleDeg != null
      ) {
        agreeSamplesRef.current.push({ timeMs: now, angleDeg: reading.relativeAngleDeg });
        const agreeCutoff = now - REST_ANCHOR_MS - PROCESS_INTERVAL_MS;
        agreeSamplesRef.current = agreeSamplesRef.current.filter((sample) => sample.timeMs >= agreeCutoff);
      }
      const angleAgrees = confidentAngleWindow(agreeSamplesRef.current, now);
      let publishedConfidence = !predicted && pressureMeasured && needleSure && hubSure && confidentDial && angleAgrees
        ? gauge.confidence
        : Math.min(gauge.confidence ?? 0, NEEDLE_LOST_QUALITY);
      if (gated.held || gated.gap) {
        publishedConfidence = Math.min(publishedConfidence ?? 0, NEEDLE_LOST_QUALITY);
      }
      const uncertainty = record({
        tracking,
        smoothedAngle: tracked.angle,
        pressure: pressureBar,
        rawPressure: pressureMeasured ? rawBar : null,
        pressureMeasured,
        needleVisible: tracked.angle != null && (tracking === 'TRACKING' || tracking === 'UNCERTAIN'),
        flipHeld: Boolean(choice.held || tracked.rejectedFlip),
        weakNeedle: weak,
        offScale,
        angleAccepted: Boolean(tracked.accepted) && !blockSample,
        acceptedAngle: tracked.angle,
        needleDecision,
        confirmationHits: tracked.pendingHits ?? 0,
        candidateJump,
        poseAge: poseAgeRef.current,
        jitterDeg: jitter,
      });
      markCv();
      setLive({
        tracking,
        displayBar: tracking === 'TRACKING' || tracking === 'UNCERTAIN' ? pressureBar : null,
        pressureBar,
        rawBar,
        smoothedAngle: tracked.angle,
        ...gaugeFields,
        displayAngle: screenSmoothed,
        fps,
        frame,
        accepted: tracked.accepted && !blockSample && !offScale,
        signal,
        signalPaused,
        jitter,
        calibCount: REST_STABLE_SAMPLES,
        flipHeld: Boolean(choice.held || tracked.rejectedFlip),
        needleDecision,
        uncertainty,
        offScale,
        corrected: choice.corrected,
        glareHint: showGlareHint ? GLARE_SETUP_HINT : null,
        moveCloserHint: showMoveCloser ? MOVE_CLOSER_HINT : null,
      });
      if (REPLAY_BUILD) {
        const labels = replayGaugeLabels(gauge);
        const flagParts = [tracking, needleDecision].filter(Boolean);
        if (gauge.held) flagParts.push('gauge-held');
        if (weak) flagParts.push('weak-needle');
        if (!frameQuality.ok) flagParts.push(...frameQuality.flags);
        if (showGlareHint) flagParts.push('glare-hint');
        if (showMoveCloser) flagParts.push('move-closer');
        if (gated.held) flagParts.push('reading-held');
        if (gated.expired) flagParts.push('reading-gap');
        if (shotRunning) flagParts.push('shot');
        pushReplayFrame({
          gaugeFound: labels.gaugeFound,
          centreFromGuide: labels.centreFromGuide,
          centreX: gauge.cx,
          centreY: gauge.cy,
          radius: gauge.radius,
          gaugeRotationDeg: gauge.rotationDeg,
          needleAngleDeg: tracked.angle,
          bar: pressureBar,
          holdMs: gated.holdMs,
          confidence: publishedConfidence,
          conflictDeg: gauge.dialRegistered ? templateConflictDeg(reading.relativeAngleDeg) : null,
          flags: `${flagParts.join('|')}|ref:${gauge.referenceCaptured ? 'yes' : 'no'}|rim:${gauge.confidence?.toFixed(3) ?? 'na'}|like:${reading.likeness?.toFixed(3) ?? 'na'}|end:${reading.needleEnd || 'na'}|hub:${reading.hub == null ? 'na' : reading.hub.toFixed(2)}`,
          tracking,
          stageTrack: reading.stageMs?.track ?? null,
          stageTrackDraw: reading.stageMs?.trackDraw ?? null,
          stageNeedle: reading.stageMs?.needle ?? null,
          stageNeedleDraw: reading.stageMs?.needleDraw ?? null,
          stageDiscovery: reading.stageMs?.discovery ?? null,
          stageTrackBlit: reading.stageMs?.trackBlit ?? null,
          stageTrackRead: reading.stageMs?.trackRead ?? null,
          stageTrackResize: reading.stageMs?.trackResize ?? null,
          stageTrackOutput: reading.stageMs?.trackOutput ?? null,
          ...frameTiming(),
        }, now);
      }
    };

    const tick = (wallNow) => {
      raf = requestAnimationFrame(tick);
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      if (wallNow - last < PROCESS_INTERVAL_MS) return;
      last = wallNow;
      void processSample(video, wallNow, wallNow);
    };

    if (!REPLAY_BUILD) {
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }

    // Read stills taken at each slot. A live camera or a seek lands on a
    // different picture from run to run, so two replays diverged.
    let stopped = false;
    window.__pressureReplayDrained = false;
    const frameCount = Number(window.__pressureReplayFrameCount) || 0;
    const frameBase = window.__pressureReplayFrameBase || '';
    const untilS = Number(window.__pressureReplayUntilS) || 0;
    const slot = PROCESS_INTERVAL_MS / 1000;
    const chart = document.createElement('canvas');
    chart.width = 280;
    chart.height = 72;
    const chartCtx = chart.getContext('2d');
    let chartRaf = 0;
    let lastChart = 0;
    let scaleTicks = 0;
    let longTasks = 0;
    let harnessLongTasks = 0;
    let appLongTasks = 0;
    let longTaskMax = 0;
    let loopStart = 0;
    const longTaskDurations = [];
    const searchDurations = [];
    let countLongTasks = false;
    let taskPhase = 'app';
    setDiscoverySearchListener((searchMs) => {
      searchDurations.push(searchMs);
      completeReplaySearch(searchMs);
    });
    let slots = 0;
    const drawChart = (now) => {
      chartRaf = requestAnimationFrame(drawChart);
      if (now - lastChart < 1000 / 30) return;
      lastChart = now;
      chartCtx.clearRect(0, 0, chart.width, chart.height);
      chartCtx.beginPath();
      chartCtx.strokeStyle = '#c45c26';
      for (let i = 0; i < 40; i += 1) {
        const y = 36 + Math.sin((scaleTicks + i) * 0.35) * 24;
        if (i === 0) chartCtx.moveTo(i * 7, y);
        else chartCtx.lineTo(i * 7, y);
      }
      chartCtx.stroke();
    };
    chartRaf = requestAnimationFrame(drawChart);
    const scaleTimer = setInterval(() => {
      scaleTicks += 1;
      window.__pressureReplayScale = scaleTicks;
    }, 100);
    let longTaskObserver = null;
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          if (!countLongTasks) return;
          for (const entry of list.getEntries()) {
            // A task that started while the stills were loading is not the frame loop.
            if (loopStart && entry.startTime < loopStart) continue;
            longTasks += 1;
            if (taskPhase === 'harness') harnessLongTasks += 1;
            else appLongTasks += 1;
            if (entry.duration > longTaskMax) longTaskMax = entry.duration;
            if (longTaskDurations.length < 8) longTaskDurations.push(Math.round(entry.duration));
          }
        });
        longTaskObserver.observe({ type: 'longtask', buffered: false });
      } catch {
        longTaskObserver = null;
      }
    }
    window.__pressureReplaySmoothness = () => ({
      longTasks,
      harnessLongTasks,
      appLongTasks,
      longTaskMax,
      longTaskDurations,
      searchDurations: searchDurations.slice(),
      scaleTicks,
      slots,
    });
    const loadFrame = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('replay frame failed to load'));
      img.src = src;
    });
    const run = async () => {
      if (!frameBase || frameCount < 1 || untilS <= 0) {
        window.__pressureReplayError = 'replay frames missing';
        return;
      }
      try {
        const stills = [];
        for (let index = 4; !stopped; index += 1) {
          const t = index * slot;
          if (t >= untilS) break;
          const fileIndex = (index % frameCount) + 1;
          const name = String(fileIndex).padStart(4, '0');
          const img = await loadFrame(`${frameBase}${name}.png`);
          if (stopped) return;
          stills.push({ t, img });
        }
        // The fake camera keeps decoding beside the stills and stalls the crop read.
        // PNG decode stays outside the measured loop. A live frame is already decoded.
        const liveVideo = videoRef.current;
        liveVideo?.pause?.();
        liveVideo?.srcObject?.getTracks?.().forEach((track) => track.stop());
        const hold = document.createElement('canvas');
        const frame = document.createElement('canvas');
        let frameCtx = null;
        loopStart = performance.now();
        countLongTasks = true;
        for (const still of stills) {
          if (stopped) return;
          const img = still.img;
          if (hold.width !== img.naturalWidth || hold.height !== img.naturalHeight) {
            hold.width = img.naturalWidth;
            hold.height = img.naturalHeight;
            frame.width = hold.width;
            frame.height = hold.height;
            frame.videoWidth = frame.width;
            frame.videoHeight = frame.height;
            frame.readyState = 4;
            frameCtx = frame.getContext('2d', { willReadFrequently: true });
          }
          const holdCtx = hold.getContext('2d', { willReadFrequently: true });
          // Still install is the harness. Split it so a full-frame read is not
          // one long task, and keep those tasks out of the app count.
          taskPhase = 'harness';
          holdCtx.drawImage(img, 0, 0);
          await new Promise((resolve) => { setTimeout(resolve, 0); });
          const installed = holdCtx.getImageData(0, 0, hold.width, hold.height);
          await new Promise((resolve) => { setTimeout(resolve, 0); });
          frameCtx.putImageData(installed, 0, 0);
          await new Promise((resolve) => { setTimeout(resolve, 0); });
          taskPhase = 'app';
          // Same path as the live camera: grab, post a search if this frame
          // needs one, and apply whatever circle is already back. Do not wait.
          // The live tick also leaves PROCESS_INTERVAL_MS between reads, which
          // is long enough for the search to finish before the next frame.
          const grabAt = performance.now();
          slots += 1;
          window.__pressureReplaySlots = slots;
          await processSample(frame, Math.round(still.t * 1000), performance.now(), { grabAt });
          const remain = PROCESS_INTERVAL_MS - (performance.now() - grabAt);
          if (remain > 0) await new Promise((resolve) => { setTimeout(resolve, remain); });
        }
        // The last search can still be running. Record it before the harness reads the rows.
        await whenDiscoverySettled();
        if (!stopped) window.__pressureReplayDrained = true;
      } catch (err) {
        window.__pressureReplayError = err?.message || 'replay frames failed';
      }
    };
    run();
    return () => {
      stopped = true;
      countLongTasks = false;
      setDiscoverySearchListener(null);
      clearInterval(scaleTimer);
      cancelAnimationFrame(chartRaf);
      longTaskObserver?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [status, videoRef, opencvReady]);

  const stability = stabilityStats(trace);
  const formatPair = (step, spread, digits, unit) => {
    if (step == null && spread == null) return '—';
    const left = step == null ? '—' : Number(step).toFixed(digits);
    const right = spread == null ? '—' : Number(spread).toFixed(digits);
    return `${left} / ${right}${unit}`;
  };
  const detectedOverlay = videoSize && frameBox.w && live.gaugeX != null && live.gaugeY != null && live.gaugeRadius != null
    ? videoPointToPreview(live.gaugeX, live.gaugeY, videoSize.w, videoSize.h, frameBox.w, frameBox.h, mirrorPreview)
    : null;
  const overlayMap = videoSize && frameBox.w ? objectCoverMap(videoSize.w, videoSize.h, frameBox.w, frameBox.h) : null;
  const overlayRadiusPx = overlayMap && live.gaugeRadius != null ? live.gaugeRadius * overlayMap.scale : null;
  const cameraLive = status === 'live';
  const showNeedle = cameraLive && Boolean(session) && live.displayAngle != null && (live.tracking === 'TRACKING' || live.tracking === 'UNCERTAIN');
  const needleAngle = previewAngleDeg(live.displayAngle, mirrorPreview);
  const needleRad = ((needleAngle ?? 0) * Math.PI) / 180;
  const badge = cameraLive ? live.tracking : 'CALIBRATING';
  const pressureText = cameraLive && live.displayBar != null ? live.displayBar.toFixed(1) : '—';
  const caption = !cameraLive
    ? 'Start the front camera with the whole gauge in frame.'
    : !session
      ? `At rest. Calibrating ${live.calibCount}/${REST_STABLE_SAMPLES}`
      : live.tracking === 'TRACKING'
        ? 'Ready'
        : live.gaugeHeld
          ? 'Gauge lost. Holding the last pressure.'
      : live.flipHeld
        ? 'Rejected a needle flip. Holding the last pressure.'
        : live.offScale
          ? 'Needle is off the printed scale. Holding the last pressure.'
          : live.tracking === 'LOST'
              ? 'Needle lost.'
              : 'Reading is unsteady. Holding the last pressure.';

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
          <li>Put the phone where the whole gauge stays in frame. Beside the Flair is fine. Small movement is ok.</li>
          <li>The lab finds the dial automatically — no guide ring. The overlay shows the detected circle and needle.</li>
          <li>At rest, calibration starts on its own once the needle is steady.</li>
        </ol>
        <p className={`text-xs ${ui.muted}`}>Nothing is saved. A large or sudden move drops tracking and holds the last pressure until the gauge is found again.</p>

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
          {detectedOverlay && overlayRadiusPx != null && overlayRadiusPx > 4 && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: detectedOverlay.x - overlayRadiusPx,
                top: detectedOverlay.y - overlayRadiusPx,
                width: overlayRadiusPx * 2,
                height: overlayRadiusPx * 2,
              }}
            >
              <div className="absolute inset-0 border-2 border-[#c88a4b]/90 rounded-full" />
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
            {session ? 'Tracking detected dial' : 'Searching for gauge…'}
          </p>
        </div>

        <div className={`${ui.cardInset} rounded-2xl p-5 text-center`}>
          {cameraLive && live.moveCloserHint ? (
            <p className="text-sm font-semibold text-amber-50 bg-amber-500/20 border border-amber-300/50 rounded-xl px-3 py-2 mb-3">
              {live.moveCloserHint}
            </p>
          ) : null}
          {cameraLive && live.glareHint ? (
            <p className="text-sm font-semibold text-amber-50 bg-amber-500/20 border border-amber-300/50 rounded-xl px-3 py-2 mb-3">
              {live.glareHint}
            </p>
          ) : null}
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
            <dt>Gauge center</dt>
            <dd className={ui.text}>{live.gaugeX != null ? `${formatNum(live.gaugeX, 0)}, ${formatNum(live.gaugeY, 0)} px` : '—'}</dd>
            <dt>Screen angle</dt>
            <dd className={ui.text}>{formatNum(live.screenAngle, 0)}°</dd>
            <dt>Relative angle</dt>
            <dd className={ui.text}>{formatNum(live.rawAngle, 1)}°</dd>
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
            <dt>Build</dt>
            <dd className={ui.text}>{PRESSURE_LAB_BUILD}</dd>
            <dt>Scale</dt>
            <dd className={ui.text}>{FLAIR_58_SCALE.minBar}-{FLAIR_58_SCALE.maxBar} bar / {sweepDeg}°</dd>
            <dt>Uncertainty</dt>
            <dd className={ui.text}>{live.uncertainty || '—'}</dd>
            <dt>Pose age</dt>
            <dd className={ui.text}>{live.poseAge == null ? '—' : live.poseAge}</dd>
            <dt>Needle decision</dt>
            <dd className={ui.text}>{live.needleDecision || '—'}</dd>
            <dt>Calibration</dt>
            <dd className={ui.text}>{live.calibCount}/{REST_STABLE_SAMPLES}</dd>
            <dt>Needle likeness</dt>
            <dd className={ui.text}>{formatNum(live.likeness, 2)}</dd>
            <dt>Dial reference</dt>
            <dd className={ui.text}>{live.referenceCaptured ? 'yes' : 'no'}</dd>
            <dt>Edge quality</dt>
            <dd className={ui.text}>{formatNum(live.quality, 3)}</dd>
            <dt>Tail corrected</dt>
            <dd className={ui.text}>{live.corrected ? 'yes' : 'no'}</dd>
            <dt>Flip held</dt>
            <dd className={ui.text}>{live.flipHeld ? 'yes' : 'no'}</dd>
            <dt>Gauge follow</dt>
            <dd className={ui.text}>{!cameraLive || live.gaugeX == null ? '—' : live.gaugeHeld ? 'held' : 'following'}</dd>
            <dt>Gauge centre</dt>
            <dd className={ui.text}>{live.gaugeX == null ? '—' : `${Math.round(live.gaugeX)}, ${Math.round(live.gaugeY)}`}</dd>
            <dt>Gauge rotation</dt>
            <dd className={ui.text}>{formatNum(live.gaugeRotation, 1)}°</dd>
            <dt>Pose quality</dt>
            <dd className={ui.text}>{formatNum(live.poseQuality, 2)}</dd>
            <dt>Pose decision</dt>
            <dd className={ui.text}>{live.poseRejectReason || (live.poseQuality == null && !live.gaugeHeld ? '—' : (live.gaugeHeld ? 'held' : 'accepted'))}</dd>
            <dt>Pose pending</dt>
            <dd className={ui.text}>{live.posePending ? 'yes' : 'no'}</dd>
            <dt>Track mode</dt>
            <dd className={ui.text}>{live.trackMode || '—'}</dd>
            <dt>Search window</dt>
            <dd className={ui.text}>{live.searchFraction == null ? '—' : `${Number(live.searchFraction).toFixed(2)}×`}</dd>
            <dt>Reacquire hits</dt>
            <dd className={ui.text}>{live.reacquireHits ?? '—'}</dd>
            <dt>Reacquire</dt>
            <dd className={ui.text}>{live.reacquireAccepted ? 'accepted' : (live.reacquireRejectReason || '—')}</dd>
            <dt>Gauge confidence</dt>
            <dd className={ui.text}>{formatNum(live.gaugeConfidence, 2)}</dd>
            <dt>Orientation score</dt>
            <dd className={ui.text}>{formatNum(live.orientationConfidence, 2)}</dd>
            <dt>Jitter</dt>
            <dd className={ui.text}>{formatNum(live.jitter, 1)}°</dd>
            <dt>Centre Δ / σ</dt>
            <dd className={ui.text}>{formatPair(stability.centreDelta, stability.centreStd, 2, ' px')}</dd>
            <dt>Detector centre Δ / σ</dt>
            <dd className={ui.text}>{formatPair(stability.detectorCentreDelta, stability.detectorCentreStd, 2, ' px')}</dd>
            <dt>Rotation Δ / σ</dt>
            <dd className={ui.text}>{formatPair(stability.rotationDelta, stability.rotationStd, 2, '°')}</dd>
            <dt>Detector rotation Δ / σ</dt>
            <dd className={ui.text}>{formatPair(stability.detectorRotationDelta, stability.detectorRotationStd, 2, '°')}</dd>
            <dt>Screen angle Δ / σ</dt>
            <dd className={ui.text}>{formatPair(stability.screenDelta, stability.screenStd, 2, '°')}</dd>
            <dt>Relative angle Δ / σ</dt>
            <dd className={ui.text}>{formatPair(stability.relativeDelta, stability.relativeStd, 2, '°')}</dd>
            <dt>Smoothed relative Δ / σ</dt>
            <dd className={ui.text}>{formatPair(stability.smoothedDelta, stability.smoothedStd, 2, '°')}</dd>
            <dt>Pressure σ</dt>
            <dd className={ui.text}>{stability.pressureStd == null ? '—' : `${stability.pressureStd.toFixed(3)} bar`}</dd>
            <dt>Preview mirrored</dt>
            <dd className={ui.text}>{mirrorPreview ? 'yes' : 'no'}</dd>
            <dt>CV frame</dt>
            <dd className={ui.text}>unmirrored</dd>
            <dt>Above {EXTRACTION_START_BAR} bar</dt>
            <dd className={ui.text}>{live.signalPaused ? 'paused' : (live.signal.above ? 'yes' : 'no')}</dd>
            <dt>Rising edge</dt>
            <dd className={ui.text}>{formatClock(live.signal.crossedAt)} ({live.signal.crossCount})</dd>
          </dl>
          <DiagnosticTrace samples={trace} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyReport}
              className={`px-3 py-2 rounded-xl text-xs ${ui.secondaryBtn}`}
            >
              Copy diagnostic report
            </button>
            <button
              type="button"
              onClick={handleClearTrace}
              className={`px-3 py-2 rounded-xl text-xs ${ui.secondaryBtn}`}
            >
              Clear diagnostic history
            </button>
            {copyNote && <span className={`text-xs ${ui.text}`}>{copyNote}</span>}
          </div>
          {reportFallback && (
            <textarea
              readOnly
              value={reportFallback}
              onFocus={(event) => event.target.select()}
              className={`w-full h-48 p-2 rounded-xl font-mono text-[10px] ${ui.input}`}
              aria-label="Diagnostic report"
            />
          )}
          <p className={`text-[10px] ${ui.muted}`}>
            Development only. The report is the last {DIAGNOSTIC_WINDOW_MS / 1000} seconds held in memory. Copying does not upload or save it.
            {reportFallback ? ' Clipboard was blocked, so the report is in the box above.' : ''}
          </p>
          <p className={`text-[10px] ${ui.muted} leading-relaxed`}>
            Edge quality is an internal score, not a confidence percentage.
            Pressure uses the needle angle relative to the gauge that is being followed, minus the rest angle once.
            Δ is the last frame and σ is the spread over the last three seconds. Applied centre and rotation stay still while the detector wobbles inside a small band. A real move still follows.
            The dashed trace is that relative angle.
            Moving the whole gauge should not change the pressure. A weak rim score holds the last pressure instead of inventing one.
            The trace is the last {DIAGNOSTIC_WINDOW_MS / 1000} seconds in memory only. It is not written to shot history.
            The rising-edge line does not start a timer and is not saved.
          </p>
          <label className={`block text-sm ${ui.sub}`}>
            Printed scale: {sweepDeg}° from 0 to {FLAIR_58_SCALE.maxBar} bar
            <input
              type="range"
              min="140"
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
