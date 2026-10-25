/**
 * Plain-language pressure target for the shot timer / weigh surfaces (display only).
 */

import { flairProfileChartPreBar } from './flairProfileChartPressures.js';

function positiveNum(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Whole numbers without decimals; otherwise one decimal (pre-infusion / taper endpoints). */
export function formatAimBarCompact(n) {
  const v = positiveNum(n);
  if (v == null) return null;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Peak-phase live readout — always one decimal (e.g. 9.0). */
export function formatAimBarPeak(n) {
  const v = positiveNum(n);
  if (v == null) return null;
  return v.toFixed(1);
}

/**
 * @param {{
 *   flairProfile?: Record<string, unknown> | null,
 *   phaseGoal?: {
 *     phase?: string,
 *     targetBar?: number | null,
 *     taperBand?: { lowBar: number, highBar: number } | null,
 *   } | null,
 *   timerRunning?: boolean,
 *   timerUsePreInfusion?: boolean,
 * }} args
 * @returns {string | null}
 */
export function shotLabPressureAimText({
  flairProfile,
  phaseGoal,
  timerRunning = false,
  timerUsePreInfusion = false,
}) {
  if (!flairProfile) return null;

  const preP = positiveNum(flairProfile.preinfusionPressure);
  const peakP = positiveNum(flairProfile.peakPressure);
  const taperP = positiveNum(flairProfile.taperPressure);
  const chartPreP = () => flairProfileChartPreBar(flairProfile);

  if (!timerRunning) {
    const usePre = timerUsePreInfusion;
    const preAim = preP ?? (usePre ? chartPreP() : null);
    if (usePre && preAim != null && peakP != null) {
      let line = `Aim: ${formatAimBarCompact(preAim)} bar pre-infusion, then ${formatAimBarCompact(peakP)} bar`;
      if (taperP != null) {
        line += `, then ${formatAimBarCompact(taperP)} bar`;
      }
      return line;
    }
    if (usePre && preAim != null) {
      return `Aim: ${formatAimBarCompact(preAim)} bar`;
    }
    if (peakP != null) {
      return `Aim: ${formatAimBarPeak(peakP)} bar`;
    }
    return null;
  }

  if (!phaseGoal) return null;
  const { phase, targetBar, taperBand } = phaseGoal;

  if (phase === 'pre' && targetBar != null) {
    return `Aim: ${formatAimBarCompact(targetBar)} bar`;
  }
  if (phase === 'peak' && targetBar != null) {
    return `Aim: ${formatAimBarPeak(targetBar)} bar`;
  }
  if (phase === 'taper') {
    if (peakP != null && taperP != null) {
      return `Aim: ${formatAimBarCompact(peakP)} → ${formatAimBarCompact(taperP)} bar`;
    }
    if (taperBand?.lowBar != null && taperBand?.highBar != null) {
      const lo = taperBand.lowBar.toFixed(1);
      const hi = taperBand.highBar.toFixed(1);
      return `Aim: ${lo}–${hi} bar`;
    }
  }
  return null;
}
