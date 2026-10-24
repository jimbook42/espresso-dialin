import { describe, expect, it } from 'vitest';
import {
  SHOT_LAB_PRESSURE_READER_PATH,
} from './hooks/useShotLabPressure.js';

describe('useShotLabPressure R7 path', () => {
  it('live hook documents R7 gated reader path', () => {
    expect(SHOT_LAB_PRESSURE_READER_PATH).toBe('r7-tap-gated');
  });
});
