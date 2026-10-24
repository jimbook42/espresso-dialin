/**
 * @param {unknown} targetDoseG
 * @returns {number | null}
 */
export function parseRecipeTargetDoseG(targetDoseG) {
  if (targetDoseG === '' || targetDoseG === null || targetDoseG === undefined) return null;
  const n = Number(targetDoseG);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * @param {number} liveWeightG
 * @param {unknown} targetDoseG
 * @returns {string | null} e.g. "18.0 g · +0.2", or null when no target dose
 */
export function formatWeighingTargetDoseLine(liveWeightG, targetDoseG) {
  const target = parseRecipeTargetDoseG(targetDoseG);
  if (target == null) return null;
  const live = Number(liveWeightG);
  const n = Number.isFinite(live) ? live : 0;
  const diff = n - target;
  const sign = diff >= 0 ? '+' : '';
  return `${target.toFixed(1)} g · ${sign}${diff.toFixed(1)}`;
}

/**
 * @param {boolean} isConnected
 * @param {boolean} timerRunning
 */
export function isWeighingChipEnabled(isConnected, timerRunning) {
  return isConnected && !timerRunning;
}

/**
 * @param {boolean} viewOpen
 * @param {boolean} timerRunning
 * @param {boolean} isConnected
 */
export function shouldAutoCloseWeighingView(viewOpen, timerRunning, isConnected) {
  return viewOpen && (timerRunning || !isConnected);
}
