/** Settings key: camera pressure on shot screen (beta). Default off. */
export const LAB_CAMERA_PRESSURE_KEY = 'labCameraPressureEnabled';

/** Persisted tap-calibration payload from the pressure lab flow. */
export const LAB_GAUGE_TAP_CALIBRATION_KEY = 'labGaugeTapCalibration';

export function isLabCameraPressureEnabled(settings) {
  return settings?.[LAB_CAMERA_PRESSURE_KEY] === true;
}

export function labGaugeTapCalibrationFromSettings(settings) {
  const raw = settings?.[LAB_GAUGE_TAP_CALIBRATION_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const calibration = raw.calibration;
  if (!calibration || typeof calibration !== 'object') return null;
  return calibration;
}
