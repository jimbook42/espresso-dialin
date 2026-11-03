/**
 * Display-only endpoint pairs for existing gaps. Times must be the original
 * reading times (before any plot-time offset/clamping). No values are added.
 * @param {{ tS: number, bar: number, breakBefore?: boolean }[]} points
 */
export function pressureGapBridges(points) {
  const bridges = [];
  for (let i = 1; i < points.length; i += 1) {
    const before = points[i - 1];
    const after = points[i];
    const elapsed = after.tS - before.tS;
    if (after.breakBefore && elapsed > 0 && elapsed < 1) {
      bridges.push([before, after]);
    }
  }
  return bridges;
}
