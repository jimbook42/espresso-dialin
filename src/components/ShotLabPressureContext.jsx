import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useShotLabPressure } from '../flairPressureLab/hooks/useShotLabPressure.js';
import { shotLabPressureAimText } from '../flairPressureLab/shotLabPressureAimText.js';
import { shotLabPressurePhaseGoal } from '../flairPressureLab/shotLabPressurePhaseGoal.js';
import {
  labPressureCameraPreviewEnabled,
  labPressureNeedsGaugeSetup,
  labPressureTestingShotLabel,
} from '../flairPressureLab/shotLabPressureTrust.js';
import { isLabCameraPressureEnabled, labGaugeTapCalibrationFromSettings, labPressureModelTiebreak, labPressureReaderLegacy, labPressureScaleLegacy } from '../settings/labCameraPressure.js';
import { LabGaugeTapCalibrateSheet } from './LabGaugeTapCalibrateSheet.jsx';
import { useLabPressureCornerPreviewStyle } from '../flairPressureLab/hooks/useLabPressureCornerPreviewStyle.js';
import { useLabShotReplay } from '../flairPressureLab/hooks/useLabShotReplay.js';

export const ShotLabPressureContext = createContext(null);

export function ShotLabPressureProvider({
  settings,
  onSaveCalibration,
  timerRunning,
  timerSeconds,
  weighingViewOpen = false,
  metricsGetterRef,
  shotDiagnosticsRef,
  ui,
  flairProfile,
  timerUsePreInfusion = false,
  preInfusionPhase = false,
  extractionElapsedS = 0,
  liveRelativeWeightG = 0,
  scaleConnected = false,
  targetTimeMaxS,
  labShotsLogged = 0,
  calibrateRequest = 0,
  registerOpenCalibrate,
  preShotDialCheckSurface = false,
  shotReplayCommitRef,
  shotReplayDiscardRef,
  onLabShotReplayStored,
  children,
}) {
  const replayFrameObserverRef = useRef(null);
  const readerFrameObserverRef = useRef(null);
  const liveFrameRef = useRef(null);
  const enabled = isLabCameraPressureEnabled(settings);
  const storedCalibration = labGaugeTapCalibrationFromSettings(settings);
  const viewMoved = settings?.labGaugeTapCalibration?.viewMoved === true;
  const [calibrateOpen, setCalibrateOpen] = useState(false);
  const [facingMode, setFacingMode] = useState(() => {
    try { return localStorage.getItem('espresso-dialin.camera-facing-mode') === 'environment' ? 'environment' : 'user'; }
    catch { return 'user'; }
  });
  useEffect(() => {
    try { localStorage.setItem('espresso-dialin.camera-facing-mode', facingMode); } catch { /* UI preference only. */ }
  }, [facingMode]);

  useEffect(() => {
    if (calibrateRequest > 0) setCalibrateOpen(true);
  }, [calibrateRequest]);

  useEffect(() => {
    registerOpenCalibrate?.(() => {
      if (enabled) setCalibrateOpen(true);
    });
  }, [enabled, registerOpenCalibrate]);
  const previewRef = useRef(null);
  const previewOn = enabled && labPressureCameraPreviewEnabled(settings);

  const pressure = useShotLabPressure({
    enabled,
    timerRunning,
    timerSeconds,
    storedCalibration,
    calibrateSheetOpen: calibrateOpen,
    weighingViewOpen,
    preShotDialCheckSurface,
    // Guided-brew Start can reach a live shot without the Dial calibration guard.
    cameraPreviewActive: enabled && timerRunning,
    cameraFacingMode: facingMode,
    onCalibrationSaved: onSaveCalibration,
    replayFrameObserverRef: readerFrameObserverRef,
    shotDiagnosticsRef,
    leapCap: !labPressureReaderLegacy(settings),
    modelTiebreak: labPressureModelTiebreak(settings),
    legacyScale: labPressureScaleLegacy(settings),
  });

  useLabShotReplay({
    enabled,
    timerRunning,
    videoRef: pressure.videoRef,
    replayFrameObserverRef,
    shotReplayCommitRef,
    shotReplayDiscardRef,
    onReplayStored: onLabShotReplayStored,
    readerStallSnapshotRef: pressure.readerStallSnapshotRef,
  });

  // Fan out existing reader output; replay recording retains its original observer.
  useEffect(() => {
    liveFrameRef.current = null;
    readerFrameObserverRef.current = (frame) => {
      liveFrameRef.current = { ...frame, observedAtMs: Date.now() };
      replayFrameObserverRef.current?.(frame);
    };
    return () => { readerFrameObserverRef.current = null; };
  }, [enabled, timerRunning]);

  useEffect(() => {
    if (!metricsGetterRef) return;
    metricsGetterRef.current = enabled ? pressure.getShotMetrics : () => ({});
  }, [enabled, metricsGetterRef, pressure.getShotMetrics]);

  const phaseGoal = useMemo(
    () =>
      shotLabPressurePhaseGoal({
        flairProfile,
        timerRunning,
        timerUsePreInfusion,
        preInfusionPhase,
        extractionElapsedS,
        liveRelativeWeightG,
        scaleConnected,
        targetTimeMaxS,
      }),
    [
      flairProfile,
      timerRunning,
      timerUsePreInfusion,
      preInfusionPhase,
      extractionElapsedS,
      liveRelativeWeightG,
      scaleConnected,
      targetTimeMaxS,
    ],
  );

  const aimText = useMemo(
    () =>
      shotLabPressureAimText({
        flairProfile,
        phaseGoal,
        timerRunning,
        timerUsePreInfusion,
      }),
    [flairProfile, phaseGoal, timerRunning, timerUsePreInfusion],
  );

  const testingLabel = enabled
    ? labPressureTestingShotLabel(labShotsLogged)
    : null;

  const needsSetup = enabled
    && labPressureNeedsGaugeSetup({ calibration: storedCalibration, viewMoved })
    && !calibrateOpen;

  const value = {
    facingMode,
    flipCamera: () => setFacingMode((current) => current === 'user' ? 'environment' : 'user'),
    videoRef: pressure.videoRef,
    liveFrameRef,
    enabled,
    calibrated: pressure.calibrated,
    needsSetup,
    viewMoved,
    readoutVisible: pressure.readoutVisible,
    showLive: pressure.showLive,
    displayBar: pressure.displayBar,
    hold: pressure.hold,
    readerUncertain: pressure.readerUncertain,
    readerReady: pressure.readerReady,
    readerError: pressure.readerError,
    cameraStatus: pressure.cameraStatus,
    cameraError: pressure.cameraError,
    retryCamera: pressure.retryCamera,
    readerPath: pressure.readerPath,
    peakBar: pressure.peakBar,
    samples: pressure.samples,
    phaseGoal,
    aimText,
    testingLabel,
    openCalibrate: () => {
      if (enabled) setCalibrateOpen(true);
    },
    storedCalibration: Boolean(storedCalibration),
    timerRunning,
    dialRecalibrateHint: pressure.dialRecalibrateHint,
    preShotDialStatus: pressure.preShotDialStatus,
    noPressureReadingWarning: pressure.noPressureReadingWarning,
  };

  const showCornerPreview =
    previewOn && timerRunning && weighingViewOpen && Boolean(storedCalibration);

  useLabPressureCornerPreviewStyle(
    showCornerPreview ? pressure.cornerPreviewPose : null,
    previewRef,
  );

  return (
    <ShotLabPressureContext.Provider value={value}>
      {/* Keep the owner's ref stable through setup close/accept and shot start.
          The camera hook still controls stream acquisition and release. */}
      {enabled && (
        <video
          ref={pressure.videoRef}
          data-testid="shot-reader-video"
          style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0.01, pointerEvents: 'none', overflow: 'hidden' }}
          autoPlay
          playsInline
          muted
          aria-hidden
        />
      )}
      {showCornerPreview && (
        <div
          data-testid="lab-pressure-corner-preview"
          className="pointer-events-none fixed bottom-24 right-3 z-[61] h-28 w-20 overflow-hidden rounded-lg border border-[#2e2b26] opacity-90"
          aria-hidden
        >
          <video
            ref={(node) => {
              previewRef.current = node;
              const stream = pressure.videoRef.current?.srcObject;
              if (node && stream && node.srcObject !== stream) {
                node.srcObject = stream;
                void node.play().catch(() => {});
              }
            }}
            className="absolute inset-0 h-full w-full object-cover"
            playsInline
            muted
            aria-hidden
          />
        </div>
      )}
      <LabGaugeTapCalibrateSheet
        open={calibrateOpen}
        onClose={() => setCalibrateOpen(false)}
        onAccepted={pressure.acceptCalibration}
        sourceCamera={pressure}
        ui={ui}
        showCameraPreview={previewOn}
        leapCap={!labPressureReaderLegacy(settings)}
        legacyScale={labPressureScaleLegacy(settings)}
      />
      {children}
    </ShotLabPressureContext.Provider>
  );
}

export function useShotLabPressureContext() {
  return useContext(ShotLabPressureContext);
}
