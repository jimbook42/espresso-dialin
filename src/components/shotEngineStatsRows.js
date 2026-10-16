function formatSigned(value, unit = '', digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  const sign = n > 0 ? '+' : '';
  const formatted = Math.abs(n) % 1 === 0 ? String(n) : n.toFixed(digits);
  return `${sign}${formatted}${unit}`;
}

function formatYieldG(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const rounded = n % 1 === 0 ? String(n) : n.toFixed(1);
  return `${rounded}g`;
}

/** Shot history stores scale flow metrics when a supported scale was connected during the pull. */
export function shotHasSmartScaleLoggedData(shot) {
  if (!shot) return false;
  const hasCurve = Array.isArray(shot.scaleFlowCurve) && shot.scaleFlowCurve.length > 0;
  const hasFlow = shot.scaleFlowRateGs != null && Number.isFinite(Number(shot.scaleFlowRateGs));
  return hasCurve || hasFlow;
}

/**
 * Row labels and values for ShotEngineStatsPanel (Stats for Nerds).
 * @param {ReturnType<import('../utils/grinderLogic.js').getShotEngineStats>} stats
 * @param {import('../utils/grinderSensitivityDisplay.js').formatSecondsPerStepDisplay} formatSensitivity
 */
export function buildShotEngineStatsRows(stats, shot, formatSensitivity) {
  const rows = [
    { label: 'Time vs target middle', value: formatSigned(stats.timeDelta, 's') },
    { label: 'Yield vs target', value: formatSigned(stats.yieldDelta, 'g') },
    {
      label: 'Grind sensitivity',
      value: formatSensitivity(stats.sensitivity, {
        confidence: stats.sensitivityConfidence,
        usedEmpiricalSlope: stats.sensitivityUsedEmpiricalSlope,
        isDefaultSensitivity: stats.sensitivityIsDefault,
      }),
    },
    { label: 'Grind change applied', value: stats.shiftSummary },
    { label: 'Bean age at log', value: stats.ageOffsetNote || '—' },
    {
      label: 'Learning from prior shots',
      value: stats.evidenceContext || 'No prior recipe-matched shots in context',
    },
  ];

  if (shotHasSmartScaleLoggedData(shot)) {
    const measuredYield = shot.actualYieldG ?? shot.actualYield;
    rows.splice(2, 0, {
      label: 'Measured yield (scale)',
      value: formatYieldG(measuredYield),
    });
    if (shot.scaleFlowRateGs != null && Number.isFinite(Number(shot.scaleFlowRateGs))) {
      rows.splice(3, 0, {
        label: 'Average flow (scale)',
        value: `${Number(shot.scaleFlowRateGs).toFixed(2)} g/s`,
      });
    }
  }

  return rows;
}
