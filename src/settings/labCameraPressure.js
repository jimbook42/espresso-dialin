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

/** Previous tracker. Anything else, including unset, is the current reader. */
export const LAB_PRESSURE_READER_KEY = 'labPressureReader';
export const LAB_PRESSURE_READER_LEGACY = 'v4.13.17';
/** Leap-cap tracker that still withholds a frame when the needle model disagrees. */
export const LAB_PRESSURE_READER_BLOCKER = 'v4.13.20';

export function labPressureReaderLegacy(settings) {
  return settings?.[LAB_PRESSURE_READER_KEY] === LAB_PRESSURE_READER_LEGACY;
}

/** Current reader. v4.13.20 and v4.13.17 keep the model veto. */
export function labPressureModelTiebreak(settings) {
  const value = settings?.[LAB_PRESSURE_READER_KEY];
  return value !== LAB_PRESSURE_READER_LEGACY && value !== LAB_PRESSURE_READER_BLOCKER;
}
