import { isPressureSimAllowed } from '../config/pressureSimFlag.js';

/**
 * Deterministic fake bar for preview screenshots when VITE_PRESSURE_ALLOW_SIM=true.
 * @param {number} tS seconds since shot start
 */
export function simulatedPressureBarAt(tS) {
  if (!isPressureSimAllowed()) return null;
  const t = Math.max(0, tS);
  if (t < 2) return 0.2 + t * 0.15;
  if (t < 8) return 2 + (t - 2) * 1.1;
  if (t < 24) return 8.5 - (t - 8) * 0.12;
  return 6.5;
}

export function buildSimulatedPressureSeries(durationS = 28, stepS = 0.25) {
  if (!isPressureSimAllowed()) return [];
  const out = [];
  for (let t = 0; t <= durationS; t += stepS) {
    const bar = simulatedPressureBarAt(t);
    if (bar != null) out.push({ tS: t, bar, confident: true });
  }
  return out;
}
