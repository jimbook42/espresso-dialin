/**
 * Main entry routing (mirrors src/main.jsx) for tests without a browser bundle.
 */
export function resolveAppEntry({ hash = '', pressureLabEnabled = false }) {
  const isFlairPressureLabRoute =
    hash === '#/flair-pressure-lab' || hash.startsWith('#/flair-pressure-lab?');

  if (isFlairPressureLabRoute && pressureLabEnabled) {
    return { entry: 'flair-pressure-lab' };
  }
  if (isFlairPressureLabRoute && !pressureLabEnabled) {
    return { entry: 'app', clearHash: true };
  }
  return { entry: 'app' };
}
