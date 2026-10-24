/** First N lab shots are labelled "testing" in the UI. */
export const LAB_PRESSURE_TESTING_SHOT_COUNT = 3;

export const LAB_PRESSURE_CAMERA_PREVIEW_KEY = 'labPressureCameraPreviewEnabled';

export function labPressureTestingShotLabel(shotIndex) {
  if (shotIndex == null || !Number.isFinite(shotIndex)) return null;
  if (shotIndex < LAB_PRESSURE_TESTING_SHOT_COUNT) return 'testing';
  return null;
}

/**
 * @param {{ calibration?: object | null, viewMoved?: boolean }} state
 */
export function labPressureNeedsGaugeSetup({ calibration, viewMoved = false }) {
  if (!calibration) return true;
  if (viewMoved === true) return true;
  return false;
}

/**
 * @param {{ enabled: boolean, calibrated: boolean, viewMoved?: boolean, readerReady?: boolean }} state
 */
export function labPressureStatusText(state) {
  if (!state.enabled) return null;
  if (labPressureNeedsGaugeSetup({ calibration: state.calibrated ? {} : null, viewMoved: state.viewMoved })) {
    return 'Set up gauge';
  }
  if (state.readerReady === false) return 'Set up gauge';
  return 'Pressure ready';
}

export function labPressureCameraPreviewEnabled(settings) {
  return settings?.[LAB_PRESSURE_CAMERA_PREVIEW_KEY] === true;
}
