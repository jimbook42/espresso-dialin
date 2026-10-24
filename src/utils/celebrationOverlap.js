/**
 * Axis-aligned rectangle overlap (positive area), for celebration layout checks.
 * @param {{ top: number, left: number, right: number, bottom: number }} a
 * @param {{ top: number, left: number, right: number, bottom: number }} b
 */
export function rectsIntersect(a, b) {
  if (!a || !b) return false;
  const overlapW = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const overlapH = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return overlapW > 0.5 && overlapH > 0.5;
}

/**
 * @param {number} doseG
 * @param {number} yieldG
 */
export function brewRatioOneDecimal(doseG, yieldG) {
  const dose = Number(doseG);
  const yld = Number(yieldG);
  if (!Number.isFinite(dose) || dose <= 0 || !Number.isFinite(yld) || yld <= 0) {
    return '0.0';
  }
  return (yld / dose).toFixed(1);
}

/**
 * @param {string} ratioDecimal e.g. "2.0"
 */
export function formatPerfectShotRatioLabel(ratioDecimal) {
  return `1:${ratioDecimal} · on target`;
}

/**
 * Scroll yield tile and notes card into view for the celebration moment.
 * @param {{ yieldEl?: Element | null, notesEl?: Element | null, reducedMotion?: boolean }} opts
 */
export function scrollPerfectShotIntoView({ yieldEl, notesEl, reducedMotion = false }) {
  const behavior = reducedMotion ? 'auto' : 'smooth';
  const block = 'nearest';
  if (yieldEl && typeof yieldEl.scrollIntoView === 'function') {
    yieldEl.scrollIntoView({ behavior, block: 'center' });
  }
  if (notesEl && typeof notesEl.scrollIntoView === 'function') {
    notesEl.scrollIntoView({ behavior, block: 'nearest' });
  }
}
