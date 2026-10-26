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
 *   captureLabPressureShotMetrics: () => object,
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

  let metrics = labPressureMetricsHaveCurve(labPressureShotMetrics)
    ? labPressureShotMetrics
    : null;
  if (!metrics) {
    try {
      const captured = captureLabPressureShotMetrics();
      if (labPressureMetricsHaveCurve(captured)) metrics = captured;
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

  let missingReason = 'no_samples';
  try {
    const retry = captureLabPressureShotMetrics();
    if (retry?.labPressureRawSampleCount > 0) {
      missingReason = 'no_curve_after_filter';
    }
  } catch {
    // keep no_samples
  }
  console.warn('[lab-pressure] shot saved without pressure curve:', missingReason);
  return {
    fields: { labPressureMissingReason: missingReason },
    missingReason,
  };
}
