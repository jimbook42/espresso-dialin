/**
 * Full-screen shot timer: compact CSS applies only when lab camera pressure is on.
 * @param {boolean} labCameraPressureEnabled
 */
export function shotTimerLabCompactActive(labCameraPressureEnabled) {
  return labCameraPressureEnabled === true;
}

/**
 * @param {boolean} labCameraPressureEnabled
 * @returns {string}
 */
export function shotTimerLabCompactClass(labCameraPressureEnabled) {
  return shotTimerLabCompactActive(labCameraPressureEnabled)
    ? 'shot-timer-lab-compact'
    : '';
}
