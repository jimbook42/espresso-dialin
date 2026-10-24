import { createContext, useContext, useEffect, useState } from 'react';
import { useShotLabPressure } from '../flairPressureLab/hooks/useShotLabPressure.js';
import { isLabCameraPressureEnabled, labGaugeTapCalibrationFromSettings } from '../settings/labCameraPressure.js';
import { LabGaugeTapCalibrateSheet } from './LabGaugeTapCalibrateSheet.jsx';

const ShotLabPressureContext = createContext(null);

export function ShotLabPressureProvider({
  settings,
  onSaveCalibration,
  timerRunning,
  timerSeconds,
  metricsGetterRef,
  ui,
  children,
}) {
  const enabled = isLabCameraPressureEnabled(settings);
  const storedCalibration = labGaugeTapCalibrationFromSettings(settings);
  const [calibrateOpen, setCalibrateOpen] = useState(false);

  const pressure = useShotLabPressure({
    enabled,
    timerRunning,
    timerSeconds,
    storedCalibration,
    calibrateSheetOpen: calibrateOpen,
    onCalibrationSaved: onSaveCalibration,
  });

  useEffect(() => {
    if (!metricsGetterRef) return;
    metricsGetterRef.current = enabled ? pressure.getShotMetrics : () => ({});
  }, [enabled, metricsGetterRef, pressure.getShotMetrics]);

  const shouldRunHiddenCamera =
    enabled && (calibrateOpen || (timerRunning && Boolean(storedCalibration)));

  const value = {
    enabled,
    calibrated: pressure.calibrated,
    showLive: pressure.showLive,
    displayBar: pressure.displayBar,
    hold: pressure.hold,
    peakBar: pressure.peakBar,
    samples: pressure.samples,
    openCalibrate: () => {
      if (enabled) setCalibrateOpen(true);
    },
    storedCalibration: Boolean(storedCalibration),
    timerRunning,
  };

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
      <LabGaugeTapCalibrateSheet
        open={calibrateOpen}
        onClose={() => setCalibrateOpen(false)}
        onAccepted={pressure.acceptCalibration}
        ui={ui}
      />
      {children}
    </ShotLabPressureContext.Provider>
  );
}

export function useShotLabPressureContext() {
  return useContext(ShotLabPressureContext);
}
