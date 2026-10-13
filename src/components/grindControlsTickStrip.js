/** Tick strip geometry for grind dial steppers (unit-tested). */

export const VISIBLE_TICKS = 9;
export const CENTER_TICK = 4;
export const TICK_WINDOW_PAD = 12;

export function computeTickWindow(valueIndex, maxValueIndex) {
  const max = Math.max(0, maxValueIndex);
  const idx = Math.min(Math.max(0, valueIndex), max);
  const start = Math.max(0, idx - CENTER_TICK - TICK_WINDOW_PAD);
  const end = Math.min(max, idx + (VISIBLE_TICKS - 1 - CENTER_TICK) + TICK_WINDOW_PAD);
  return { start, end };
}

export function computeTickStripTranslate(valueIndex, windowStart, tickSpacing, dragOffsetPx = 0) {
  if (!(tickSpacing > 0)) return 0;
  return CENTER_TICK * tickSpacing - (valueIndex - windowStart) * tickSpacing + dragOffsetPx;
}
