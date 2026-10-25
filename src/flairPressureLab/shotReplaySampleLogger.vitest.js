import { describe, expect, it } from 'vitest';
import {
  createShotReplaySampleLogger,
  SHOT_REPLAY_SAMPLE_MIN_INTERVAL_S,
} from './shotReplaySampleLogger.js';

describe('shotReplaySampleLogger', () => {
  it('caps samples at ~10 per second', () => {
    const logger = createShotReplaySampleLogger();
    logger.begin(1000);
    for (let i = 0; i < 50; i++) {
      logger.push({
        tS: i * 0.02,
        bar: 5,
        valid: true,
        hubX: 1,
        hubY: 2,
        radius: 40,
        needleDeg: 90,
      });
    }
    const samples = logger.getSamples();
    expect(samples.length).toBeLessThanOrEqual(11);
    expect(samples.length).toBeGreaterThanOrEqual(8);
    expect(SHOT_REPLAY_SAMPLE_MIN_INTERVAL_S).toBe(0.1);
  });

  it('reset clears samples', () => {
    const logger = createShotReplaySampleLogger();
    logger.begin(0);
    logger.push({ tS: 0, bar: 1, valid: true });
    logger.reset();
    expect(logger.getSamples()).toEqual([]);
  });
});
