import { PROCESS_INTERVAL_MS } from './gaugeConfig.js';

// First-order causal low pass, with at most a 100 ms ramp time constant.
// Two consecutive moves in the same direction confirm a ramp: pass through
// that current observation. This prevents threshold creep after a slow rise.
// Filter only above the repeat-label noise floor. Fade smoothing in over
// 0.05–0.10 bar and out over 0.20–0.25 bar; larger movements follow immediately,
// even on the first observation after a continuity reset.
export const PRESSURE_CURVE_TAU_MS = 100;
export const PRESSURE_CURVE_GAP_MS = PROCESS_INTERVAL_MS * 1.5;
const NOISE_BAR = 0.05;

export function createPressureCurveFilter() {
  let previous = null;
  const reset = () => { previous = null; };
  return {
    reset,
    step(bar, atMs, restart = false) {
      if (!Number.isFinite(bar) || !Number.isFinite(atMs)) {
        reset();
        return null;
      }
      const dt = previous ? atMs - previous.atMs : 0;
      const onset = previous && previous.raw <= 0.15 && bar > 0.15;
      if (restart || !previous || dt <= 0 || dt > PRESSURE_CURVE_GAP_MS || onset) {
        previous = { raw: bar, bar, atMs, delta: 0 };
        return bar;
      }
      const delta = bar - previous.raw;
      const magnitude = Math.abs(delta);
      const speed = magnitude / dt;
      const tau = Math.min(PRESSURE_CURVE_TAU_MS, NOISE_BAR / Math.max(speed, 1e-9));
      const confirmed = delta === 0 || delta * previous.delta > 0;
      const noiseWeight = Math.min(1, Math.max(0, magnitude / NOISE_BAR - 1));
      const motionWeight = Math.min(1, Math.max(0, 5 - magnitude / NOISE_BAR));
      const alpha = confirmed ? 1 : 1 - noiseWeight * motionWeight * tau / (dt + tau);
      const filtered = previous.bar + alpha * (bar - previous.bar);
      previous = { raw: bar, bar: filtered, atMs, delta };
      return filtered;
    },
  };
}
