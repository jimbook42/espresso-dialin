/** ~10 Hz cap for replay overlay samples (time since shot start in seconds). */

export const SHOT_REPLAY_SAMPLE_MIN_INTERVAL_S = 0.1;

/**
 * @typedef {{
 *   tS: number,
 *   bar: number | null,
 *   needleDeg: number | null,
 *   hubX: number | null,
 *   hubY: number | null,
 *   radius: number | null,
 *   valid: boolean,
 * }} ShotReplaySample
 */

/**
 * @returns {{
 *   reset: () => void,
 *   begin: (epochMs: number) => void,
 *   push: (sample: Omit<ShotReplaySample, 'tS'> & { tS?: number }) => void,
 *   getSamples: () => ShotReplaySample[],
 * }}
 */
export function createShotReplaySampleLogger() {
  /** @type {ShotReplaySample[]} */
  let samples = [];
  let epochMs = null;
  let lastTS = -Infinity;

  return {
    reset() {
      samples = [];
      epochMs = null;
      lastTS = -Infinity;
    },
    begin(startEpochMs) {
      samples = [];
      epochMs = startEpochMs;
      lastTS = -Infinity;
    },
    push(sample) {
      if (epochMs == null) return;
      const tS = sample.tS ?? (Date.now() - epochMs) / 1000;
      if (tS - lastTS < SHOT_REPLAY_SAMPLE_MIN_INTERVAL_S) return;
      lastTS = tS;
      samples.push({
        tS,
        bar: sample.bar ?? null,
        needleDeg: sample.needleDeg ?? null,
        hubX: sample.hubX ?? null,
        hubY: sample.hubY ?? null,
        radius: sample.radius ?? null,
        valid: sample.valid === true,
      });
    },
    getSamples() {
      return samples;
    },
  };
}
