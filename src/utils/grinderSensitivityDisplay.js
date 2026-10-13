import { HIGH_LEARNED_CONFIDENCE_THRESHOLD } from './grindShiftDamping.js';

function formatSensitivityNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * User-facing seconds-per-step line (Stats for Nerds and similar).
 * Hides the "Estimated" prefix once learned confidence is at or above 0.75.
 */
export function formatSecondsPerStepDisplay(
  sensitivity,
  { confidence = 0, usedEmpiricalSlope = false, isDefaultSensitivity = false } = {}
) {
  if (sensitivity === null || sensitivity === undefined || !Number.isFinite(Number(sensitivity))) {
    return '—';
  }
  const core = `${formatSensitivityNumber(sensitivity)}s per step`;
  const showEstimated =
    !isDefaultSensitivity
    && usedEmpiricalSlope
    && (confidence ?? 0) < HIGH_LEARNED_CONFIDENCE_THRESHOLD;
  return showEstimated ? `Estimated · ${core}` : core;
}
