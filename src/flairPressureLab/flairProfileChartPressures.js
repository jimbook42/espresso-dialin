/**
 * Pressure levels for the static flair profile chart (display only).
 * Keep in sync with PressureProfileChart path building.
 */

/**
 * @param {Record<string, unknown> | null | undefined} profile
 */
export function flairProfileChartPressures(profile) {
  const preP = Number(profile?.preinfusionPressure) || 0;
  const peakP = Number(profile?.peakPressure) || 0;
  const taperP = Number(profile?.taperPressure) || 0;
  const pPre = preP || peakP * 0.35 || 2;
  const pPeak = peakP || preP || 9;
  const pTaper = taperP || peakP * 0.5 || 4.5;
  const hasData = preP > 0 || peakP > 0 || taperP > 0;
  return { preP, peakP, taperP, pPre, pPeak, pTaper, hasData };
}

/**
 * @param {Record<string, unknown> | null | undefined} profile
 * @returns {number}
 */
export function flairProfileChartPreBar(profile) {
  return flairProfileChartPressures(profile).pPre;
}
