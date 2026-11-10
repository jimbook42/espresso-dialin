/**
 * Build lab-pressure fields for a shot record at save time.
 */

/**
 * @param {object | null | undefined} metrics
 * @returns {boolean}
 */
export function labPressureMetricsHaveCurve(metrics) {
  return Boolean(metrics?.labPressureCurve?.length);
}

/**
 * @param {{
 *   labCameraPressureEnabled: boolean,
 *   labPressureShotMetrics: object | null,
 *   captureLabPressureShotMetrics?: () => object,
 * }} opts
 * @returns {{ fields: object, missingReason?: string }}
 */
export function buildLabPressureShotFields({
  labCameraPressureEnabled,
  labPressureShotMetrics,
  captureLabPressureShotMetrics,
}) {
  if (!labCameraPressureEnabled) {
    return { fields: {} };
  }

  let metrics = labPressureShotMetrics;
  if (metrics == null && captureLabPressureShotMetrics) {
    try {
      metrics = captureLabPressureShotMetrics();
    } catch {
      // ignore
    }
  }

  if (labPressureMetricsHaveCurve(metrics)) {
    return {
      fields: {
        labPressureCurve: metrics.labPressureCurve,
        labPressurePeakBar: metrics.labPressurePeakBar ?? undefined,
        ...(metrics.labGaugeSnapshotJpeg
          ? { labGaugeSnapshotJpeg: metrics.labGaugeSnapshotJpeg }
          : {}),
      },
    };
  }

  const missingReason = metrics?.labPressureRawSampleCount > 0 ? 'no_curve_after_filter' : 'no_samples';
  console.warn('[lab-pressure] shot saved without pressure curve:', missingReason);
  return {
    fields: { labPressureMissingReason: missingReason },
    missingReason,
  };
}
