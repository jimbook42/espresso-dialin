import { describe, expect, it } from 'vitest';
import { shotLabPressureFitsViewport, shotLabPressureStacked } from './shotLabPressureLayout.js';

describe('shotLabPressureLayout', () => {
  it('fits common phone widths', () => {
    expect(shotLabPressureFitsViewport(360)).toBe(true);
    expect(shotLabPressureFitsViewport(390)).toBe(true);
    expect(shotLabPressureFitsViewport(412)).toBe(true);
  });

  it('keeps peak chip inline at 360; stacks chart only below 340px', () => {
    expect(shotLabPressureStacked(360)).toBe(false);
    expect(shotLabPressureStacked(330)).toBe(true);
    expect(shotLabPressureStacked(400)).toBe(false);
  });
});
