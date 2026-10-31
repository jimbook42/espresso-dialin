export const DEFAULT_SCALE_FLOW_AUTO_STOP_ENABLED = true;

/** Previous tail-off detector (20% peak, 0.3 g/s cap). Unset uses the current sharp-drop algorithm. */
export const SCALE_FLOW_AUTO_STOP_ALGORITHM_KEY = 'scaleFlowAutoStopAlgorithm';
export const SCALE_FLOW_AUTO_STOP_ALGORITHM_LEGACY = 'tail-low';

/** @param {boolean | undefined | null} value */
export function normalizeScaleFlowAutoStopEnabled(value) {
  if (value === false) return false;
  return DEFAULT_SCALE_FLOW_AUTO_STOP_ENABLED;
}

/** @param {Record<string, unknown> | null | undefined} settings */
export function scaleFlowAutoStopLegacyAlgorithm(settings) {
  return settings?.[SCALE_FLOW_AUTO_STOP_ALGORITHM_KEY] === SCALE_FLOW_AUTO_STOP_ALGORITHM_LEGACY;
}
