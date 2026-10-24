/** Replay CSV labels only — not used by the live CV pipeline. */
const RIM_CONFIDENCE_MIN = 0.3;

export function classifyReplayGaugeFrame({
  gauge,
  referenceCaptured = false,
  dialRegistered = false,
}) {
  const rimDetected = (gauge.confidence ?? 0) >= RIM_CONFIDENCE_MIN;
  const registered = dialRegistered || referenceCaptured;
  const gaugeFound = rimDetected && registered;
  return { gaugeFound, centreFromGuide: false, rimDetected };
}
