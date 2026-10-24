import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useShotLabPressure } from '../flairPressureLab/hooks/useShotLabPressure.js';
import { shotLabPressurePhaseGoal } from '../flairPressureLab/shotLabPressurePhaseGoal.js';
import {
  labPressureCameraPreviewEnabled,
  labPressureNeedsGaugeSetup,
  labPressureTestingShotLabel,
} from '../flairPressureLab/shotLabPressureTrust.js';
import { isLabCameraPressureEnabled, labGaugeTapCalibrationFromSettings } from '../settings/labCameraPressure.js';
import { LabGaugeTapCalibrateSheet } from './LabGaugeTapCalibrateSheet.jsx';

export const ShotLabPressureContext = createContext(null);

export function ShotLabPressureProvider({
  settings,
  onSaveCalibration,
  timerRunning,
  timerSeconds,
  weighingViewOpen = false,
  metricsGetterRef,
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
  children,
}) {
  const enabled = isLabCameraPressureEnabled(settings);
  const storedCalibration = labGaugeTapCalibrationFromSettings(settings);
  const viewMoved = settings?.labGaugeTapCalibration?.viewMoved === true;
  const [calibrateOpen, setCalibrateOpen] = useState(false);

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
    onCalibrationSaved,
  });

  useEffect(() => {
    if (!metricsGetterRef) return;
    metricsGetterRef.current = enabled ? pressure.getShotMetrics : () => ({});
  }, [enabled, metricsGetterRef, pressure.getShotMetrics]);

  const displaySurfaceActive = timerRunning || weighingViewOpen;
  const shouldRunHiddenCamera =
    enabled && (calibrateOpen || (displaySurfaceActive && Boolean(storedCalibration)));

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

  const testingLabel = enabled
    ? labPressureTestingShotLabel(labShotsLogged)
    : null;

  const needsSetup = enabled
    && labPressureNeedsGaugeSetup({ calibration: storedCalibration, viewMoved })
    && !calibrateOpen;

  const value = {
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
    readerPath: pressure.readerPath,
    peakBar: pressure.peakBar,
    samples: pressure.samples,
    phaseGoal,
    testingLabel,
    openCalibrate: () => {
      if (enabled) setCalibrateOpen(true);
    },
    storedCalibration: Boolean(storedCalibration),
    timerRunning,
  };

  const showCornerPreview =
    previewOn && timerRunning && displaySurfaceActive && Boolean(storedCalibration);

  return (
    <ShotLabPressureContext.Provider value={value}>
      {shouldRunHiddenCamera && (
        <video
          ref={pressure.videoRef}
          className="fixed w-px h-px opacity-0 pointer-events-none"
          playsInline
          muted
          aria-hidden
        />
      )}
      {showCornerPreview && (
        <video
          ref={(node) => {
            previewRef.current = node;
            const stream = pressure.videoRef.current?.srcObject;
            if (node && stream && node.srcObject !== stream) {
              node.srcObject = stream;
              void node.play().catch(() => {});
            }
          }}
          className="fixed bottom-24 right-3 w-20 h-28 rounded-lg border border-[#2e2b26] object-cover z-[61] opacity-90 pointer-events-none"
          playsInline
          muted
          aria-hidden
          data-testid="lab-pressure-corner-preview"
        />
      )}
      <LabGaugeTapCalibrateSheet
        open={calibrateOpen}
        onClose={() => setCalibrateOpen(false)}
        onAccepted={pressure.acceptCalibration}
        ui={ui}
        showCameraPreview={previewOn}
      />
      {children}
    </ShotLabPressureContext.Provider>
  );
}

export function useShotLabPressureContext() {
  return useContext(ShotLabPressureContext);
}
