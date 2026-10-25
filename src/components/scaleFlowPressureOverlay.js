import { flairProfileChartPressures } from '../flairPressureLab/flairProfileChartPressures.js';
import { shotPressureChartYMax } from '../flairPressureLab/shotPressureChartLayout.js';

/** Synthetic profile timeline (seconds), aligned with PressureProfileChart. */
export function flairProfileChartDurationSec(profile) {
  const preT = Number(profile?.preinfusionTime) || 0;
  const preDur = Math.max(preT, 4);
  const rampDur = 4;
  const holdDur = 22;
  const taperDur = 8;
  return preDur + rampDur + holdDur + taperDur;
}

/**
 * Ideal bar at elapsed shot time `tS`, stretching the recipe profile to `shotMaxTS`.
 */
export function idealPressureBarAtShotTime(profile, tS, shotMaxTS) {
  const { hasData, pPre, pPeak, pTaper } = flairProfileChartPressures(profile);
  if (!hasData || shotMaxTS <= 0) return null;

  const totalSec = flairProfileChartDurationSec(profile);
  const preT = Number(profile?.preinfusionTime) || 0;
  const preDur = Math.max(preT, 4);
  const rampDur = 4;
  const taperDur = 8;
  const preinfusionEnd = preDur;
  const rampEnd = preDur + rampDur;
  const holdEnd = totalSec - taperDur;

  const tProfile = Math.min(Math.max((tS / shotMaxTS) * totalSec, 0), totalSec);
  const pStart = pPre * 0.25;
  const pEnd = pTaper * 0.9;
  const t1 = preDur * 0.55;

  if (tProfile <= t1) {
    const frac = t1 > 0 ? tProfile / t1 : 1;
    return pStart + (pPre - pStart) * frac;
  }
  if (tProfile <= preinfusionEnd) return pPre;
  if (tProfile <= rampEnd) {
    const frac = rampDur > 0 ? (tProfile - preinfusionEnd) / rampDur : 1;
    return pPre + (pPeak - pPre) * frac;
  }
  if (tProfile <= holdEnd) return pPeak;
  if (tProfile <= totalSec) {
    const frac = taperDur > 0 ? (tProfile - holdEnd) / taperDur : 1;
    return pPeak + (pEnd - pPeak) * frac;
  }
  return pEnd;
}

/**
 * @param {number} pointCount
 * @returns {{ tS: number, bar: number }[]}
 */
export function idealPressureSeriesForShot(profile, shotMaxTS, pointCount = 40) {
  if (!profile || shotMaxTS <= 0) return [];
  const { hasData } = flairProfileChartPressures(profile);
  if (!hasData) return [];
  const out = [];
  for (let i = 0; i <= pointCount; i++) {
    const tS = (i / pointCount) * shotMaxTS;
    const bar = idealPressureBarAtShotTime(profile, tS, shotMaxTS);
    if (bar != null && Number.isFinite(bar)) out.push({ tS, bar });
  }
  return out;
}

/**
 * @param {{ tS: number, bar: number }[]} pressurePoints
 * @param {{ peakPressure?: string | number } | null | undefined} flairProfile
 */
export function historyPressureYMax(pressurePoints, flairProfile) {
  const peak = Number(flairProfile?.peakPressure);
  const chartMaxBar = Number.isFinite(peak) && peak > 0 ? peak : null;
  return shotPressureChartYMax({
    chartMaxBar,
    sampleBars: pressurePoints.map((p) => p.bar),
    goalBars: [],
  });
}
