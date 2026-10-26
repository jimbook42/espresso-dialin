/**
 * In-memory raw pressure samples for the active shot (same pattern as scale flow curve).
 */

/**
 * @returns {{
 *   reset: () => void,
 *   begin: (epochMs: number) => void,
 *   pushRaw: (bar: number | null, confident: boolean, timestampMs?: number) => void,
 *   getSamples: () => import('./pressureDisplaySmoothing.js').LabPressureRawSample[],
 *   getShotMetrics: () => { labPressureCurve?: { tS: number, bar: number }[], labPressurePeakBar?: number, labGaugeSnapshotJpeg?: string },
 * }}
 */
export function createShotLabPressureSession() {
  /** @type {import('./pressureDisplaySmoothing.js').LabPressureRawSample[]} */
  let samples = [];
  let epochMs = null;

  return {
    reset() {
      samples = [];
      epochMs = null;
    },
    begin(startEpochMs = Date.now()) {
      samples = [];
      epochMs = startEpochMs;
    },
    pushRaw(bar, confident, timestampMs = Date.now()) {
      if (epochMs == null) return;
      if (bar == null || Number.isNaN(bar)) return;
      const tS = (timestampMs - epochMs) / 1000;
      samples.push({ tS, bar, confident });
    },
    getSamples() {
      return samples;
    },
    getShotMetrics() {
      if (!samples.length) return {};
      const valid = samples.filter((s) => s.bar != null && Number.isFinite(s.bar));
      const confident = valid.filter((s) => s.confident !== false);
      const curveSource = confident.length ? confident : valid;
      const curve = curveSource.map((s) => ({ tS: s.tS, bar: s.bar }));
      if (!curve.length) {
        return valid.length ? { labPressureRawSampleCount: valid.length } : {};
      }
      const peak = curve.reduce((m, s) => Math.max(m, s.bar), curve[0].bar);
      return {
        labPressureCurve: curve,
        labPressurePeakBar: peak,
      };
    },
  };
}
