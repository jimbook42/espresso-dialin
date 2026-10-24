import { resolveFlairPressurePhase } from '../scales/flairScaleTriggers.js';

function positiveNum(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Expected pressure target for the current recipe phase (display only).
 *
 * @returns {{
 *   phase: 'pre' | 'peak' | 'taper',
 *   targetBar: number | null,
 *   taperBand?: { lowBar: number, highBar: number } | null,
 * }}
 */
export function shotLabPressurePhaseGoal({
  flairProfile,
  timerRunning,
  timerUsePreInfusion,
  preInfusionPhase,
  extractionElapsedS,
  liveRelativeWeightG,
  scaleConnected,
  targetTimeMaxS,
}) {
  const phase = resolveFlairPressurePhase({
    profile: flairProfile,
    timerRunning,
    timerUsePreInfusion,
    preInfusionPhase,
    extractionElapsedS,
    liveRelativeWeightG,
    scaleConnected,
    targetTimeMaxS,
  });
  if (!flairProfile) {
    return { phase, targetBar: null, taperBand: null, chartMaxBar: null };
  }
  const preP = positiveNum(flairProfile.preinfusionPressure);
  const peakP = positiveNum(flairProfile.peakPressure);
  const taperP = positiveNum(flairProfile.taperPressure);
  const chartMaxBar =
    peakP != null ? peakP : Math.max(preP ?? 0, taperP ?? 0, 1) || null;

  if (phase === 'pre') {
    return { phase, targetBar: preP ?? null, taperBand: null, chartMaxBar };
  }
  if (phase === 'peak') {
    return { phase, targetBar: peakP ?? null, taperBand: null, chartMaxBar };
  }
  if (phase !== 'taper') {
    return { phase, targetBar: null, taperBand: null, chartMaxBar };
  }
  if (taperP == null) {
    return { phase, targetBar: null, taperBand: null, chartMaxBar };
  }
  const lowBar = taperP * 0.85;
  const highBar = taperP * 1.05;
  return { phase, targetBar: null, taperBand: { lowBar, highBar }, chartMaxBar };
}
