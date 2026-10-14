/** QA-only: ?simScale=1 auto-connects a hidden simulated scale (no extra UI). */
export function isDevUrlSimScaleActive() {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('simScale') === '1';
  } catch {
    return false;
  }
}
