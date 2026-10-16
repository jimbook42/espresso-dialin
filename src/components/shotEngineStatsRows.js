import {
  grinderShortDisplayName,
  resolveShotStatsGrinderModel,
} from '../grinders/grinderRegistry.js';

function formatSignedNumericFixed(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const formatted = abs % 1 === 0 ? String(abs) : abs.toFixed(digits);
  return `${sign}${formatted}`;
}

function formatMassG(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function sensitivityGrinderLabel(shot) {
  const model = resolveShotStatsGrinderModel(shot?.grinderModel);
  return grinderShortDisplayName(model) || model;
}

/** Strip unit suffix; label carries (s/step, grinder). */
function formatSensitivityStatValue(sensitivity, opts, formatSecondsPerStepDisplay) {
  const line = formatSecondsPerStepDisplay(sensitivity, opts);
  if (line === '—') return line;
  return line.replace(/\s*s per step\s*$/i, '');
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
  const grinder = sensitivityGrinderLabel(shot);

  const rows = [
    { label: 'Δt vs target mid (s)', value: formatSignedNumericFixed(stats.timeDelta) },
    { label: 'Yield Δ vs target (g)', value: formatSignedNumericFixed(stats.yieldDelta) },
    {
      label: `Sensitivity (s/step, ${grinder})`,
      value: formatSensitivityStatValue(
        stats.sensitivity,
        {
          confidence: stats.sensitivityConfidence,
          usedEmpiricalSlope: stats.sensitivityUsedEmpiricalSlope,
          isDefaultSensitivity: stats.sensitivityIsDefault,
        },
        formatSensitivity
      ),
    },
    { label: 'Grind shift applied', value: stats.shiftSummary },
    { label: 'Freshness offset @ log', value: stats.ageOffsetNote || '—' },
    {
      label: 'Recipe-matched evidence',
      value: stats.evidenceContext || 'No prior recipe-matched shots in context',
    },
  ];

  if (shotHasSmartScaleLoggedData(shot)) {
    const measuredYield = shot.actualYieldG ?? shot.actualYield;
    rows.splice(2, 0, {
      label: 'Scale yield (g)',
      value: formatMassG(measuredYield),
    });
    if (shot.scaleFlowRateGs != null && Number.isFinite(Number(shot.scaleFlowRateGs))) {
      rows.splice(3, 0, {
        label: 'Scale mean flow (g/s)',
        value: Number(shot.scaleFlowRateGs).toFixed(2),
      });
    }
  }

  return rows;
}
