/** Rolling lab trace. Memory only — never Dexie, shots, or the network. */
export const DIAGNOSTIC_HISTORY_MS = 30_000;

export function createDiagnosticHistory({ durationMs = DIAGNOSTIC_HISTORY_MS } = {}) {
  let samples = [];
  return {
    reset() {
      samples = [];
    },
    push(sample) {
      const t = sample.t ?? Date.now();
      samples.push({ ...sample, t });
      const cutoff = t - durationMs;
      let drop = 0;
      while (drop < samples.length && samples[drop].t < cutoff) drop += 1;
      if (drop) samples.splice(0, drop);
    },
    snapshot() {
      return samples.slice();
    },
    get length() {
      return samples.length;
    },
  };
}
