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
  const seedR = region.nr * Math.min(videoWidth, videoHeight);
  const radiusNearSeed = Math.abs((gauge.radius ?? 0) - seedR) < seedR * 0.08;
  const centreFromGuide = distApplied < 8 && radiusNearSeed;
  const rimDetected = (gauge.confidence ?? 0) >= RIM_CONFIDENCE_MIN;
  const gaugeFound = rimDetected && !centreFromGuide;
  return { gaugeFound, centreFromGuide, rimDetected };
}
