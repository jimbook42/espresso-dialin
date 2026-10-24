import { describe, expect, it } from 'vitest';
import { shotLabPressureFitsViewport, shotLabPressureStacked } from './shotLabPressureLayout.js';

describe('shotLabPressureLayout', () => {
  it('fits common phone widths', () => {
    expect(shotLabPressureFitsViewport(360)).toBe(true);
    expect(shotLabPressureFitsViewport(390)).toBe(true);
    expect(shotLabPressureFitsViewport(412)).toBe(true);
  });

  it('stacks readout on narrow widths', () => {
    expect(shotLabPressureStacked(360)).toBe(true);
    expect(shotLabPressureStacked(400)).toBe(false);
  });
});
