import { describe, expect, it } from 'vitest';
import {
  SCALE_FLOW_AUTO_STOP_ALGORITHM_LEGACY,
  normalizeScaleFlowAutoStopEnabled,
  scaleFlowAutoStopLegacyAlgorithm,
} from './scaleFlowAutoStop.js';

describe('scaleFlowAutoStop settings', () => {
  it('defaults auto-stop to enabled', () => {
    expect(normalizeScaleFlowAutoStopEnabled(undefined)).toBe(true);
    expect(normalizeScaleFlowAutoStopEnabled(null)).toBe(true);
    expect(normalizeScaleFlowAutoStopEnabled(false)).toBe(false);
  });

  it('treats only tail-low as legacy algorithm', () => {
    expect(scaleFlowAutoStopLegacyAlgorithm(null)).toBe(false);
    expect(scaleFlowAutoStopLegacyAlgorithm({})).toBe(false);
    expect(scaleFlowAutoStopLegacyAlgorithm({ scaleFlowAutoStopAlgorithm: 'current' })).toBe(false);
    expect(scaleFlowAutoStopLegacyAlgorithm({
      scaleFlowAutoStopAlgorithm: SCALE_FLOW_AUTO_STOP_ALGORITHM_LEGACY,
    })).toBe(true);
  });
});
