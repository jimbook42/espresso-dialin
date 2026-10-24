import { describe, expect, it } from 'vitest';
import {
  pressureSimRecipeFlairProfile,
  pressureSimRecipeRecord,
} from './pressureSimRecipe.js';

describe('pressureSimRecipe', () => {
  it('is inactive without VITE_PRESSURE_ALLOW_SIM', () => {
    expect(pressureSimRecipeFlairProfile()).toBeNull();
    expect(pressureSimRecipeRecord()).toBeNull();
  });
});
