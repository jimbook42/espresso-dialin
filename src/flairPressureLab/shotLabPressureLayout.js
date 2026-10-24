/**
 * Whether the shot-screen pressure block should render for a viewport width.
 * Keeps the dial-in timer card from growing past one screen on narrow phones.
 */
export function shotLabPressureFitsViewport(widthPx) {
  if (widthPx == null || !Number.isFinite(widthPx)) return true;
  return widthPx >= 320;
}

/** Stack profile chart below the bar row on very narrow widths only (peak chip stays inline). */
export function shotLabPressureStacked(widthPx) {
  return widthPx != null && Number.isFinite(widthPx) && widthPx < 340;
}
