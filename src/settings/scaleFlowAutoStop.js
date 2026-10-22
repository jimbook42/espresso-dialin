export const DEFAULT_SCALE_FLOW_AUTO_STOP_ENABLED = true;

/** @param {boolean | undefined | null} value */
export function normalizeScaleFlowAutoStopEnabled(value) {
  if (value === false) return false;
  return DEFAULT_SCALE_FLOW_AUTO_STOP_ENABLED;
}
