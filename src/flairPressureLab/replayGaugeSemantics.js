/** Replay CSV labels only — not used by the live CV pipeline. */
const RIM_CONFIDENCE_MIN = 0.3;
const NEEDLE_LIKENESS_GATE = 0.4;

export function classifyReplayGaugeFrame({
  gauge,
  videoWidth,
  videoHeight,
  region,
  referenceCaptured = false,
  likeness = null,
}) {
  const seedCx = region.nx * videoWidth;
  const seedCy = region.ny * videoHeight;
  const distApplied = Math.hypot(gauge.cx - seedCx, gauge.cy - seedCy);
  const hasRaw = gauge.rawCx != null && gauge.rawCy != null;
  const distRaw = hasRaw ? Math.hypot(gauge.rawCx - seedCx, gauge.rawCy - seedCy) : null;
  const centreFromGuide = distApplied < 8 && (distRaw == null || distRaw < 10);
  const rimDetected = (gauge.confidence ?? 0) >= RIM_CONFIDENCE_MIN;
  const gaugeFound = rimDetected && !centreFromGuide;
  return { gaugeFound, centreFromGuide, rimDetected };
}
